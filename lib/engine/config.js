// Part of the SyncEngine (lib/sync.js); moved verbatim from lib/sync.js.
import path from 'node:path';
import { readSyncConfig, writeSyncConfig } from '../config-file.js';
import { PROXY_ENV_NAMES, resolveProxyEnvironment } from '../proxy-env.js';
import { DEFAULT_ACTIVITY_WINDOW_MS } from '../session-activity.js';

/** 默认配置(可被 .dsh/dsh-sync.json 与插件 apply 时传入的 config 逐层覆盖) */
export const DEFAULT_CONFIG = {
  mode: 'manual', // 旧版兼容字段；不再控制周期/空闲同步。
  enabled: true, // New connections use lifecycle automation; explicit existing choices are preserved.
  showSidebarSync: true, // Local UI preference; hiding the entry does not disable sync.
  remote: '',
  branch: 'main',
  intervalSeconds: 300, // 兼容旧配置，不创建定时任务。
  eventDebounceSeconds: 15, // 旧字段，不再由会话事件触发上传。
  minCommitIntervalSeconds: 120,
  autoPullOnStart: true,
  autoPushOnExit: true,
  commitMessage: 'dsh-chatsync: auto snapshot',
  patches: true, // 已停用:0.21 删除本机补丁功能(D11);仅保留字段以兼容旧配置,不再有任何作用
  proxy: '', // 空/auto: 环境变量 → 当前 Windows 系统代理 → 直连；URL: 手动指定。
  gitUserName: 'dsh-chatsync',
  gitUserEmail: 'dsh-chatsync@localhost',
  extraIgnore: [],
  autoRepo: true, // 首次同步(remote 为空)时,自动创建/复用 GitHub 私有仓库
  repoName: 'dsh-sync', // 自动使用的仓库名;remote 已配置时不生效
  repoOwner: '', // 仓库所属用户名;留空则取 gh 登录账号
  repoDescription: '', // 自动创建仓库时的描述(可选)
  workspaceSync: true, // 是否同步工作区文件夹内容(完整备份/恢复;目标机缺文件夹自动创建)
  contentScope: null, // 显式选择内容后启用隔离传输副本；null 保持既有全范围模式。
  syncInstructions: false, // 本机是否同步 ~/.dsh/AGENTS.md 与 skills/；每台电脑各自选择，不随同步偏好共享。
  workspaceBranchPrefix: 'ws', // 工作区分支前缀 → ws/<workspaceId>
  workspaceBase: '', // 可选:所有工作区统一映射到该目录下(按文件夹名),用于跨机路径不一致
  workspaceExtraIgnore: ['node_modules', '.pnpm-store', '.npm-cache'], // 工作区内容额外排除(目录名;.git 恒排除);写入影子仓库 info/exclude,不碰真实文件夹
  autoRestartAfterRepair: true, // 默认开启；显式 false 仍保留用户选择。修复分组后按需重启宿主刷新索引。
  //  根因(2026-09-11 实证):侧栏「未分组」由运行中 dsh 实例渲染,插件修好的磁盘 workspace.json 会被运行实例的
  //  mutate() 主动修剪覆盖;只有重启 dsh(重启前不做任何侧栏操作)才生效。开启后同步若补登记有变化会自动重启,
  //  浏览器会话会短暂断开、刷新恢复;不需要自动重启时保持 false,可在同步页「检查会话问题」中处理。
  //  2026-10-01 起:**只在没有会话正在生成时才自动重启**;正在生成时不再打断对话,
  //  改为在界面弹窗引导用户手动重启(见 lib/session-activity.js 与 restartGuard)。
  restartGuard: {
    // 会话日志 mtime 兜底判定的活跃窗口(毫秒);宿主 agents 服务可用时不用这个值。
    activityWindowMs: DEFAULT_ACTIVITY_WINDOW_MS,
  },
};
/** Preserve explicit lifecycle choices without turning legacy manual mode on. */
export function resolveSyncConfig(fileCfg = {}, overrides = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...fileCfg, ...overrides };
  // Explicit choices made in the sync page survive host defaults and restarts.
  if (fileCfg.lifecycleAutomation === 1)
    for (const key of ['enabled', 'mode', 'autoPullOnStart', 'autoPushOnExit'])
      if (Object.hasOwn(fileCfg, key)) cfg[key] = fileCfg[key];
  // Empty legacy identity fields must not disable the repository-local fallback.
  for (const key of ['gitUserName', 'gitUserEmail']) {
    cfg[key] = typeof cfg[key] === 'string' && cfg[key].trim() ? cfg[key].trim() : DEFAULT_CONFIG[key];
  }
  const selected =
    Object.hasOwn(fileCfg, 'lifecycleAutomation') ||
    ['autoPullOnStart', 'autoPushOnExit'].some(key => Object.hasOwn(fileCfg, key) || Object.hasOwn(overrides, key));
  const explicitHostEnable = Object.hasOwn(overrides, 'enabled');
  if (
    !Object.hasOwn(fileCfg, 'enabled') &&
    !explicitHostEnable &&
    (selected || fileCfg.mode === 'auto' || overrides.mode === 'auto')
  )
    cfg.enabled = true;
  if (fileCfg.mode === 'manual' && !selected && !explicitHostEnable && overrides.mode !== 'auto') cfg.enabled = false;
  return cfg;
}
/** 启动、退出等无人值守的同步:取不到 GitHub 账号时只保存本地快照,不报错打扰。 */
export const AUTOMATIC_SYNC_REASONS = new Set(['startup', 'exit', 'interval']);

export const configMethods = {
  configPath() {
    return path.join(this.home, 'dsh-sync.json');
  },

  /** 每次同步都重新读配置文件,改动无需重启 dsh */
  loadConfig() {
    try {
      return resolveSyncConfig(readSyncConfig(this.configPath()), this.overrides);
    } catch (error) {
      return {
        ...resolveSyncConfig({}, this.overrides),
        enabled: false,
        autoRepo: false,
        patches: false,
        configError: error.message,
      };
    }
  },

  /** 空/auto 每轮读取当前网络代理；手动 URL 优先。Git 与 gh 共用同一份环境。
   *  同时强制「凭据非交互」:远端需要凭据而本机没有/过期时,git 立即失败并给出明确报错,
   *  而不是弹 GCM(Git Credential Manager)窗口反复等待 —— 这正是之前「一点同步就弹
   *  git-credential-manager.exe、认证完又弹、获取远端状态卡死」的根因之一。 */
  applyProxyEnv(cfg) {
    const env = this._gitEnv;
    const resolved = resolveProxyEnvironment(cfg.proxy);
    for (const name of PROXY_ENV_NAMES) {
      if (resolved[name] === undefined) delete env[name];
      else env[name] = resolved[name];
    }
    env.GIT_TERMINAL_PROMPT = '0'; // git 不在终端询问账号/密码
    env.GIT_CREDENTIAL_NONINTERACTIVE = '1'; // GCM 等助手不再弹交互界面
    env.GCM_INTERACTIVE = 'never'; // 显式禁用 GCM 的 GUI/浏览器交互
  },

  /** 把部分字段写回 dsh-sync.json(保留现有字段) */
  writeConfig(next) {
    return writeSyncConfig(this.configPath(), next);
  },
};
