// Part of the SyncEngine (lib/sync.js); moved verbatim from lib/sync.js.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pendingDataVerification, queuedDataRepairs } from '../data-health.js';
import { recordHandoff } from '../handoff.js';
import { normalizeScope, scopedSync } from '../scope.js';
import { retrySessionTransfers } from '../session-transfer.js';
import { checkWorkspaceSnapshotSizesSync } from '../privacy.js';
import { saveSyncStatus } from '../session-safety.js';
import { SyncEngine } from '../sync.js';
import { ts } from './format.js';
import { isDesktopHostProcess, isWebHostProcess } from './host-process.js';

export const runMethods = {
  /** 对外同步总入口:先同步主数据(.dsh 会话/settings/插件/工作区元数据),再同步各工作区文件夹内容 */
  async _syncOnce(reason, opts = {}) {
    const t0 = Date.now();
    if (this._isolatedTransport || !this._syncControl) this._stages = [];
    this._stages.push({ stage: 'start', label: '开始同步', at: t0 });
    this._transfers = [];
    const cfg = this.loadConfig();
    if (cfg.configError) return { error: cfg.configError };
    if (!this._isolatedTransport && pendingDataVerification(this).length) return { deferred: true, dataVerificationPending: true,
      error: '同步已暂停，等待你核对正文、项目归属和附件。请到「设置 → 同步 → 检查与修复历史数据」，检查修复结果后点击「已检查修复结果，允许同步」，再点「立即同步」。本轮未上传或下载，原件备份保留。' };
    if (!this._isolatedTransport && queuedDataRepairs(this).length) return { deferred: true, dataRepairQueued: true,
      error: '同步已暂停，等待执行已安排的修复。请到「设置 → 同步 → 检查与修复历史数据」，结束当前对话后点击「关闭并修复（桌面端）」；Web 端请完全退出服务后再打开。也可点击「取消修复安排」后再同步；原件保留。' };
    if (!this._isolatedTransport && !opts.uploadOnly) {
      const pending = await retrySessionTransfers(this);
      if (pending) return pending;
    }
    if (this.hasPendingSessionImport()) return { error: 'session-import-pending',
      hint: '恢复会话尚未读回验收，同步已暂停以免传输不完整会话。请先在恢复记录中重试；原件仍保留。' };
    this.applyProxyEnv(cfg);
    if (!this._isolatedTransport) {
      normalizeScope(cfg.contentScope);
      const result = await scopedSync(this, cfg, reason, opts, SyncEngine);
      try { await recordHandoff(this, result); }
      catch (e) { result.handoffWarning = '设备交接记录未完成，下次同步重试'; this.log('warn', e.message); }
      return result;
    }
    // 同步前会话集 + 登记集:用于检测「本次同步拉取到新会话」或「有会话被新登记」→ 需重建 DSH 运行实例的内存索引
    const sessionsBefore = new Set(this.localSessionIds());
    const registeredBefore = this.registeredSessionIds();
    const rMain = await this._mainSync(reason, opts);
    this.throwIfCancelled();
    if (rMain?.error) return rMain;
    // _mainSync may create and persist the remote on first use.
    const activeCfg = this.loadConfig();
    const registryStop = await this._reviewRegistryAfterSync(rMain, activeCfg, sessionsBefore, registeredBefore);
    if (registryStop) return registryStop;
    let workspaces = { skipped: 'not-run', total: 0, synced: 0, pushed: 0, pulled: 0, errors: [] };
    try {
      workspaces = await this.syncAllWorkspaces(activeCfg, reason, opts);
    } catch (e) {
      workspaces = { skipped: 'error', total: 0, synced: 0, pushed: 0, pulled: 0, errors: [{ id: '', title: '', path: '', error: String(e?.message || e) }] };
    }
    try { this.reportOrphanWorkspaceRepos(activeCfg); } catch { /* 仅提示,失败忽略 */ }
    try { if (activeCfg.remote && !workspaces.errors?.length) this.step('handoff', '记录设备交接…'); await recordHandoff(this, { ...rMain, workspaces }); }
    catch (e) { this.log('warn', '设备交接记录未完成：' + String(e?.message || e)); rMain.handoffWarning = '设备交接记录未完成，下次同步重试'; }
    // 阶段时间线(每段的毫秒数)与传输明细、仓库体积,随结果返回供 CLI/状态卡/API 展示
    const stages = [];
    for (let i = 0; i < this._stages.length; i++) {
      const cur = this._stages[i];
      const next = this._stages[i + 1];
      stages.push({ stage: cur.stage, label: cur.label, ms: next ? next.at - cur.at : Date.now() - cur.at });
    }
    const repoSize = this.repoSizeBytes();    return {
      ...rMain, workspaces,
      durationMs: Date.now() - t0,
      stages,
      transfers: this._transfers,
      repoSize,
    };
  },

  /** 同步后的工作区登记自查;登记补推失败时返回本轮结果,否则返回 null。 */
  async _reviewRegistryAfterSync(rMain, activeCfg, sessionsBefore, registeredBefore) {
    // 同步后自查:拉取/合并落盘的会话立即补进工作区登记表(不再落「未分组」),
    // 有变化就补一次提交+推送,让「会话↔工作区」对应关系随本次同步真正跨机收敛。
    // 即使远端旧版插件没登记、或登记被并集合并丢弃,这里也按会话 cwd 兜底归位。
    if (!(rMain && rMain.error)) {
      try {
        const fix = this.repairWorkspaceRegistry();
        const repairChanged = fix && (fix.repaired > 0 || fix.created > 0 || fix.deduped > 0 || fix.unarchived > 0);
        if (repairChanged) {
          const cm = await this.commitIfDirty(activeCfg, true);
          if (cm === 'committed' && activeCfg.remote) {
            const p = await this.runWithRetry('push', '主仓库', ['push', 'origin', activeCfg.branch], { timeoutMs: 180000, onProgress: (d) => this.liveTransfer('push', '主仓库', d) });
            if (!this.ok(p)) {
              this.log('error', `工作区登记补推失败: ${p.err.trim().split('\n')[0] || p.code}`);
              return { ...rMain, pushed: false, error: 'push', hint: '工作区登记已在本地保存，但没有上传成功；请检查网络后重试。' };
            }
            else this.log('info', `同步后自查:已把 ${fix.repaired} 个会话补进工作区` + (fix.created ? `、新建 ${fix.created} 个工作区` : '') + ',已提交并推送');
          } else if (cm === 'committed') {
            this.log('info', `同步后自查:已把 ${fix.repaired} 个会话补进工作区(未配置 remote,仅本地提交)`);
          }
        }
        // 重建索引触发:①本次同步拉取到新会话,或 ②有会话从「未登记」被补进登记(可能发生在同步前 repair),
        // 两种情况都会让运行中 dsh 的内存索引过期 → 需重启 dsh 让新实例重建 sessionPath 索引(否则侧栏持续显示「未分组」)
        const newSessions = [...this.localSessionIds()].filter((id) => !sessionsBefore.has(id));
        const newlyRegistered = [...this.registeredSessionIds()].filter((id) => !registeredBefore.has(id));
        const reindexNeeded = newSessions.length > 0 || newlyRegistered.length > 0;
        if (reindexNeeded) {
          rMain.restartRequired = true;
          const autoHost = this.autoRestartHost();
          rMain.restartHost = autoHost || (isDesktopHostProcess() ? 'desktop' : isWebHostProcess() ? 'web' : 'manual');
          const sessionActivity = this.sessionActivity({});
          rMain.activeSessionCount = sessionActivity.activeCount || 0;
          rMain.activeSessionIds = sessionActivity.activeIds || [];
          rMain.sessionActivitySource = sessionActivity.source || 'none';
          // Web 与桌面端都支持自动重启;桌面端的重启脚本会自行校验宿主进程并重新打开应用
          const canAutoRestart = activeCfg.autoRestartAfterRepair === true && autoHost !== null;
          if (canAutoRestart && (!sessionActivity.available || sessionActivity.activeCount > 0)) {
            // 正在生成时延后自动重启，后续同步重新检查。
            rMain.restartBlocked = sessionActivity.available ? 'active-session' : 'activity-unknown';
            this.log('info', `会话分组需要刷新；${sessionActivity.available ? `有 ${sessionActivity.activeCount} 个会话正在生成` : '会话活动状态未知'}，暂不自动重启。`);
          }
          // 这里只记录重启需求；整轮传输完成、保存结果并释放进程锁后才调度。
        }
        // 兜底(不依赖 delta):同步后仍「未分组」的会话,是 repair 没能登记回去的(头损坏/未知格式),
        // 或运行实例在同步之外又修剪掉、而本次 delta 没捕捉到的。明确提示,避免静默。
        const ungrouped = this.ungroupedSessionIds();
        if (ungrouped.length > 0) {
          this.log('warn', `同步后自查:仍有 ${ungrouped.length} 个会话未分组(${ungrouped.slice(0, 8).join(', ')}${ungrouped.length > 8 ? '…' : ''})。若其会话文件完好,请在同步页点「检查会话问题」处理,或重启 dsh;若反复出现,请检查对应会话日志头(cwd)是否损坏。`);
        }
      } catch (e) {
        this.log('warn', '同步后工作区自查异常(不影响同步结果): ' + String(e?.message || e));
      }
    }
    return null;
  },

  acquireProcessLock() {
    fs.mkdirSync(this.home, { recursive: true });
    const lockPath = path.join(this.home, '.dsh-sync.process.lock');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = fs.openSync(lockPath, 'wx');
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
        return () => {
          try { fs.closeSync(fd); } catch {}
          try {
            const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
            if (current.pid === process.pid) fs.unlinkSync(lockPath);
          } catch {}
        };
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        let owner = null;
        try { owner = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
        if (!owner) {
          try { if (Date.now() - fs.statSync(lockPath).mtimeMs < 60_000) return null; }
          catch { return null; }
        }
        if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
          try { process.kill(owner.pid, 0); return null; }
          catch (checkError) { if (checkError?.code === 'EPERM') return null; }
        }
        // The owner is gone; a later attempt creates a new atomic lock.
        try { fs.unlinkSync(lockPath); } catch { return null; }
      }
    }
    return null;
  },

  /** 对外同步入口:同一进程和不同 DSH 宿主都只允许一轮同步 */
  syncOnce(reason = 'manual', opts = {}) {
    if (this.inFlight) return this.inFlight;
    const startedAt = Date.now();
    this._stages = []; this._transfers = []; this._liveTransfer = null;
    this.progress = { running: true, stage: 'prepare', label: '准备同步…', startedAt };
    const control = this._syncControl = { id: randomUUID(), cancelled: false, interrupts: new Set() };
    this.inFlight = (async () => {
      this._privacyReport = null; this._privacyReports = []; this._uploadChange = null; this._reviewRequired = null;
      this._reviewApproval = typeof opts.approval === 'string' ? opts.approval : null;
      this._offlineSessionApply = opts.offlineApply === true;
      let release = this.acquireProcessLock();
      const waitStarted = Date.now();
      while (!release && opts.waitForLock && Date.now() - waitStarted < 120_000) {
        this.throwIfCancelled();
        this.step('wait-lock', '等待上次同步结束');
        await new Promise(resolve => setTimeout(resolve, 250));
        this.throwIfCancelled();
        release = this.acquireProcessLock();
      }
      if (!release) return { error: '另一 DSH 进程正在同步，请稍后再试。' };
      try {
        this.throwIfCancelled();
        if (this.ctx && !opts.uploadOnly && !this.sendGuard) {
          const activity = this.sessionActivity();
          if (!activity.available || activity.activeCount > 0) return { deferred: true, error: '会话正在生成或活动状态未知；本轮未取回数据，请在对话结束后重试。' };
        }
        return await this._syncOnce(reason, opts);
      }
      finally {
        try { if (control.cancelled && this._transport) await this._transport.git(['merge', '--abort']); }
        catch (e) { this.log('warn', '取消后的隔离合并清理未完成：' + e.message); }
        finally { release(); }
      }
    })()
      .catch((e) => e?.code === 'SYNC_CANCELLED' ? { cancelled: true, message: e.message } : { error: String((e && e.message) || e) })
      .then((r) => {
        if (control.cancelled) r = { ...r, error: undefined, needsReview: false, review: undefined,
          cancelled: true, message: '本次同步已取消，已完成的保存或上传保留；剩余内容下次同步继续核对。' };
        if (!r.cancelled) {
          if (this._reviewRequired) { r.needsReview = true; r.review = this._reviewRequired; r.error = '同步已暂停，等待确认预览'; }
          if (this._privacyReport) {
            r.privacy = this._privacyReport; r.privacyReports = this._privacyReports;
            r.error = '上传已暂停：' + this._privacyReports.reduce((n, report) => n + report.findings.length, 0) + ' 项上传检查问题。';
          }
          if (this._uploadChange) { r.error = this._uploadChange; r.hint = this._uploadChange; }
        }
        this.lastSyncAt = Date.now();
        r.durationMs = Date.now() - startedAt;
        r.stages = this._stages.map((s, i, rows) => ({ stage: s.stage, label: s.label,
          ms: (rows[i + 1]?.at || Date.now()) - s.at }));
        r.transfers ??= this._transfers;
        if (r.downloadPending && this.ctx) {
          r.restartRequired = true;
          r.restartHost = isDesktopHostProcess() ? 'desktop' : isWebHostProcess() ? 'web' : 'manual';
        }
        this.lastOutcome = r;
        this.onSyncOutcome?.(r);
        try { saveSyncStatus(this.home, r, reason); } catch (e) { this.log('warn', '保存同步结果失败：' + e.message); }
        const wsErrs = r && r.workspaces && r.workspaces.errors && r.workspaces.errors.length;
        const hasErr = Boolean(r && r.error) || Boolean(wsErrs);
        this.progress = {
          running: false,
          stage: r.cancelled ? 'cancelled' : r.needsReview && !r.privacy ? 'review' : hasErr ? 'error' : 'done',
          label: r.cancelled ? r.message : r.needsReview && !r.privacy ? '等待确认同步预览' : (r && r.error) ? '同步失败: ' + r.error
            : (wsErrs ? '同步完成(部分工作区失败)' : '同步完成'),
          startedAt,
          transfer: null,
          endedAt: Date.now(),
        };
        if (!r.cancelled && !opts.uploadOnly && reason !== 'startup') this.maybeScheduleRepairRestart(r);
        return r;
      })
      .finally(() => {
        this.inFlight = null;
        if (this._transport?._syncControl === control) this._transport._syncControl = null;
        this._syncControl = null;
        this._conflictsCache = null; // 本轮同步可能新增/清理了冲突拷贝 → 让下次扫描重新读盘
      });
    return this.inFlight;
  },

  /** 退出冲刷:阻塞版"提交 + 推送",供 dsh 关闭时调用(enabled 只约束自动模式,手动冲刷始终执行) */
  flushSync() {
    const release = this.acquireProcessLock();
    if (!release) return;
    try {
    if (this.hasPendingSessionImport() || queuedDataRepairs(this).length || pendingDataVerification(this).length) return;
    const cfg = this.loadConfig();
    if (cfg.configError) return;
    const checkWorkspaceUploadSize = Boolean(cfg.remote);
    // Exit hooks can resend a previously checked commit, but cannot export or
    // mutate the host's live session tree without the asynchronous protocol.
    // Exit hooks cannot await gh; never upload a remote that this process has not verified.
    if (cfg.remote !== this._verifiedPrivateRemote) cfg.remote = '';
    if (this.gitMissing) return;
    if (this._isolatedTransport) {
    if (!(fs.existsSync(path.join(this.home, '.git')))) {
      if (!this.ok(this.gitSync(['init', '-b', cfg.branch]))) return;
      this.gitSync(['config', 'user.name', cfg.gitUserName]);
      this.gitSync(['config', 'user.email', cfg.gitUserEmail]);
      this.gitSync(['config', 'core.autocrlf', 'false']);
      this.gitSync(['config', 'core.longpaths', 'true']);
      this.gitSync(['config', 'commit.gpgsign', 'false']);
    }
    const st = this.gitSync(['status', '--porcelain']);
    if (this.ok(st) && st.out.trim()) {
      this.gitSync(['add', '-A']);
      const cm = this.gitSync(['commit', '-m', `${cfg.commitMessage} (exit flush ${ts()})`]);
      if (!this.ok(cm)) return;
    }
    }
    if (cfg.remote && cfg.remote === this._verifiedPrivateRemote) {
      const head = this.gitSync(['rev-parse', 'HEAD']).out.trim();
      const checked = this._safeUploadHeads.get('main');
      if (checked?.head === head && checked.remote === cfg.remote && checked.branch === cfg.branch) {
        const args = ['push', 'origin', checked.head + ':refs/heads/' + cfg.branch];
        if (!this.ok(this.gitSync(args))) this.gitSync(args); // 重试仍固定同一已检查提交
      }
    }
    // 退出冲刷:已初始化过影子仓库的工作区,提交 + 推送(不新建仓库,避免退出时重活)
    if (cfg.workspaceSync !== false && !this.gitMissing) {
      for (const ws of this.workspaces()) {
        try {
          const realPath = this.workspaceRealPathOf(ws, cfg);
          if (!realPath) continue;
          const gitdir = this.workspaceGitDir(ws.id);
          if (!fs.existsSync(gitdir)) continue;
          const branch = this.workspaceBranchOf(cfg, ws.id);
          // 只写 worktree 配置(真实文件夹可能已按本机覆盖换过位置);不改 core.bare(init 时已设)
          const curWt = this.gitWSync(gitdir, realPath, ['config', 'core.worktree']);
          if (!this.ok(curWt) || curWt.out.trim() !== realPath) {
            this.gitWSync(gitdir, realPath, ['config', 'core.worktree', realPath]);
          }
          const stW = this.gitWSync(gitdir, realPath, ['status', '--porcelain']);
          if (this.ok(stW) && stW.out.trim()) {
            if (!this.ok(this.gitWSync(gitdir, realPath, ['add', '-A']))) continue;
            if (checkWorkspaceUploadSize && checkWorkspaceSnapshotSizesSync(this, gitdir, realPath).length) {
              const head = this.gitWSync(gitdir, realPath, ['rev-parse', '--verify', 'HEAD']);
              this.gitWSync(gitdir, realPath, ['read-tree', this.ok(head) ? head.out.trim() : '--empty']);
              continue;
            }
            if (!this.ok(this.gitWSync(gitdir, realPath, ['commit', '-m', `${cfg.commitMessage} [${path.basename(realPath)}] (exit flush ${ts()})`]))) continue;
          }
          if (cfg.remote) {
            const head = this.gitWSync(gitdir, realPath, ['rev-parse', 'HEAD']).out.trim();
            const checked = this._safeUploadHeads.get(gitdir);
            if (checked?.head === head && checked.remote === cfg.remote && checked.branch === branch) {
              const args = ['push', 'origin', checked.head + ':refs/heads/' + branch];
              if (!this.ok(this.gitWSync(gitdir, realPath, args))) this.gitWSync(gitdir, realPath, args);
            }
          }
        } catch { /* ignore */ }
      }
    }
    } finally { release(); }
  },
};
