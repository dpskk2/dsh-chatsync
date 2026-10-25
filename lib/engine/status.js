// Part of the SyncEngine (lib/sync.js); moved verbatim from lib/sync.js.
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL_DATA, recoveryCategory, safePath } from '../recovery.js';
import { handoffStatus } from '../handoff.js';
import { scopeMirrorPath, scopedPreview } from '../scope.js';
import { pendingSessionTransfers } from '../session-transfer.js';
import { SyncEngine } from '../sync.js';

export const statusMethods = {
  readHandoff() {
    try { return JSON.parse(fs.readFileSync(safePath(this.home, LOCAL_DATA + '/handoff.json'), 'utf8')); }
    catch { return null; }
  },

  handoffStatus() { return handoffStatus(this); },

  async localPreview({ workspaceOnly = false } = {}) {
    const cfg = this.loadConfig();
    if (!this._isolatedTransport && !workspaceOnly) return scopedPreview(this, cfg, SyncEngine);
    if (!workspaceOnly && !fs.existsSync(path.join(this.home, '.git'))) return { initialized: false, remoteFresh: false,
      scopes: [], hint: '尚未建立本地快照；首次同步范围请查看同步内容说明' };
    const inspect = async (kind, gitdir = null, root = this.home, workspaceId = null) => {
      const r = gitdir ? await this.gitW(gitdir, root, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all'])
        : await this.git(['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all']);
      if (!this.ok(r)) return { kind, workspaceId, error: '无法读取本地变化' };
      const rows = r.out.split('\0');
      const counts = { added: 0, modified: 0, deleted: 0 };
      let executable = 0;
      for (let i = 0; i < rows.length; i++) {
        if (!rows[i]) continue;
        const code = rows[i].slice(0, 2), file = rows[i].slice(3);
        if (code.includes('R') || code.includes('C')) i++;
        if (code.includes('D')) counts.deleted++; else if (code === '??' || code.includes('A')) counts.added++; else counts.modified++;
        if (/(?:^|\/)(?:patches\/|cordis[^/]*\.ya?ml$)|\.(?:[cm]?js|ps1|cmd|bat|sh)$/i.test(file)) executable++;
      }
      return { kind, workspaceId, ...counts, executable };
    };
    const scopes = workspaceOnly ? [] : [await inspect('main')];
    if (cfg.workspaceSync !== false) {
      for (const ws of this.workspaces()) {
        const dir = this.workspaceGitDir(ws.id), root = this.workspaceRealPathOf(ws, cfg);
        if (root && fs.existsSync(dir) && fs.existsSync(root)) scopes.push(await inspect('workspace', dir, root, ws.id));
        else scopes.push({ kind: 'workspace', workspaceId: ws.id, initialized: false });
      }
    }
    return { initialized: true, remoteFresh: false, scopes,
      hint: '只读本地变化；未连接远端，未统计远端尚未取回的改动。首次或未初始化的项目不提供数量。' };
  },

  doctor() {
    const cfg = this.loadConfig();
    return { gitAvailable: this.ok(this.gitSync(['--version'])), node: process.versions.node,
      repositoryInitialized: fs.existsSync(path.join(scopeMirrorPath(this.home, cfg), '.git')), remoteConfigured: Boolean(cfg.remote),
      mode: cfg.mode, workspaceSync: cfg.workspaceSync !== false, busy: Boolean(this.inFlight),
      recoveryCount: this.recovery.list().filter(r => recoveryCategory(r) === 'attention').length,
      encrypted: false, hostValidation: '未通过此诊断验证宿主页面或另一台电脑' };
  },

  /** fetch/push 带一次快速重试:网络瞬时抖动时重试一次常能成功(已成功的 push 重试=Everything up-to-date,安全);
   *  但「凭据缺失/认证失败」直接秒级放弃(重试只会再弹一次窗、再等一个超时)。
   *  op='fetch'|'push';gitdir/realPath 给定时走工作区影子仓库,否则为主仓库。 */
  hasPendingSessionImport() {
    return Object.keys(pendingSessionTransfers(this)).length > 0
      || this.recovery.list().some(record => Object.values(record.imports || {}).some(attempt => attempt.status !== 'verified'));
  },

  recordPrivacyReport(report) {
    if (report.workspaceId) {
      const root = this._projectRoots?.get(this.workspaceGitDir(report.workspaceId));
      if (root) report = { ...report, root };
    }
    this._privacyReport = report;
    (this._privacyReports ||= []).push(report);
    this.onPrivacyBlocked?.(report);
  },
};
