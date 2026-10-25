/**
 * dsh-chatsync 同步引擎 —— 纯 git 编排,不依赖任何 npm 包。
 *
 * 设计:
 *  - 主仓库位于 DSH home 的独立传输副本，Git 不改写宿主会话目录；
 *    设置(settings.yaml)同步，专用凭据文件(.credentials.yaml)排除。
 *  - 无 remote 时只做本地快照提交(免费获得 .dsh 的版本历史)。
 *  - 有 remote 时:fetch → 本地变更先提交 → 与远端对齐:
 *      · 远端领先        → 快进拉取(fast-forward)
 *      · 本地领先        → 推送
 *      · 双方都有新提交  → 尝试 merge(不同会话文件自动并集);
 *        仍有冲突的文件保留本地版本,远端版本先备份到 backup/<时间戳> 分支再丢弃。
 *  - 所有 git 调用带超时,异常只记日志,绝不弄脏业务数据。
 */
import { RecoveryStore } from './recovery.js';
import { hostProcessMethods } from './engine/host-process.js';
import { configMethods } from './engine/config.js';
import { gitRunnerMethods } from './engine/git-runner.js';
import { remoteRepoMethods } from './engine/remote-repo.js';
import { conflictsMethods } from './engine/conflicts.js';
import { workspaceSyncMethods } from './engine/workspace-sync.js';
import { registryMethods } from './engine/registry.js';
import { mainSyncMethods } from './engine/main-sync.js';
import { restartMethods } from './engine/restart.js';
import { runMethods } from './engine/run.js';
import { statusMethods } from './engine/status.js';

export { humanSize, parseTransfer, formatTransfer } from './engine/format.js';
export { ZSTD_MAGIC, SESSION_LOG_NAMES, SESSION_LOG_FILE_RE, pickSessionLog } from './engine/session-files.js';
export { isWebHostProcess, isDesktopHostProcess } from './engine/host-process.js';
export { DEFAULT_CONFIG, resolveSyncConfig } from './engine/config.js';
export { decodeGroup, normPath } from './engine/registry.js';
/** Preview/header decoding shares the same complete-stream failure behavior as merging. */
export { decodeZstdFrames } from './merge.js';

export class SyncEngine {
  /**
   * @param home      DSH home(.dsh 绝对路径)
   * @param overrides 插件加载时传入的配置覆盖(可为 {})
   * @param log       (level: 'info'|'warn'|'error', msg: string) => void
   */
  constructor(home, overrides = {}, log = () => {}) {
    this.home = home;
    this.overrides = overrides;
    this.log = log;
    this.inFlight = null;
    this.gitMissing = false;
    this.lastCommitAt = 0;
    this.commitsSinceGc = 0;
    /** 最近一次同步完成时间(epoch ms)与结果对象,供状态接口展示 */
    this.lastSyncAt = 0;
    this.lastOutcome = null;
    /** 实时进度:{ running, stage, label, startedAt },供 /api/progress 轮询展示 */
    this.progress = null;
    /** 本次同步的阶段时间线(step() 自动记录,供明细展示) */
    this._stages = [];
    /** 本次同步各仓库的传输统计(fetch/push 的字节、速度),供明细展示 */
    this._transfers = [];
    /** 正在进行的传输的实时统计({ op,label,pct,done,total,size,speed,at }),供 /api/progress 轮询展示 */
    this._liveTransfer = null;
    /** gh CLI 可用性探测缓存(避免每次同步都探测) */
    this._ghChecked = undefined;
    this._verifiedPrivateRemote = null;
    /** 会话 cwd 解析缓存(key = 会话文件路径|size|mtime),自查每轮跑两次但不重复解析 */
    this._cwdCache = new Map();
    /** 会话「是否开始过轮次」判定缓存(key = 会话文件路径|size|mtime),供未分组统计排除空白会话 */
    this._turnCache = new Map();
    /** 孤儿工作区影子仓库自查节流(24h 一次) */
    this._orphanCheckedAt = 0;
    /** 待裁决冲突扫描缓存({ at, list }),同一轮同步内多处调用只扫一次 */
    this._conflictsCache = null;
    /** git 子进程环境变量(代理/凭据策略注入用;一次配置整轮生效) */
    this._gitEnv = { ...process.env };
    /** 宿主 cordis 上下文(由插件 apply 时 setHostContext 注入;用于读取 agents 服务判断会话是否在生成) */
    this.ctx = null;
    /** 会话活动探测函数覆盖(测试/嵌入场景用;为 null 时走 probeSessionActivity) */
    this._activeSessionProbe = null;
    this.recovery = new RecoveryStore(home);
    this._safeUploadHeads = new Map();
    this._privacyReport = null;
    this._pendingReviews = new Map();
    this._approvedReviews = new Set();
    this._reviewRequired = null;
    this._reviewApproval = null;
  }
}

// The engine is split by concern under lib/engine/. Install each module's methods
// with the attributes class methods have (non-enumerable), so tests and callers
// see the same prototype as before.
for (const methods of [
  hostProcessMethods,
  configMethods,
  gitRunnerMethods,
  remoteRepoMethods,
  conflictsMethods,
  workspaceSyncMethods,
  registryMethods,
  mainSyncMethods,
  restartMethods,
  runMethods,
  statusMethods,
]) {
  for (const [name, value] of Object.entries(methods)) {
    Object.defineProperty(SyncEngine.prototype, name, { value, writable: true, configurable: true, enumerable: false });
  }
}
