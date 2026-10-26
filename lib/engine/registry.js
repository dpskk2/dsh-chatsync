// Part of the SyncEngine (lib/sync.js); moved verbatim from lib/sync.js.
import fs from 'node:fs';
import path from 'node:path';
import { parseWorkspaceRegistry } from '../workspace-registry.js';
import { classifyGrouping, hostGroupingState } from '../host-grouping.js';
import { decodeZstdFirstFrame } from '../merge.js';
import { sessionIdOfLogPath, sessionIdPattern } from '../session-path.js';
import { ZSTD_MAGIC, pickSessionLog, textHasTurnStart, zstdDecompressSync } from './session-files.js';

/** 会话分组文件夹名 → 原始路径(与 DSH 的 projectKey 编码互逆;编码本身有损,尽力还原) */
export function decodeGroup(group) {
  try {
    let s = String(group).replace(/^--/, '').replace(/--$/, '');
    s = s.replace(/~([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return s.replace(/-/g, '\\');
  } catch {
    return String(group);
  }
}
/** 路径规范化:统一盘符冒号与分隔符、忽略大小写 —— 用于跨机「会话分组 ↔ 工作区路径」比对 */
export function normPath(p) {
  return String(p)
    .replace(/[/\\:]+/g, '\\')
    .replace(/\\+$/, '')
    .toLowerCase();
}

export const registryMethods = {
  /** 主数据同步(会话/settings/插件/技能/工作区元数据);工作区文件夹内容由外层 _syncOnce 追加处理 */
  /**
   * 枚举本机全部会话目录:返回 [{ id, group, file, size, mtimeMs }]。
   * 会话文件选择走 pickSessionLog(目录枚举,按版本取最新),兼容 v4/v5、不依赖白名单;
   * 登记表自查/幽灵清理/预览共用同一份口径。
   */
  scanSessions() {
    const root = path.join(this.home, 'sessions');
    const out = [];
    let groups = [];
    try {
      groups = fs.readdirSync(root);
    } catch {
      return out;
    }
    for (const group of groups) {
      let ids = [];
      try {
        ids = fs.readdirSync(path.join(root, group));
      } catch {
        continue;
      }
      for (const id of ids) {
        if (!sessionIdPattern.test(id)) continue;
        const sdir = path.join(root, group, id);
        const file = pickSessionLog(sdir);
        if (!file) continue;
        let stat = null;
        try {
          stat = fs.statSync(file);
        } catch {
          continue;
        }
        out.push({ id, group, file, size: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
    return out;
  },

  /** 会话文件的实际 cwd:优先读日志头(只解首帧,快),失败回退为分组名还原。
   *  sdir 也可直接传会话文件路径(预览/冲突拷贝等非目录场景)。 */
  sessionCwdOf(sdir, group) {
    try {
      let file;
      try {
        if (fs.statSync(sdir).isFile()) file = sdir;
      } catch {
        /* 不存在则按目录处理 */
      }
      if (!file) file = pickSessionLog(sdir);
      if (!file) return decodeGroup(group);
      const fd = fs.openSync(file, 'r');
      let text = '';
      try {
        // 会话头在第一个 zstd 帧里,zstd 帧头自带大小;先读 1MB(足够容纳大 header),
        // 只在没读到 type session 时再补读一次,避免每个会话固定读 2MB。
        const readHead = size => {
          const head = Buffer.alloc(size);
          const n = fs.readSync(fd, head, 0, head.length, 0);
          const buf = head.subarray(0, n);
          if (buf.subarray(0, 4).equals(ZSTD_MAGIC) && typeof zstdDecompressSync === 'function') {
            return decodeZstdFirstFrame(buf) || '';
          }
          return buf.toString('utf8');
        };
        const parseCwd = t => {
          for (const line of t.split('\n')) {
            if (!line.trim()) continue;
            try {
              const rec = JSON.parse(line);
              if (rec && typeof rec === 'object' && rec.type === 'session' && typeof rec.data?.cwd === 'string')
                return rec.data.cwd;
              if (rec && typeof rec === 'object' && typeof rec.cwd === 'string') return rec.cwd;
            } catch {
              /* 下一行 */
            }
          }
          return null;
        };
        text = readHead(1024 * 1024);
        let cwd = parseCwd(text);
        if (!cwd) {
          text = readHead(2 * 1024 * 1024);
          cwd = parseCwd(text);
        }
        if (cwd) return cwd;
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      /* 走分组名还原 */
    }
    return decodeGroup(group);
  },

  /** DSH owns workspace creation, deletion and archive accounting. Sync must
   * never reconstruct a deleted workspace from surviving session headers. */
  repairWorkspaceRegistry() {
    return { ok: true, repaired: 0, created: 0, deduped: 0, unarchived: 0 };
  },

  /** Three-way workspace merge: additions combine; observed deletions win. */
  async unionMergeWorkspaceJson() {
    try {
      const f = 'storages/workspace.json';
      const [o, t, b] = await Promise.all([
        this.git(['show', ':2:' + f]),
        this.git(['show', ':3:' + f]),
        this.git(['show', ':1:' + f]),
      ]);
      const parse = r => {
        try {
          return this.ok(r) && r.out ? JSON.parse(r.out) : null;
        } catch {
          return null;
        }
      };
      const ours = parse(o),
        theirs = parse(t),
        base = parse(b);
      if (!ours || !theirs) return false; // 解析失败 → 走常规单边保留
      if (!ours.global) ours.global = {};
      if (!ours.tables) ours.tables = {};
      if (!ours.tables.workspaces) ours.tables.workspaces = {};
      const oWs = ours.tables.workspaces;
      const tWs =
        theirs.tables && theirs.tables.workspaces && typeof theirs.tables.workspaces === 'object'
          ? theirs.tables.workspaces
          : {};
      const baseWs = base?.tables?.workspaces || {};
      const removed = new Set(Object.keys(baseWs).filter(id => !Object.hasOwn(oWs, id) || !Object.hasOwn(tWs, id)));
      for (const id of removed) delete oWs[id];
      ours.global.workspaceIds = (ours.global.workspaceIds || []).filter(id => !removed.has(id));
      const mergeIds = (previous = [], local = [], remote = []) => {
        const removedIds = new Set(previous.filter(id => !local.includes(id) || !remote.includes(id)));
        return [...new Set([...local, ...remote])].filter(id => !removedIds.has(id));
      };
      for (const [wid, tw] of Object.entries(tWs)) {
        if (removed.has(wid)) continue;
        const ow = oWs[wid];
        if (!ow) {
          // 路径去重:若远端这条工作区记录的路径已被本机某条记录占用,不新增重复工作区
          // (同一文件夹被两台电脑登记成两个 id,是工作区内容合并冲突标记、会话归属错乱的根源)
          const claimed =
            tw && typeof tw.path === 'string'
              ? Object.entries(oWs).find(
                  ([_, w]) => w && typeof w.path === 'string' && normPath(w.path) === normPath(tw.path),
                )
              : undefined;
          if (claimed) {
            const [localId, localW] = claimed;
            if (tw && Array.isArray(tw.sessionIds)) {
              const list = Array.isArray(localW.sessionIds) ? localW.sessionIds : (localW.sessionIds = []);
              for (const sid of tw.sessionIds) if (!list.includes(sid)) list.push(sid);
            }
            if (tw && typeof tw.title === 'string' && !localW.title) localW.title = tw.title;
            this.log(
              'info',
              `workspace.json 并集合并:远端工作区 ${wid}(${tw.title || tw.path}) 与本地 ${localId} 同路径,已合并其会话,不新增重复登记`,
            );
            continue;
          }
          oWs[wid] = tw;
          if (Array.isArray(ours.global.workspaceIds) && !ours.global.workspaceIds.includes(wid))
            ours.global.workspaceIds.push(wid);
          continue;
        }
        if (tw && Array.isArray(tw.sessionIds)) {
          ow.sessionIds = mergeIds(baseWs[wid]?.sessionIds, ow.sessionIds, tw.sessionIds);
        }
        if (tw && typeof tw.path === 'string') {
          if (!ow.path) ow.path = tw.path;
          if (!ow.title) ow.title = tw.title;
        }
      }
      if (theirs.global && Array.isArray(theirs.global.archivedSessionIds)) {
        ours.global.archivedSessionIds = mergeIds(
          base?.global?.archivedSessionIds,
          ours.global.archivedSessionIds,
          theirs.global.archivedSessionIds,
        );
      }
      // 并集后剔除幽灵:本机与云端(origin/<branch> 当前树)都没有文件的会话登记不保留(删除的会话不再"复活")
      try {
        const cfg = this.loadConfig();
        const localFiles = this.localSessionIds();
        const remoteFiles = await this.remoteSessionIds(cfg.branch);
        const alive = id => localFiles.has(id) || remoteFiles.has(id);
        if (Array.isArray(ours.global.archivedSessionIds))
          ours.global.archivedSessionIds = ours.global.archivedSessionIds.filter(alive);
        for (const w of Object.values(oWs)) if (Array.isArray(w.sessionIds)) w.sessionIds = w.sessionIds.filter(alive);
      } catch {
        /* 幽灵清理失败不阻断合并 */
      }
      fs.writeFileSync(path.join(this.home, f), JSON.stringify(ours, null, 2));
      this.log('info', '项目登记已合并，保留新增内容并尊重已删除的项目、归属和归档状态');
      return true;
    } catch (e) {
      this.log('warn', 'workspace.json 并集合并失败,改用单边保留: ' + String(e?.message || e));
      return false;
    }
  },

  /** 远端(origin/<branch> 当前树)上存在的会话 id 集合 */
  async remoteSessionIds(branch) {
    try {
      const r = await this.git(['ls-tree', '-r', '--name-only', `origin/${branch}`, '--', 'sessions/']);
      if (!this.ok(r) || !r.out) return new Set();
      const set = new Set();
      for (const line of r.out.split('\n')) {
        const id = sessionIdOfLogPath(line);
        if (id) set.add(id);
      }
      return set;
    } catch {
      return new Set();
    }
  },

  /** 本机会话 id 集合(sessions/ 下真实存在的会话目录;登记表自查/幽灵清理/并集合并共用) */
  localSessionIds() {
    const set = new Set();
    for (const s of this.scanSessions()) set.add(s.id);
    return set;
  },

  /** 工作区登记表里已登记的会话 id 集合(各工作区 sessionIds + archivedSessionIds 的并集)。
   *  用于比较「同步前后登记是否变化」——有会话被新登记(或取消登记)就说明运行中 dsh 的内存索引可能已过期。 */
  registeredSessionIds() {
    const set = new Set();
    try {
      const ws = parseWorkspaceRegistry(fs.readFileSync(path.join(this.home, 'storages', 'workspace.json')));
      if (Array.isArray(ws.global?.archivedSessionIds)) for (const s of ws.global.archivedSessionIds) set.add(s);
      for (const w of Object.values(ws.tables?.workspaces ?? {})) {
        if (w && Array.isArray(w.sessionIds)) for (const s of w.sessionIds) set.add(s);
      }
    } catch {
      /* 缺省 */
    }
    return set;
  },

  /**
   * 会话是否「开始过轮次」(即 DSH 语义里的非 blank)。
   *
   * DSH 客户端把「从未开始过轮次」的会话从侧栏过滤掉:
   *   dsh-client-ui-workspace/lib/client.js  sessionVisible():
   *     if (session.blank && session.id !== current) return false;
   *   且「未分组」分组只在 stray.length > 0 时创建 —— blank 会话既不在任何工作区,
   *   也不会出现在「未分组」里。
   * 未分组统计若把这些会话算进去,就会报出用户「看不见、也删不掉」的未分组:
   * 0.12.14 实测:default-workspace 里点过新会话但没发消息留下的两个空会话,
   * 让引导浮层/状态行的「N 个会话未分组」常驻。因此这里与侧栏口径对齐。
   *
   * 逐帧解压、命中即停(blank 会话很小,非空会话通常前几帧就命中),判定结果按
   * (文件, size, mtime) 缓存 —— 日志是追加写的,size/mtime 一变即失效。
   * 无法判定(读不出文件/帧损坏/末尾是不完整的行/无 zstd 支持)时返回 true
   * (保守:仍按未分组统计),宁可多报也不把真会话当空白静默忽略。
   * @param file 会话日志文件绝对路径
   * @returns true = 有轮次;false = 从未开始过轮次(blank)
   */
  sessionHasTurn(file) {
    let stat = null;
    try {
      stat = fs.statSync(file);
    } catch {
      return true;
    }
    const key = `${file}|${stat.size}|${stat.mtimeMs}`;
    const cached = this._turnCache.get(key);
    if (cached !== undefined) return cached;
    let result = null;
    try {
      const buf = fs.readFileSync(file);
      if (buf.subarray(0, 4).equals(ZSTD_MAGIC) && typeof zstdDecompressSync === 'function') {
        // 逐帧解压:zstdDecompressSync 一次只出首帧,用 bytesWritten 推进到下一帧;
        // 帧边界可能切断一行 JSON,所以保留最后一段不完整行做 carry。
        result = false;
        let offset = 0;
        let carry = '';
        while (offset < buf.length) {
          const { buffer, engine } = zstdDecompressSync(buf.subarray(offset), { info: true });
          const consumed = engine.bytesWritten;
          if (!consumed) {
            result = null;
            break;
          }
          const lines = (carry + buffer.toString('utf8')).split('\n');
          carry = lines.pop() ?? '';
          if (textHasTurnStart(lines.join('\n'))) {
            result = true;
            break;
          }
          offset += consumed;
        }
        // 收尾:末尾还有不完整的行 = 日志正被追加或被截断,无法断言「之后没有 turn/start」→ 判为未知
        if (result === false && carry) result = textHasTurnStart(carry) ? true : null;
      } else {
        const text = buf.toString('utf8');
        if (textHasTurnStart(text)) result = true;
        else result = text.length === 0 || text.endsWith('\n') ? false : null;
      }
    } catch {
      result = null;
    }
    if (result === null) result = true;
    this._turnCache.set(key, result);
    if (this._turnCache.size > 2000) this._turnCache.clear();
    return result;
  },

  /** Only grouping anomalies enter the repair count. Unowned logs left by a
   * deleted workspace and unowned archived sessions are separate context. */
  ungroupedSessionIds() {
    const live = this.hostGroupingState();
    if (live.available) return live.ungroupedIds;
    try {
      const disk = JSON.parse(fs.readFileSync(path.join(this.home, 'storages/workspace.json'), 'utf8'));
      return classifyGrouping(this, disk).ungroupedIds;
    } catch {
      return [];
    }
  },

  hostGroupingState() {
    return hostGroupingState(this);
  },

  /**
   * 幽灵登记清理:剔除 archivedSessionIds 与各工作区 sessionIds 里
   * 「本机与云端(origin/<branch> 当前树)都没有会话文件」的 id。
   * 这样删除的会话不会因为另一台电脑的登记表还留着而"删不掉";
   * 云端还活着的会话(id 有文件)则保留登记,保证对应关系跨机还原。
   */
  async pruneGhostRegistrations() {
    try {
      const cfg = this.loadConfig();
      const wsFile = path.join(this.home, 'storages', 'workspace.json');
      if (!fs.existsSync(wsFile)) return { ok: true, pruned: 0 };
      let ws;
      try {
        ws = JSON.parse(fs.readFileSync(wsFile, 'utf8'));
      } catch {
        return { ok: false, pruned: 0 };
      }
      const localFiles = this.localSessionIds();
      const remoteFiles = await this.remoteSessionIds(cfg.branch);
      const alive = id => localFiles.has(id) || remoteFiles.has(id);
      let pruned = 0;
      if (Array.isArray(ws.global?.archivedSessionIds)) {
        const before = ws.global.archivedSessionIds.length;
        ws.global.archivedSessionIds = ws.global.archivedSessionIds.filter(alive);
        pruned += before - ws.global.archivedSessionIds.length;
      }
      for (const w of Object.values(ws.tables?.workspaces ?? {})) {
        if (Array.isArray(w.sessionIds)) {
          const before = w.sessionIds.length;
          w.sessionIds = w.sessionIds.filter(alive);
          pruned += before - w.sessionIds.length;
        }
      }
      if (pruned) {
        fs.writeFileSync(wsFile, JSON.stringify(ws, null, 2));
        this.log('info', `登记表幽灵清理:剔除 ${pruned} 个本机与云端都没有文件的会话登记(删除后不再"复活")`);
      }
      return { ok: true, pruned };
    } catch (e) {
      this.log('warn', '登记表幽灵清理失败(不影响同步): ' + String(e?.message || e));
      return { ok: false, pruned: 0 };
    }
  },
};
