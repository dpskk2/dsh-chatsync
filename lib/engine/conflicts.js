// Part of the SyncEngine (lib/sync.js); moved verbatim from lib/sync.js.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { classifyFile, diffLeafPaths, mergeJsonByVmap, mergeVmap, mergeYamlByVmap } from '../merge.js';
import { parseYaml } from '../yaml.js';
import { currentFile, digest, restoreFile, safePath } from '../recovery.js';

export const conflictsMethods = {
  async captureConflicts(files, localHead, remoteHead, workspaceId = null, gitdir = null, root = this.home) {
    const ids = [];
    for (const file of files) {
      safePath(root, file);
      const blobs = await this.conflictBlobs(gitdir, root, file);
      const record = this.recovery.save({ kind: workspaceId ? 'ws' : 'main', workspaceId,
        path: file, localHead, remoteHead, status: 'pending', deviceId: this.actorId() },
      { local: blobs.ours, remote: blobs.theirs });
      ids.push(record.id);
    }
    return ids;
  },

  finishConflicts(ids, root) {
    for (const id of ids) {
      const record = this.recovery.read(id);
      const value = currentFile(safePath(root, record.path));
      const hash = value === null ? null : digest(value);
      const kept = hash === (record.versions.local.sha256 ?? null) ? 'local'
        : hash === (record.versions.remote.sha256 ?? null) ? 'remote' : 'merged';
      this.recovery.finish(id, { status: 'merged', kept, resultHash: hash });
    }
  },

  recoveryRoot(record) {
    if (['main', 'scope-backup', 'data-repair'].includes(record.kind)) return this.home;
    const ws = this.workspaces().find(w => w.id === record.workspaceId);
    if (!ws) throw new Error('此工作区已不在本机登记，请先重新连接工作区');
    const root = this.workspaceRealPathOf(ws, this.loadConfig());
    if (!root || !fs.existsSync(root)) throw new Error('本机工作区路径不可用');
    return root;
  },

  recoveryPreview(id) {
    const preview = this.recovery.preview(id);
    const current = currentFile(safePath(this.recoveryRoot(preview.record), preview.record.path));
    return { ...preview, currentHash: current === null ? null : digest(current),
      canRestore: (preview.record.kind === 'ws' && preview.record.status === 'merged')
        || (preview.record.kind === 'restore-backup' && preview.record.status === 'restored') };
  },

  async restoreRecovery(id, side, expectedHash) {
    if (this.inFlight) throw new Error('同步正在进行，请稍后恢复');
    const release = this.acquireProcessLock();
    if (!release) throw new Error('另一 DSH 进程正在同步，请稍后恢复');
    try {
      const record = this.recovery.read(id);
      return restoreFile(this.recovery, id, side, this.recoveryRoot(record), expectedHash);
    } finally { release(); }
  },

  /**
   * 冲突标记守卫:检查一组冲突文件是否仍残留 git 冲突标记(<<<<<<< / ======= / >>>>>>>)。
   * 任何残留都意味着分层合并写入失败——此时绝不能 add/commit,否则把标记当内容
   * 提交进仓库,浏览器/编辑器打开就是乱码或空白(曾导致 赶时间-初版.html 页面空白)。
   * @param base   工作树根目录绝对路径
   * @param files  待检查的相对路径列表
   * @returns 仍残留标记的文件相对路径数组(空 = 全部干净)
   */
  conflictMarkersRemain(base, files) {
    const bad = [];
    for (const f of files) {
      if (!f || f.includes('\0')) continue;
      try {
        const text = fs.readFileSync(path.join(base, f), 'utf8');
        if (/^<<<<<<< |^>>>>>>> |^=======$/m.test(text)) bad.push(f);
      } catch (e) {
        // 文件不存在(modify/delete 冲突且本机删除):无内容可残留标记,不算风险;
        // 其它读取失败(物化写入失败等)视为有风险,宁可中止合并
        if (e && e.code !== 'ENOENT') bad.push(f);
      }
    }
    return bad;
  },

  /** 主仓库里已被跟踪的历史冲突拷贝(.dsh-conflict-<ts>)。
   *  只查主仓库一次 ls-files,不遍历各工作区 —— pruneCacheConflicts 每轮同步都要用,
   *  走 outstandingConflicts 会给每个工作区起 2 次 git 子进程(实测 181ms/次)。 */
  mainConflictCopies() {
    const out = [];
    const r = this.gitSync(['ls-files', '--', ':(glob)**/*.dsh-conflict-*']);
    if (!this.ok(r)) return out;
    for (const line of String(r.out).split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const m = /^(.*)\.dsh-conflict-(.+)$/.exec(t);
      if (m) out.push({ kind: 'main', id: null, path: m[1], copy: m[0], conflictAt: m[2] });
    }
    return out;
  },

  /** 扫描主仓库 + 各工作区影子仓库,列出历史遗留的冲突拷贝(.dsh-conflict-<ts>)。
   *  新版分层合并引擎不再生成冲突拷贝,此方法仅用于迁移清理与只读审计。
   *  每次调用要给每个仓库起一次 git 子进程(4 工作区约 180ms),而同一轮同步里
   *  设置页/状态接口/工具常连续调用多次 → 结果缓存 15s,并在每轮同步结束时失效。
   *  (工作区冲突拷贝不在主仓库里,所以不能只扫主仓库。) */
  outstandingConflicts() {
    const now = Date.now();
    if (this._conflictsCache && now - this._conflictsCache.at < 15000) return this._conflictsCache.list;
    const cfg = this.loadConfig();
    const out = [];
    const scan = (gitFn, kind, wsId) => {
      const r = gitFn(['ls-files']);
      if (!this.ok(r)) return;
      for (const line of String(r.out).split('\n')) {
        const t = line.trim();
        const m = /^(.*)\.dsh-conflict-(.+)$/.exec(t);
        if (m) out.push({ kind, id: wsId, path: m[1], copy: m[0], conflictAt: m[2] });
      }
    };
    scan((a) => this.gitSync(a), 'main', null);
    if (cfg.workspaceSync !== false) {
      for (const ws of this.workspaces()) {
        const realPath = this.workspaceRealPathOf(ws, cfg);
        const gitdir = this.workspaceGitDir(ws.id);
        if (!realPath || !fs.existsSync(gitdir)) continue;
        scan((a) => this.gitWSync(gitdir, realPath, a), 'ws', ws.id);
      }
    }
    this._conflictsCache = { at: now, list: out };
    return out;
  },

  /* ================= 分层合并引擎(替换「双边保留 + 人工裁决」) ================= */

  /** crdt 文件的版本图 sidecar 路径(storages/sync-meta/<relpath>.vmap.json) */
  vmapPathOf(relPath) {
    return 'storages/sync-meta/' + String(relPath).replace(/\\/g, '/') + '.vmap.json';
  },

  /** 读 git 冲突三态 blob(:1 base / :2 ours / :3 theirs),主仓库与工作区影子仓库通用 */
  async conflictBlobs(gitdir, base, f) {
    const call = (a) => (gitdir ? this.gitBytesW(gitdir, base, a) : this.gitBytes(a));
    const read = async (stage) => {
      const r = await call(['show', stage + f]);
      return (this.ok(r) && Buffer.isBuffer(r.out)) ? r.out : null;
    };
    return { base: await read(':1:'), ours: await read(':2:'), theirs: await read(':3:') };
  },

  /** 字段级 CRDT 合并(crdt-json / crdt-yaml / crdt-meta)。成功返回 true 并已写回工作树+add。 */
  async mergeCrdtFile(f, type) {
    const vmapPath = this.vmapPathOf(f);
    const [b, vmB] = await Promise.all([
      this.conflictBlobs(null, this.home, f),
      this.conflictBlobs(null, this.home, vmapPath),
    ]);
    if (!b.ours || !b.theirs) return false;
    const text = (x) => (x ? x.toString('utf8') : null);
    const parseJson = (x) => { try { return x ? JSON.parse(text(x)) : undefined; } catch { return undefined; } };
    const vmapOf = (x) => { const v = parseJson(x); return (v && typeof v === 'object') ? v : {}; };

    if (type === 'crdt-meta') {
      const mergedVmap = mergeVmap(vmapOf(vmB.ours), vmapOf(vmB.theirs));
      this._writeMerged(f, Buffer.from(JSON.stringify(mergedVmap, null, 2) + '\n', 'utf8'));
      await this.git(['add', '--', f]);
      return true;
    }

    const oursVmap = vmapOf(vmB.ours);
    const theirsVmap = vmapOf(vmB.theirs);
    const mergedVmap = mergeVmap(oursVmap, theirsVmap);
    let outText = null;
    if (type === 'crdt-yaml') {
      const r = mergeYamlByVmap(text(b.base), text(b.ours), text(b.theirs), oursVmap, theirsVmap);
      if (!r.ok) return false;
      outText = r.value;
    } else {
      const bObj = parseJson(b.base), oObj = parseJson(b.ours), tObj = parseJson(b.theirs);
      if (oObj === undefined || tObj === undefined) return false;
      outText = JSON.stringify(mergeJsonByVmap(bObj, oObj, tObj, oursVmap, theirsVmap, ''), null, 2) + '\n';
    }
    this._writeMerged(f, Buffer.from(outText, 'utf8'));
    await this.git(['add', '--', f]);
    // 写回合并后的版本图(仅当有内容或任一侧存在版本图,避免引导期造空文件)
    if (Object.keys(mergedVmap.fields || {}).length || vmB.base || vmB.ours || vmB.theirs) {
      this._writeMerged(vmapPath, Buffer.from(JSON.stringify(mergedVmap, null, 2) + '\n', 'utf8'));
      await this.git(['add', '--', vmapPath]);
    }
    return true;
  },

  /** 写合并结果到工作树(目录自动创建;主仓库用) */
  _writeMerged(relPath, buf) {
    const target = path.join(this.home, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf);
  },

  /* ================= 提交时版本图(vmap)维护 —— 字段级 LWW 的时钟来源 ================= */

  /** 本机 CRDT actor id(UUID,持久化在 .dsh-sync.state.json,机器本地不上云) */
  actorId() {
    const sp = path.join(this.home, '.dsh-sync.state.json');
    let state = {};
    try { state = JSON.parse(fs.readFileSync(sp, 'utf8')) || {}; } catch { /* 缺省 */ }
    if (!state.crdtActor) {
      state.crdtActor = randomUUID();
      try { fs.writeFileSync(sp, JSON.stringify(state, null, 2) + '\n', 'utf8'); } catch { /* ignore */ }
    }
    return state.crdtActor;
  },

  /** 读 HEAD 版本的文件文本(无则 null) */
  async _headTextOf(f) {
    const r = await this.git(['show', 'HEAD:' + f]);
    return (this.ok(r) && r.out) ? r.out : null;
  },

  /** 读工作树文件文本(不存在返回 null) */
  _workTextOf(f) {
    const p = path.join(this.home, f);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  },

  /** 读某 crdt 文件当前的 vmap(工作树优先,否则 HEAD;都无返回 {}) */
  async _readVmap(vmapPath) {
    const wt = path.join(this.home, vmapPath);
    if (fs.existsSync(wt)) { try { const v = JSON.parse(fs.readFileSync(wt, 'utf8')); return (v && typeof v === 'object') ? v : {}; } catch {} }
    const r = await this.git(['show', 'HEAD:' + vmapPath]);
    if (this.ok(r) && r.out) { try { const v = JSON.parse(r.out); return (v && typeof v === 'object') ? v : {}; } catch {} }
    return {};
  },

  /**
   * 提交前给发生字段级变化的 crdt 文件(settings.yaml / package.json)更新版本图:
   * diff 工作树 vs HEAD → 变更叶子打上新 Lamport 时钟 { t: maxT+1, actor }。
   * 这保证「两机改同一字段」能按「后写胜」收敛(见 docs/merge-engine-refactor.md §5)。
   */
  async updateCrdtVmaps() {
    const st = await this.git(['status', '--porcelain']);
    if (!this.ok(st)) return;
    const changed = new Set();
    for (const line of String(st.out).split('\n')) {
      const p = line.slice(3).trim();
      if (!p) continue;
      const t = classifyFile(p);
      if ((t === 'crdt-json' || t === 'crdt-yaml') && p !== 'storages/workspace.json' && p !== '.credentials.yaml') changed.add(p);
    }
    if (!changed.size) return;
    const actor = this.actorId();
    for (const f of changed) {
      try {
        const vmapPath = this.vmapPathOf(f);
        const [headText, workText, oldVmap] = await Promise.all([
          this._headTextOf(f), this._workTextOf(f), this._readVmap(vmapPath),
        ]);
        if (workText == null) continue;
        let baseObj, newObj;
        if (classifyFile(f) === 'crdt-yaml') {
          const pn = parseYaml(workText); if (!pn.ok) continue;
          newObj = pn.value;
          const pb = headText != null ? parseYaml(headText) : { ok: true, value: undefined };
          if (!pb.ok) continue;
          baseObj = pb.value;
        } else {
          try { newObj = JSON.parse(workText); } catch { continue; }
          try { baseObj = headText != null ? JSON.parse(headText) : undefined; } catch { baseObj = undefined; }
        }
        const changedPaths = diffLeafPaths(baseObj, newObj);
        if (!changedPaths.size) continue;   // 仅键序/无实际字段变化 → 不 bump
        const fields = { ...(oldVmap.fields || {}) };
        let maxT = 0;
        for (const c of Object.values(fields)) if (c && typeof c.t === 'number' && c.t > maxT) maxT = c.t;
        const t = maxT + 1;
        for (const p of changedPaths) fields[p] = { t, actor };
        this._writeMerged(vmapPath, Buffer.from(JSON.stringify({ format: 1, path: f, fields }, null, 2) + '\n', 'utf8'));
      } catch (e) {
        this.log('warn', `版本图更新失败(不影响同步): ${f}: ${String(e?.message || e)}`);
      }
    }
  },

  /** 清理可再生缓存的旧冲突拷贝；提交留待正常同步检查、确认后上传。 */
  async pruneCacheConflicts() {
    try {
      const list = this.mainConflictCopies().filter((c) => /^storages\/session_projcache\//i.test(c.path || ''));
      if (!list.length) return { ok: true, pruned: 0 };
      for (const c of list) {
        try {
          const copyAbs = path.join(this.home, c.copy);
          if (fs.existsSync(copyAbs)) fs.rmSync(copyAbs, { force: true });
        } catch { /* ignore */ }
      }
      const st = await this.git(['status', '--porcelain']);
      if (this.ok(st) && String(st.out).trim()) {
        const added = await this.git(['add', '-A']);
        if (this.ok(added)) {
          const cm = await this.git(['commit', '-m', 'dsh-chatsync: 清理会话投影缓存冲突拷贝(可再生缓存,自动取本机)']);
          if (this.ok(cm)) {
            return { ok: true, pruned: list.length, committed: true };
          }
        }
      }
      return { ok: true, pruned: list.length };
    } catch (e) {
      this.log('warn', '缓存冲突拷贝清理失败(不影响同步): ' + String(e?.message || e));
      return { ok: false, pruned: 0 };
    }
  },

  /** P5 迁移:一次性清理历史 .dsh-conflict-<ts> 拷贝(内容本就在 git 历史里,删除不丢数据)。
   *  用 .dsh-sync.state.json 的 legacyConflictCleanup 标记保证只跑一次;仅主仓库,工作区遗留项由 sync_conflicts 只读列出。 */
  async migrateLegacyConflictCopies() {
    const sp = path.join(this.home, '.dsh-sync.state.json');
    let state = {};
    try { state = JSON.parse(fs.readFileSync(sp, 'utf8')) || {}; } catch { /* 缺省 */ }
    if (state.legacyConflictCleanup) return { ok: true, removed: 0, skipped: true };
    try {
      const list = this.mainConflictCopies().filter((c) => !/^storages\/session_projcache\//i.test(c.path || ''));
      if (!list.length) { state.legacyConflictCleanup = true; }
      else {
        for (const c of list) {
          const copyAbs = path.join(this.home, c.copy);
          if (fs.existsSync(copyAbs)) fs.rmSync(copyAbs, { force: true });
        }
        state.legacyConflictCleanup = true;
        const st = await this.git(['status', '--porcelain']);
        if (this.ok(st) && String(st.out).trim()) {
          const added = await this.git(['add', '-A']);
          if (this.ok(added)) {
            await this.git(['commit', '-m', 'dsh-chatsync: 清理历史冲突拷贝(新版已自动合并冲突,内容保留在 git 历史)']);
            // No separate push: the normal sync path scans this commit and its
            // unpublished history, then obtains any required preview approval.
          }
        }
      }
      try { fs.writeFileSync(sp, JSON.stringify(state, null, 2) + '\n', 'utf8'); } catch { /* ignore */ }
      return { ok: true, removed: list.length };
    } catch (e) {
      this.log('warn', '历史冲突拷贝清理失败(不影响同步): ' + String(e?.message || e));
      return { ok: false, removed: 0 };
    }
  },
};
