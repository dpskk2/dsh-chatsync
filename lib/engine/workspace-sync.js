// Part of the SyncEngine (lib/sync.js); moved verbatim from lib/sync.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSyncConfig, writeSyncConfig } from '../config-file.js';
import { syncProject } from '../project-sync.js';
import { parseWorkspaceRegistry } from '../workspace-registry.js';
import { canonicalWorkspacePath } from '../workspace-target.js';
import { parseSyncRemote } from '../remote.js';
import { checkWorkspaceSnapshotSizes, redactGitDiagnostic } from '../privacy.js';
import { reviewTransfer } from '../review.js';
import { humanSize, ts } from './format.js';

function workspaceGitFailure(operation, result) {
  const detail = redactGitDiagnostic(String(result.err || '').trim() || String(result.out || '').trim()
    || (result.timedOut ? 'Git 命令超时' : 'Git 退出码 ' + result.code));
  return Object.assign(new Error(`工作区 git ${operation} 失败: ${detail}`), { operation, gitError: detail });
}

export const workspaceSyncMethods = {
  /* ================= 工作区内容同步(影子 git 仓库;core.worktree 指向真实文件夹) ================= */

  /** 读取 DSH 工作区登记表,返回 [{ id, path, title }](来自 storages/workspace.json) */
  workspaces() {
    try {
      const ws = parseWorkspaceRegistry(fs.readFileSync(path.join(this.home, 'storages', 'workspace.json')));
      const tables = ws?.tables?.workspaces ?? {};
      const homeNorm = path.resolve(this.home);
      const out = [];
      for (const [id, w] of Object.entries(tables)) {
        if (!w || typeof w.path !== 'string' || !w.path) continue;
        // 跳过 DSH home 本身(.dsh)——它作为普通文件夹再同步会循环/带上密钥与 node_modules
        if (path.resolve(w.path) === homeNorm) continue;
        out.push({ id, path: w.path, title: typeof w.title === 'string' ? w.title : '' });
      }
      return out;
    } catch (error) { if (error.code === 'ENOENT') return []; throw new Error('工作区登记表无法读取或格式损坏，已停止同步：' + error.message); }
  },

  /** 工作区的影子仓库 git 目录(所有 git 元数据都在 .dsh 下,不在真实文件夹里) */
  workspaceGitDir(id) { return path.join(this.home, 'workspace-repos', id + '.git'); },

  workspaceBranchOf(cfg, id) { return (cfg.workspaceBranchPrefix || 'ws') + '/' + id; },

  /** 本机专属的工作区路径覆盖(不随主仓库同步;跨机路径不一致时用) */
  localWorkspacePathOverride(id) {
    const file = path.join(this.home, 'storages', 'workspace-local-paths.json');
    let value;
    try { value = readSyncConfig(file); }
    catch { throw new Error('本机项目保存位置配置无法读取，已停止该项目；请修复 workspace-local-paths.json，未改用其他目录。'); }
    if (value.overrides !== undefined && (!value.overrides || typeof value.overrides !== 'object' || Array.isArray(value.overrides)))
      throw new Error('本机项目保存位置格式损坏，未改用其他目录。');
    const target = value.overrides?.[id];
    if (target !== undefined && (typeof target !== 'string' || !path.isAbsolute(target))) throw new Error('本机项目保存位置不是完整目录，未改用其他目录。');
    return target || null;
  },

  setLocalWorkspacePath(id, p) {
    const file = path.join(this.home, 'storages', 'workspace-local-paths.json');
    let j = {};
    try { j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) { if (e.code !== 'ENOENT') throw new Error('本机路径配置损坏，原件保留，请先修复'); }
    if (!j.overrides || typeof j.overrides !== 'object') j.overrides = {};
    if (p) { j.overrides[id] = String(p); }
    else { delete j.overrides[id]; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeSyncConfig(file, j);
    return p;
  },

  /**
   * 解析工作区在【本机】应使用的真实文件夹路径。
   * - workspaceBase 配置优先:把工作区统一放到某目录下(按文件夹名)。
   * - 若记录路径在本机已存在 → 直接使用(源机器/已有文件夹)。
   * - 否则跨机重映射:Windows 下 C:\Users\<name>\... → 本机主目录\<相对部分>,换用户名也能对上。
   * - 都失败则返回记录的绝对路径(尽力创建)。
   */
  workspacePathOf(recorded, cfg) {
    if (!recorded) return null;
    const norm = String(recorded).replace(/\//g, path.sep);
    const base = (cfg.workspaceBase || '').trim();
    if (base) return path.join(base, path.basename(norm));
    const home = os.homedir();
    if (path.isAbsolute(norm) && fs.existsSync(norm)) return norm;
    const m = /^([A-Za-z]:\\Users\\[^\\]+)\\(.*)$/i.exec(norm);
    if (m && m[2]) return path.join(home, m[2]);
    return norm;
  },

  /** 确保工作区影子仓库构造完毕(init bare + core.worktree + 身份 + origin + 忽略规则) */
  async ensureWorkspaceMirror(id, realPath, cfg) {
    const gitdir = this.workspaceGitDir(id);
    const branch = this.workspaceBranchOf(cfg, id);
    const checked = async args => {
      const result = await this.gitW(gitdir, realPath, args);
      if (!this.ok(result)) throw workspaceGitFailure(args[0], result);
      return result;
    };
    if (!fs.existsSync(gitdir)) {
      fs.mkdirSync(path.dirname(gitdir), { recursive: true });
      const init = await this.git(['init', '--bare', gitdir]);
      if (!this.ok(init)) throw workspaceGitFailure('init', init);
      await checked(['symbolic-ref', 'HEAD', 'refs/heads/' + branch]);
      this.log('info', `已初始化工作区影子仓库: ${realPath} -> ${gitdir}`);
    }
    // Read repository-local values every round: the user or another process can
    // change identity, worktree or refspec while this engine remains alive.
    const want = {
      'core.bare': 'false', 'core.worktree': realPath,
      'core.autocrlf': 'false', 'core.longpaths': 'true',
      'core.safecrlf': 'false', 'commit.gpgsign': 'false',
      'user.name': cfg.gitUserName, 'user.email': cfg.gitUserEmail,
    };
    if (cfg.remote) {
      want['remote.origin.url'] = cfg.remote;
      want['credential.helper'] = parseSyncRemote(cfg.remote)?.provider === 'github' && await this.ghAvailable()
        ? '!gh auth git-credential' : 'manager';
      want['remote.origin.fetch'] = '+refs/heads/' + branch + ':refs/remotes/origin/' + branch;
    }
    const cur = await checked(['config', '--local', '--null', '--list']);
    const got = new Map();
    for (const item of cur.out.split('\0')) {
      const split = item.indexOf('\n');
      if (split < 0) continue;
      const key = item.slice(0, split), value = item.slice(split + 1);
      got.set(key, [...(got.get(key) || []), value]);
    }
    for (const [key, value] of Object.entries(want)) {
      const current = got.get(key);
      if (current?.length === 1 && current[0] === value) continue;
      await checked(['config', '--local', '--replace-all', key, value]);
    }
    // 忽略规则写入影子仓库的 info/exclude(不落在真实文件夹里),排除 .git/嵌套git仓库 与 node_modules 等
    const excludes = ['.git', '*.chatsync-backups', 'node_modules', 'node_modules/', ...(cfg.workspaceExtraIgnore || [])];
    const exclPath = path.join(gitdir, 'info', 'exclude');
    try { fs.mkdirSync(path.dirname(exclPath), { recursive: true }); } catch { /* ignore */ }
    try {
      const lines = [...new Set(excludes.map((x) => String(x).replace(/\/+$/, '') + '/'))].join('\n') + '\n';
      fs.writeFileSync(exclPath, lines, 'utf8');
    } catch { /* ignore */ }
    // 嵌套 git 仓库自动排除(否则父仓库 add 出 gitlink,嵌套仓库工作树一有改动父仓库 commit 必失败;
    // 嵌套仓库内容由各自仓库自行管理/备份)
    try {
      const nested = [];
      let entries = [];
      try { entries = fs.readdirSync(realPath, { withFileTypes: true }); } catch { entries = []; }
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        if (fs.existsSync(path.join(realPath, ent.name, '.git'))) nested.push(ent.name);
      }
      if (nested.length) {
        const excl = path.join(gitdir, 'info', 'exclude');
        const cur = fs.existsSync(excl) ? fs.readFileSync(excl, 'utf8') : '';
        const addLines = nested.map((n) => n.replace(/[\\/]+$/, '') + '/');
        const merged = [...new Set([...cur.split('\n').filter(Boolean), ...addLines])].join('\n') + '\n';
        fs.writeFileSync(excl, merged, 'utf8');
        for (const n of nested) await this.gitW(gitdir, realPath, ['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', n]);
        this.log('info', `工作区 ${id} 内检测到嵌套 git 仓库(${nested.join(', ')})已自动排除(内容由各自仓库自行管理)`);
      }
    } catch { /* ignore */ }
    return true;
  },

  /** 工作区有未提交变更则 add + commit;失败抛出 Git 原因,取回前必须先保存快照。 */
  async commitWorkspaceIfDirty(gitdir, realPath, cfg, force = false) {
    const unresolved = await this.gitW(gitdir, realPath, ['diff', '--name-only', '--diff-filter=U', '-z']);
    if (!this.ok(unresolved) || unresolved.out) throw new Error('项目存在未完成的合并，已停止提交；原件保留。');
    const st = await this.gitW(gitdir, realPath, ['status', '--porcelain']);
    if (!this.ok(st)) throw workspaceGitFailure('status', st);
    if (!st.out.trim()) return 'clean';
    const throttleMs = force ? 0 : Math.max(0, (Number(cfg.minCommitIntervalSeconds) || 0) * 1000);
    if (Date.now() - (this.lastCommitAt || 0) < throttleMs) return 'throttled';
    const added = await this.gitW(gitdir, realPath, ['add', '-A']);
    if (!this.ok(added)) throw workspaceGitFailure('add', added);
    try {
      const oversized = cfg.remote ? await checkWorkspaceSnapshotSizes(this, gitdir, realPath) : [];
      if (oversized.length) {
        this.recordPrivacyReport({ label: '工作区 ' + path.basename(realPath), root: realPath,
          workspaceId: path.basename(gitdir, '.git'), stage: 'before-commit', findings: oversized });
        const limits = [...new Set(oversized.map(file => file.limit / 1048576))].join(' / ');
        throw new Error(`工作区含超过单文件检查上限（${limits} MiB）的文件，未生成快照；请移出同步范围后重试。`);
      }
    } catch (error) {
      if (error.code === 'SYNC_CANCELLED') throw error;
      // The mirror index is owned by this engine. Drop the rejected staging,
      // without touching project files, so a new ignore rule works on retry.
      const head = await this.rev('HEAD', gitdir, realPath);
      const restored = await this.gitW(gitdir, realPath, ['read-tree', head || '--empty']);
      if (!this.ok(restored)) throw workspaceGitFailure('read-tree', restored);
      throw error;
    }
    const cm = await this.gitW(gitdir, realPath, ['commit', '-m', `${cfg.commitMessage} [${path.basename(realPath) || realPath}] (${ts()})`]);
    if (!this.ok(cm)) throw workspaceGitFailure('commit', cm);
    this.lastCommitAt = Date.now();
    this.commitsSinceGc += 1;
    return 'committed';
  },

  /** 工作区在本机的实际路径(本机覆盖 > 记录路径/主目录重映射) */
  workspaceRealPathOf(ws, cfg) {
    return this.localWorkspacePathOverride(ws.id) || this.workspacePathOf(ws.path, cfg);
  },

  /**
   * 孤儿工作区影子仓库自查:登记表里已不存在的工作区(工作区被删除 / 并集去重换了 id),
   * 其 workspace-repos/<id>.git 会永久残留 —— 实测本机 156MB 里 153MB 是孤儿。
   * 这里只**报告**(不自动删:那是用户数据,删除应由用户决定),每 24h 最多一次。
   */
  reportOrphanWorkspaceRepos(cfg) {
    const now = Date.now();
    if (now - (this._orphanCheckedAt || 0) < 24 * 3600 * 1000) return null;
    this._orphanCheckedAt = now;
    if (cfg.workspaceSync === false) return null;
    const dir = path.join(this.home, 'workspace-repos');
    let entries = [];
    try { entries = fs.readdirSync(dir).filter((n) => n.endsWith('.git')); } catch { return null; }
    if (!entries.length) return null;
    const live = new Set(this.workspaces().map((w) => w.id + '.git'));
    const sizeOf = (p) => {
      let total = 0;
      const walk = (q) => {
        let st = null;
        try { st = fs.statSync(q); } catch { return; }
        if (st.isFile()) { total += st.size; return; }
        let names = [];
        try { names = fs.readdirSync(q); } catch { return; }
        for (const n of names) walk(path.join(q, n));
      };
      walk(p);
      return total;
    };
    const orphans = entries.filter((n) => !live.has(n));
    if (!orphans.length) return null;
    let bytes = 0;
    for (const n of orphans) bytes += sizeOf(path.join(dir, n));
    this.log('info', `工作区影子仓库:${orphans.length} 个已不在登记表中(共 ${humanSize(bytes)},占 ${path.join(this.home, 'workspace-repos')});确认不再需要可手工删除这些 <工作区id>.git 目录回收空间`);
    return { count: orphans.length, bytes };
  },

  /** 同步单个工作区:确保真实文件夹存在(目标机缺则创建),把真实文件夹内容(以其为工作树)
   *  提交到影子仓库,并与远端 ws/<id> 分支对齐(快进/推送/合并,冲突保留本地并备份远端)。 */
  async syncWorkspace(ws, cfg, reason, opts = {}) {
    return syncProject(this, ws, cfg, reason, opts);
  },

  // Internal: every checkout/merge/reset below targets an isolated project tree.
  async syncWorkspaceTree(ws, cfg, reason, opts, realPath) {
    const id = ws.id;
    const gitdir = this.workspaceGitDir(id);
    const branch = this.workspaceBranchOf(cfg, id);
    // 目标机缺文件夹 → 自动创建(满足需求;路径按本机主目录重映射,换用户名也能对上)
    try { fs.mkdirSync(realPath, { recursive: true }); }
    catch (e) { this.log('error', `工作区 ${id} 无法创建目录 ${realPath}: ${e?.message || e}`); return { id, error: 'mkdir', path: realPath }; }
    if (!(await this.ensureWorkspaceMirror(id, realPath, cfg))) return { id, error: 'ensure-repo', path: realPath };

    const label = ws.title || path.basename(realPath) || id;
    this.step('ws', `同步工作区 ${label}…`);
    let remoteHead = null;
    let fetchFailed = false;
    if (cfg.remote) {
      const rf = await this.runWithRetry('fetch', '工作区 ' + (label || id), ['fetch', 'origin', '--prune'], { gitdir, realPath, timeoutMs: 180000, onProgress: (d) => this.liveTransfer('fetch', '工作区 ' + (label || id), d) });
      if (this.ok(rf)) remoteHead = await this.rev('refs/remotes/origin/' + branch, gitdir, realPath);
      else {
        // An exact fetch refspec also fails for a genuinely new workspace branch.
        // Only a successful remote query proving absence permits first upload.
        const probe = await this.gitW(gitdir, realPath, ['ls-remote', '--heads', 'origin', 'refs/heads/' + branch]);
        fetchFailed = !this.ok(probe) || !!probe.out.trim();
        if (fetchFailed) this.log('warn', `工作区 ${id} fetch 失败(远端不可达?仅本地快照): ${rf.err.trim().split('\n')[0] || rf.code}`);
      }
    }
    const localBefore = await this.rev('HEAD', gitdir, realPath);
    if (opts.uploadOnly && remoteHead !== null && localBefore !== remoteHead
      && !(localBefore && await this.isAncestor(remoteHead, localBefore, gitdir, realPath)))
      return { id, error: '工作区远端有待取回更新，本地改动保留，请手动同步。', path: realPath };
    // 快路径:本地与远端同头 + 工作树干净 → 本轮没有任何可提交/可推送的东西。
    // 常见情况(两台电脑都空闲时点同步)下省掉 commit/add/status 等 4~5 次 git 子进程。
    // forceCommit 只表示「不受提交节流限制」(手动触发),不代表一定有变更,故不排除此路径;
    // 无 remote(仅本地快照)不走此路径。工作树脏、或影子仓库缺 core.worktree 时也不会命中。
    if (cfg.remote && remoteHead !== null) {
      const localHead0 = await this.rev('HEAD', gitdir, realPath);
      if (localHead0 === remoteHead) {
        const stClean = await this.gitW(gitdir, realPath, ['status', '--porcelain']);
        if (this.ok(stClean) && !String(stClean.out).trim()) {
          return { id, committed: false, pushed: false, pulled: false, path: realPath };
        }
      }
    }
    let commitRes;
    try { commitRes = await this.commitWorkspaceIfDirty(gitdir, realPath, cfg, opts.forceCommit === true); }
    catch (error) {
      if (error.code === 'SYNC_CANCELLED') throw error;
      this.log('error', error.message);
      return { id, error: '工作区快照未保存，已停止取回以保留本机文件。\n' + error.message,
        operation: error.operation, gitError: error.gitError, path: realPath };
    }
    let committed = commitRes === 'committed';
    if (remoteHead) {
      const review = await reviewTransfer(this, 'download', remoteHead, branch, gitdir, realPath);
      if (review) return { id, committed, error: '同步已暂停，等待确认预览', path: realPath };
    }
    if (fetchFailed) return { id, committed, pushed: false, pulled: false, error: 'fetch', path: realPath };

    if (!cfg.remote) return { id, committed, pushed: false, pulled: false, path: realPath };
    return this._reconcileWorkspace({ id, gitdir, branch, label, realPath }, cfg, reason, commitRes, committed, remoteHead);
  },

  /** 已取得远端头:按祖先关系首次推送、整体取回、推送或快进,其余进入合并。 */
  async _reconcileWorkspace({ id, gitdir, branch, label, realPath }, cfg, reason, commitRes, committed, remoteHead) {
    let localHead = await this.rev('HEAD', gitdir, realPath);
    // 远端无该分支 → 首次推送
    if (remoteHead === null) {
      // 空工作区(没有可提交内容):跳过推送,不算失败 —— 目标机会自动创建该文件夹,DSH 归组校验需要它存在
      if (localHead === null) {
        this.log('info', `[${reason}] 工作区 ${id} 内容为空,跳过推送(目标机会自动创建该文件夹)`);
        return { id, committed, pushed: false, pulled: false, empty: true, path: realPath };
      }
      const p = await this.runWithRetry('push', '工作区 ' + (label || id), ['push', '-u', 'origin', branch], { gitdir, realPath, timeoutMs: 180000, onProgress: (d) => this.liveTransfer('push', '工作区 ' + (label || id), d) });
      if (this.ok(p)) return { id, committed, pushed: true, path: realPath };
      this.log('error', `工作区 ${id} push 失败: ${p.err.trim().split('\n')[0] || p.code}`);
      return { id, committed, pushed: false, error: 'push', path: realPath };
    }
    // 本地无提交 → 从远端整体取回(目标机首次)
    if (localHead === null) {
      const rs = await this.gitW(gitdir, realPath, this.sendGuard
        ? ['merge', '--ff-only', `origin/${branch}`]
        : ['reset', '--hard', `origin/${branch}`]);
      if (this.ok(rs)) { this.log('info', `[${reason}] 工作区 ${id} 已从远端取回内容 -> ${realPath}`); return { id, committed, pushed: false, pulled: 'reset', path: realPath }; }
      this.log('error', `工作区 ${id} 从远端取回失败: ${rs.err.trim()}`); return { id, committed, error: 'reset', path: realPath };
    }
    if (localHead === remoteHead) {
      if (committed) {
        const p = await this.runWithRetry('push', '工作区 ' + (label || id), ['push', 'origin', branch], { gitdir, realPath, timeoutMs: 180000, onProgress: (d) => this.liveTransfer('push', '工作区 ' + (label || id), d) });
        if (!this.ok(p)) this.log('error', `工作区 ${id} push 失败: ${p.err.trim().split('\n')[0] || p.code}`);
        return { id, committed, pushed: this.ok(p), ...(!this.ok(p) && { error: 'push' }), path: realPath };
      }
      return { id, committed: false, pushed: false, pulled: false, path: realPath };
    }
    // 节流攒下未提交变更 → 强制提交
    if (commitRes === 'throttled') {
      const forced = await this.commitWorkspaceIfDirty(gitdir, realPath, cfg, true);
      if (forced === 'committed') committed = true;
      localHead = await this.rev('HEAD', gitdir, realPath);
    }
    // 本地领先远端 → 推送
    if (await this.isAncestor(remoteHead, localHead, gitdir, realPath)) {
      const p = await this.runWithRetry('push', '工作区 ' + (label || id), ['push', 'origin', branch], { gitdir, realPath, timeoutMs: 180000, onProgress: (d) => this.liveTransfer('push', '工作区 ' + (label || id), d) });
      if (this.ok(p)) return { id, committed, pushed: true, path: realPath };
      this.log('error', `工作区 ${id} push 失败: ${p.err.trim().split('\n')[0] || p.code}`);
      return { id, committed, pushed: false, error: 'push', path: realPath };
    }
    // 远端领先本地 → 快进拉取
    if (await this.isAncestor(localHead, remoteHead, gitdir, realPath)) {
      this.step('ws', `拉取工作区 ${label}…`);
      const mg = await this.gitW(gitdir, realPath, ['merge', '--ff-only', `origin/${branch}`]);
      if (this.ok(mg)) { this.log('info', `[${reason}] 工作区 ${id} 已快进同步`); return { id, committed, pushed: false, pulled: 'ff', path: realPath }; }
      const stNow = await this.gitW(gitdir, realPath, ['status', '--porcelain']);
      if (!(this.ok(stNow) && !stNow.out.trim())) { this.log('warn', `工作区 ${id} 工作树不干净,跳过 reset`); return { id, committed, pulled: false, path: realPath }; }
      if (this.sendGuard) return { id, committed, error: '工作区取回未完成；本机修改保留，下次同步重试。', path: realPath };
      const rs = await this.gitW(gitdir, realPath, ['reset', '--hard', `origin/${branch}`]);
      if (this.ok(rs)) return { id, committed, pulled: 'reset', path: realPath };
      this.log('error', `工作区 ${id} 快进同步失败: ${mg.err.trim()}`); return { id, committed, error: 'pull', path: realPath };
    }
    return this._mergeWorkspace({ id, gitdir, branch, label, realPath }, reason, committed, localHead, remoteHead);
  },

  async _mergeWorkspace({ id, gitdir, branch, label, realPath }, reason, committed, localHead, remoteHead) {
    // 双方都有新提交 → merge;冲突保留本地,远端先备份
    this.step('ws', `合并工作区 ${label}…`);
    let mg = await this.gitW(gitdir, realPath, ['merge', '--no-edit', `origin/${branch}`]);
    let unrelated = false;
    const mergeHeadExists = fs.existsSync(path.join(gitdir, 'MERGE_HEAD'));
    if (!this.ok(mg) && !mergeHeadExists) {
      const cf0 = await this.gitW(gitdir, realPath, ['diff', '--name-only', '--diff-filter=U', '-z']);
      const noConflicts = !this.ok(cf0) || !cf0.out.trim();
      if (noConflicts) { unrelated = true; mg = await this.gitW(gitdir, realPath, ['merge', '--no-edit', '--allow-unrelated-histories', `origin/${branch}`]); }
    }
    if (this.ok(mg)) {
      const p = await this.runWithRetry('push', '工作区 ' + (label || id), ['push', 'origin', branch], { gitdir, realPath, timeoutMs: 180000, onProgress: (d) => this.liveTransfer('push', '工作区 ' + (label || id), d) });
      if (!this.ok(p)) this.log('error', `工作区 ${id} 合并后推送失败: ${p.err.trim().split('\n')[0] || p.code}`);
      return { id, committed, pushed: this.ok(p), pulled: 'merge', unrelated, ...(!this.ok(p) && { error: 'push' }), path: realPath };
    }
    const cf = await this.gitW(gitdir, realPath, ['diff', '--name-only', '--diff-filter=U', '-z']);
    const conflicts = this.ok(cf) ? cf.out.split('\0').filter(Boolean) : [];
    let recoveryIds;
    try { recoveryIds = await this.captureConflicts(conflicts, localHead, remoteHead, id, gitdir, realPath); }
    catch (e) { await this.gitW(gitdir, realPath, ['merge', '--abort']); return { id, committed, error: '无法保存冲突原件：' + e.message, path: realPath }; }
    const backup = unrelated ? null : await this.backupRemoteHead(gitdir, realPath, remoteHead);
    const backupBranch = backup?.branch || null;
    if (unrelated) {
      for (const f of conflicts) await this.gitW(gitdir, realPath, ['checkout', '--theirs', '--', f]);
    } else {
      // 工作区内容全是 opaque 文件:真冲突时确定性取本机,远端版本在 backup 分支 + origin 历史(零人工裁决)
      for (const f of conflicts) {
        if (!f || f.includes('\0')) continue;
        await this.gitW(gitdir, realPath, ['checkout', '--ours', '--', f]);
      }
    }
    // 守卫:任何冲突文件仍残留合并标记 → 中止合并,绝不把标记提交/推送(标记会让页面/文档打开为空白或乱码)
    const stillMarked = this.conflictMarkersRemain(realPath, conflicts);
    if (stillMarked.length) {
      await this.gitW(gitdir, realPath, ['merge', '--abort']);
      this.log('error', `工作区 ${id} 合并冲突无法安全物化(文件仍含冲突标记: ${stillMarked.join(', ')}),已中止合并,本地状态未变;请手工解决后重新同步`);
      return { id, committed, error: 'merge-markers', path: realPath };
    }
    const done = await this.gitW(gitdir, realPath, ['add', '-A']);
    const cm = this.ok(done) ? await this.gitW(gitdir, realPath, ['commit', '--no-edit']) : { code: 1 };
    if (!this.ok(cm)) {
      await this.gitW(gitdir, realPath, ['merge', '--abort']);
      this.log('error', `工作区 ${id} 合并收尾失败,已中止(本地状态未变)`);
      return { id, committed, error: 'merge', path: realPath };
    }
    this.finishConflicts(recoveryIds, realPath);
    this.log('info', `[${reason}] 工作区 ${id} 双方都有新提交,自动合并;${conflicts.length} 个冲突文件已处理，双方原件可在恢复中心预览`);
    const p = await this.runWithRetry('push', '工作区 ' + (label || id), ['push', 'origin', branch], { gitdir, realPath, timeoutMs: 180000, onProgress: (d) => this.liveTransfer('push', '工作区 ' + (label || id), d) });
    if (!this.ok(p)) this.log('error', `工作区 ${id} 合并后推送失败: ${p.err.trim().split('\n')[0] || p.code}`);
    return {
      id, committed, pushed: this.ok(p), pulled: 'merge',
      conflicts, conflictCopies: [], backupBranch, backupPushed: backup?.pushed ?? false, ...(!this.ok(p) && { error: 'push' }), path: realPath,
    };
  },

  /** 同步全部已登记工作区;返回 { total, synced, pushed, pulled, errors } */
  async syncAllWorkspaces(cfg, reason, opts) {
    if (cfg.workspaceSync === false) return { skipped: 'disabled', total: 0, synced: 0, pushed: 0, pulled: 0, errors: [] };
    if (this.gitMissing) return { skipped: 'git-not-found', total: 0, synced: 0, pushed: 0, pulled: 0, errors: [] };
    const list = this.workspaces();
    if (!list.length) return { total: 0, synced: 0, pushed: 0, pulled: 0, errors: [] };
    const targets = list.map(ws => ({ ws, root: canonicalWorkspacePath(this.workspaceRealPathOf(ws, cfg)) }));
    const collisions = new Set();
    for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i].root, b = targets[j].root;
      if (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep)) {
        collisions.add(targets[i].ws.id); collisions.add(targets[j].ws.id);
      }
    }
    if (collisions.size) return { total: list.length, synced: 0, pushed: 0, pulled: 0,
      errors: list.filter(ws => collisions.has(ws.id)).map(ws => ({ id: ws.id, title: ws.title,
        path: this.workspaceRealPathOf(ws, cfg), error: '项目目标目录重叠，请为这些项目选择不同的本机目录后重试；未传输项目文件。' })) };
    const errors = [];
    const conflictCopies = [];
    const created = [];
    const backups = [];
    let synced = 0, pushed = 0, pulled = 0;
    // 各工作区是独立影子仓库,可并行同步:网络往返是主要耗时,串行会把每个工作区的
    // fetch+push 延迟加起来(网络抖动时尤甚),并行能显著缩短总时长
    const existedBefore = new Map(list.map((ws) => [ws.id, (() => { try { return fs.existsSync(this.workspaceRealPathOf(ws, cfg)); } catch { return true; } })()]));
    const results = await Promise.all(list.map((ws) => (async () => {
      try { return await this.syncWorkspace(ws, cfg, reason, opts); }
      catch (e) {
        return { id: ws.id, path: this.workspaceRealPathOf(ws, cfg), error: String(e?.message || e),
          operation: e?.operation, gitError: e?.gitError };
      }
    })()));
    for (const r of results) {
      if (r.backupBranch) backups.push({ id: r.id, branch: r.backupBranch, pushed: r.backupPushed === true });
      if (r.error) errors.push({ ...r, title: '' });
      else {
        synced++;
        if (r.pushed) pushed++;
        if (r.pulled) pulled++;
        if (Array.isArray(r.conflictCopies) && r.conflictCopies.length) conflictCopies.push(...r.conflictCopies);
        // 目标机原本没有该文件夹、本次同步后出现了 → 记入"本机新创建"(客户端可提示换位置)
        if (!(existedBefore.get(r.id) === true) && r.path && fs.existsSync(r.path)) {
          const w = list.find((x) => x.id === r.id);
          created.push({ id: r.id, title: (w && w.title) || path.basename(r.path) || r.id, path: r.path, recorded: w && w.path });
        }
      }
    }
    // 补全错误的标题/路径信息(并行结果里没有原 ws 对象,从登记表补查)
    if (errors.length) {
      const byId = new Map(list.map((ws) => [ws.id, ws]));
      for (const e of errors) {
        const w = byId.get(e.id);
        if (w) { e.title = w.title; e.path ||= this.workspaceRealPathOf(w, cfg); }
      }
    }
    return { total: list.length, synced, pushed, pulled, errors, conflictCopies, created, backups };
  },
};
