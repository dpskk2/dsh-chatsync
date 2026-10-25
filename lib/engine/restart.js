// Part of the SyncEngine (lib/sync.js); moved verbatim from lib/sync.js.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { windowsOutput } from '../windows-output.js';
import { DEFAULT_ACTIVITY_WINDOW_MS, probeSessionActivity } from '../session-activity.js';
import { isDesktopHostProcess } from './host-process.js';

// Paths below were written relative to lib/sync.js.
const SYNC_MODULE_URL = new URL('../sync.js', import.meta.url).href;

export const restartMethods = {
  /**
   * 注入宿主 cordis 上下文(插件 apply 时调用)。会话活动探测要靠 ctx.get('agents')
   * 拿到宿主 AgentRegistry;取不到时退化为「会话日志 mtime」兜底。
   * @param {object|null} ctx 宿主上下文
   * @returns {SyncEngine} this(便于链式调用)
   */
  setHostContext(ctx) {
    this.ctx = ctx || null;
    return this;
  },

  /** 覆盖会话活动探测函数(测试/嵌入场景);传 null 恢复默认实现 */
  setActiveSessionProbe(fn) {
    this._activeSessionProbe = typeof fn === 'function' ? fn : null;
    return this;
  },

  /** 当前生效的会话活动探测实现(未覆盖时返回 null = 走 probeSessionActivity) */
  activeSessionProbe() {
    return this._activeSessionProbe;
  },

  /**
   * 当前会话活动快照。**永不抛异常**;探测失败返回 available:false(未知)。
   * @param {object} opts { now, titles }
   * @param {boolean} [opts.titles] 附带「会话 id → 显示名」映射(界面提示「会打断哪次对话」用)
   * @returns {{ available: boolean, activeCount: number, activeIds: string[], source: string, checkedAt: number, titles?: Record<string,string> }}
   */
  sessionActivity({ now = Date.now(), titles = false } = {}) {
    const cfg = this.loadConfig();
    const activityWindowMs = cfg.restartGuard && Number.isFinite(cfg.restartGuard.activityWindowMs)
      ? cfg.restartGuard.activityWindowMs
      : DEFAULT_ACTIVITY_WINDOW_MS;
    if (typeof this._activeSessionProbe === 'function') {
      try {
        const r = this._activeSessionProbe({ now, activityWindowMs, home: this.home, ctx: this.ctx, titles });
        if (r && typeof r === 'object') {
          const activeIds = Array.isArray(r.activeIds) ? r.activeIds.map(String) : [];
          return {
            available: r.available !== false,
            activeCount: Number.isFinite(r.activeCount) ? r.activeCount : activeIds.length,
            activeIds,
            source: typeof r.source === 'string' ? r.source : 'agents',
            checkedAt: Number.isFinite(r.checkedAt) ? r.checkedAt : now,
            ...(r.titles && typeof r.titles === 'object' ? { titles: r.titles } : {}),
          };
        }
      } catch (e) {
        this.log('warn', '会话活动探测(自定义实现)异常,按未知处理: ' + String((e && e.message) || e));
      }
      return { available: false, activeCount: 0, activeIds: [], source: 'none', checkedAt: now };
    }
    try {
      return probeSessionActivity(this.ctx, { home: this.home, now, activityWindowMs, titles });
    } catch (e) {
      this.log('warn', '会话活动探测异常,按未知处理: ' + String((e && e.message) || e));
      return { available: false, activeCount: 0, activeIds: [], source: 'none', checkedAt: now };
    }
  },

  /**
   * 重启守卫:非 force 且有会话正在生成时,拒绝调度重启(不打断正在进行的一轮对话)。
   * available:false(未知)按放行处理 —— 探测能力缺失不应该把自动重启永久卡死,
   * 宁可回到「可能打断」的旧行为(界面另有浮层引导兜底)。
   * @param {boolean} force 用户手动确认过的重启
   * @returns {{ blocked: boolean, activeCount: number, activeIds: string[], activity: object }}
   */
  restartGuardState(force = false) {
    const activity = this.sessionActivity({});
    if (force || !activity.available || activity.activeCount <= 0) {
      return { blocked: false, activeCount: activity.activeCount, activeIds: activity.activeIds, activity };
    }
    return { blocked: true, activeCount: activity.activeCount, activeIds: activity.activeIds, activity };
  },

  /**
   * 调度 DSH 桌面端重启:用 schtasks 触发随包的 scripts/restart-dsh-desktop.ps1(独立进程树)。
   * 不能直接调 powershell/杀进程:插件跑在宿主进程内,杀宿主会连带杀死自己;
   * Task Scheduler 由 svchost 派生,脱离宿主进程。Web 端不自动重启,界面提示手动重启。
   * 幂等:每次同步只调度一次;restart 脚本本身关闭旧实例→启动新实例。
   * @param reason 触发原因(中文短语,用于日志;如「同步后自查补登记会话」「用户手动触发」)
   * @param {object} [options]
   * @param {boolean} [options.allowForce] 允许桌面端重启(用户在界面确认过)
   * @param {boolean} [options.force] 跳过「会话正在生成」守卫(仅用于用户已明确确认的手动重启)
   * @returns {{ scheduled: boolean, reason: string }} scheduled=true 表示已调度;
   *          scheduled=false 时 reason ∈ unsupported-host | desktop-confirmation-required |
   *          missing-script | schtasks-create-failed | schtasks-run-failed | exception | active-session-guard
   */
  scheduleRestart(reason = '用户手动触发', { allowForce = false, force = false } = {}) {
    try {
      const desktop = isDesktopHostProcess();
      // 会话正在生成时不发车(除非调用方是用户已确认的手动重启)。放在宿主/脚本检查之前:
      // 「有会话在跑」比「本机不支持重启」更值得先回答,且被守卫拦下时绝不产生任何 schtasks 副作用。
      const guard = this.restartGuardState(force === true);
      if (guard.blocked) {
        const ids = guard.activeIds.slice(0, 3).join(', ');
        this.log('info', `重启请求(${reason})已延后:检测到 ${guard.activeCount} 个会话正在生成${ids ? `(${ids}${guard.activeIds.length > 3 ? ' …' : ''})` : ''}，空闲后再次同步即可刷新分组`);
        return { scheduled: false, reason: 'active-session-guard', activeCount: guard.activeCount, activeIds: guard.activeIds };
      }
      if (!desktop) return { scheduled: false, reason: 'unsupported-host' };
      if (!allowForce) return { scheduled: false, reason: 'desktop-confirmation-required' };
      const restartPs1 = this.desktopRestartScript();
      if (!fs.existsSync(restartPs1)) {
        this.log('warn', `重启请求(${reason})找不到 ${restartPs1},未调度`);
        return { scheduled: false, reason: 'missing-script' };
      }
      // 延迟调度:让当前同步的 HTTP 响应/日志先落地,再重启(否则响应没发出去进程就没了)
      const taskName = 'DSH-Sync-Desktop-Restart';
      const taskTr = `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${restartPs1}" -HostPid ${process.pid} -AllowForce`;
      const create = spawnSync('schtasks', ['/create', '/tn', taskName, '/tr', taskTr, '/sc', 'once', '/st', '00:00', '/f'], {
        encoding: 'buffer', windowsHide: true, timeout: 15000,
      });
      if (create.status !== 0) {
        this.log('warn', `重启调度失败(schtasks create): ${(windowsOutput(create.stderr) || windowsOutput(create.stdout)).split('\n')[0] || create.status}`);
        return { scheduled: false, reason: 'schtasks-create-failed' };
      }
      const runTask = spawnSync('schtasks', ['/run', '/tn', taskName], { encoding: 'buffer', windowsHide: true, timeout: 15000 });
      if (runTask.status !== 0) {
        this.log('warn', `重启调度失败(schtasks run): ${(windowsOutput(runTask.stderr) || windowsOutput(runTask.stdout)).split('\n')[0] || runTask.status}`);
        return { scheduled: false, reason: 'schtasks-run-failed' };
      }
      this.log('info', `[${reason}] 已调度 DSH 桌面端重启`);
      return { scheduled: true, reason: '' };
    } catch (e) {
      this.log('warn', `重启调度异常: ${String((e && e.message) || e)}`);
      return { scheduled: false, reason: 'exception' };
    }
  },

  desktopRestartScript() {
    return path.resolve(path.dirname(fileURLToPath(SYNC_MODULE_URL)), '..', 'scripts', 'restart-dsh-desktop.ps1');
  },

  desktopRestartAvailable() {
    return isDesktopHostProcess() && fs.existsSync(this.desktopRestartScript());
  },

  restartAvailable() {
    return this.desktopRestartAvailable();
  },

  /**
   * 本机可自动重启的宿主类型。
   * 桌面端同样支持自动重启:重启脚本会先校验「被关掉的是 Desktop 主进程、发起者是 Desktop Host」,
   * 再关闭应用并重新打开(见 scripts/restart-dsh-desktop.ps1),不需要用户待在应用前确认。
   * Web 端不自动重启(D6),由界面提示手动重启。
   * @returns {'desktop'|null} 可自动重启时的宿主类型
   */
  autoRestartHost() {
    if (this.desktopRestartAvailable()) return 'desktop';
    return null;
  },

  /** 向后兼容包装:同步后自查补登记会话后自动重启;返回 boolean(供 _syncOnce 现有调用点) */
  scheduleRestartAfterRepair(cfg) {
    return this.scheduleRestart('同步后自查补登记会话', { allowForce: isDesktopHostProcess() }).scheduled;
  },

  maybeScheduleRepairRestart(result) {
    // Background startup allows immediate editing. Never close the application
    // underneath a draft; pending imports remain visible and block only sends.
    if (this.sendGuard) return false;
    if (result?.restartRequired) this._pendingRepairRestart = true;
    if ((!result?.restartRequired && !this._pendingRepairRestart) || this._repairRestartScheduled
      || result?.cancelled || result?.deferred || result?.needsReview || result?.downloadPending || result?.error || result?.workspaces?.errors?.length) return false;
    const cfg = this.loadConfig();
    if (cfg.configError || cfg.autoRestartAfterRepair !== true || this.autoRestartHost() === null) return false;
    const grouping = this.hostGroupingState();
    if (grouping.available && grouping.ungroupedIds.length && !grouping.refreshableIds.length) return false;
    let registry = [];
    try {
      const disk = JSON.parse(fs.readFileSync(path.join(this.home, 'storages/workspace.json'), 'utf8'));
      registry = Object.entries(disk.tables?.workspaces || {}).map(([id, ws]) =>
        [id, ws.path, (ws.sessionIds || []).slice().sort()]).sort((a, b) => a[0].localeCompare(b[0]));
    } catch {}
    const signature = createHash('sha256').update(JSON.stringify([grouping.refreshableIds.slice().sort(), registry])).digest('hex');
    const noticeFile = path.join(this.home, '.dsh-sync-restart-notice.json');
    try {
      const notice = JSON.parse(fs.readFileSync(noticeFile, 'utf8'));
      if (notice.signature === signature && Date.now() - notice.at < 12 * 3600000) { result.restartCooldown = true; return false; }
    } catch { /* First necessary restart on this device. */ }
    const activity = this.sessionActivity({});
    if (!activity.available || activity.activeCount > 0) {
      const blocked = activity.available ? 'active-session' : 'activity-unknown';
      if (result.restartBlocked !== blocked) this.log('info', '会话分组需要刷新；尚未确认空闲，已延后自动重启。');
      result.restartBlocked = blocked;
      return false;
    }
    if (!this.scheduleRestartAfterRepair(cfg)) return false;
    try { fs.writeFileSync(noticeFile, JSON.stringify({ at: Date.now(), signature,
      hostPid: process.pid, hostKind: this.autoRestartHost(), sessionIds: grouping.refreshableIds }), { flush: true }); } catch {}
    this._repairRestartScheduled = true;
    this._pendingRepairRestart = false;
    result.restartRequired = false;
    delete result.restartBlocked;
    return true;
  },
};
