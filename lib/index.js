/**
 * dsh-chatsync —— DeepSeek Harness 会话同步插件(宿主端主入口)
 *
 * 安装(一行命令):
 *   dsh plugin --profile web add @dpskk2/dsh-chatsync
 * 装完重启 dsh:
 *   - 侧栏底部出现原生「⟳ 同步」按钮(sidebar.footer.action 槽位,不遮挡页面);
 *   - 设置面板新增「同步」分节(状态 + 上次结果 + 立即同步)。
 *
 * 只做「同步」:把 DSH 会话(含每个会话所属工作区的对应关系)、聚合在
 * storages/workspace.json 的工作区→会话映射、以及各工作区真实文件夹内容,
 * 通过用户配置的 Git 仓库在【多台电脑】之间双向同步，推荐使用私有仓库。
 *
 * 配置:读 DSH home 下的 dsh-sync.json(remote 为 GitHub 私有仓库地址);
 *       enabled 控制启动/退出自动同步(新配置默认开启);旧 mode 仅用于迁移兼容。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SyncEngine, resolveSyncConfig } from './sync.js';
import { createSyncScheduler } from './scheduler.js';
import { createUpdateChecker } from './updates.js';
import { registerHost, readSyncStatus, saveSyncStatus } from './session-safety.js';
import { startExitSync } from './host-sync.js';
import { detectDshVersion } from './recovery-guide.js';
import { readSyncConfig } from './config-file.js';
import { queuedDataRepairs, pendingDataVerification } from './data-health.js';
import { watchGrouping } from './host-grouping.js';
import { createSendGuard, protectPrompt } from './send-guard.js';
import { registerRoutes } from './http/guard.js';
import { createStartup } from './http/startup.js';
import { syncRoutes } from './http/sync-routes.js';
import { storageRoutes, recordsRoutes } from './http/records-routes.js';
import { settingsRoutes } from './http/settings-routes.js';
export { MAX_REQUEST_BYTES, requestRejection } from './http/guard.js';

const name = 'dsh-chatsync';
const buildRevision = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).chatsyncBuild || null;
const dshVersion = detectDshVersion();
const inject = ['webServer'];

function makeLogger(ctx) {
  return (level, msg) => {
    const line = `[dsh-chatsync] ${msg}`;
    try {
      const l = ctx.logger;
      if (typeof l === 'function') { l(line); return; }
      if (l && typeof l[level] === 'function') { l[level](line); return; }
    } catch { /* 落到 console */ }
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
}

// Prompts wait until this computer holds the latest content of their session.
function installSendGuard(ctx, engine, disposers) {
  engine.sendGuard = createSendGuard(engine);
  if (typeof ctx.inject === 'function') ctx.inject(['sessionController'], protectedCtx => {
    const restore = protectPrompt(protectedCtx.sessionController, engine.sendGuard);
    protectedCtx.effect(() => restore);
  });
  else if (ctx.sessionController) disposers.push(protectPrompt(ctx.sessionController, engine.sendGuard));
}

// Show the last result after a restart; notices owned by another process are dropped.
function restorePreviousSync(engine, previousSync, configError) {
  if (previousSync && !configError) {
    engine.lastSyncAt = previousSync.at; engine.lastOutcome = { ...previousSync.result };
    if (engine.lastOutcome.needsReview && !engine.lastOutcome.privacy) engine.lastOutcome = { deferred: true, message: '正在后台重新核对上次未完成的同步。' };
    if (previousSync.hostPid && previousSync.hostPid !== process.pid && !engine.lastOutcome.downloadPending)
      engine.lastOutcome.restartRequired = false;
  }
}

function registerReadOnlyTools(ctx, engine, log, disposers) {
  // —— 只读诊断工具:供对话查看同步状态,不传输数据 ——
  const toolOut = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] };
  // register() takes raw JSON Schema; {} means unconstrained JSON, not zero arguments.
  const noParameters = { type: 'object', properties: {}, required: [], additionalProperties: false };
  try {
    const tools = typeof ctx.get === 'function' ? ctx.get('tools') : ctx.tools;
    for (const [toolName, description, execute] of [
      ['sync_status', '只读检查本机同步模式、最近交接提交与设备回执；不传输数据，不读取会话正文。', () => ({ busy: Boolean(engine.inFlight), handoff: engine.handoffStatus(), lastOk: engine.lastOutcome ? !engine.lastOutcome.error && !engine.lastOutcome.workspaces?.errors?.length : null })],
      ['sync_preview', '只读统计本机待同步的新增、修改、删除与执行文件数量；不连接远端，不返回正文或路径。', () => engine.localPreview()],
      ['sync_doctor', '只读诊断 Git、Node、本地仓库、模式及恢复记录；不上传、不修改设置、不测试真实双机。', () => engine.doctor()],
    ]) disposers.push(tools.register({ name: toolName, description, parameters: noParameters, output: toolOut,
      async execute() { return JSON.stringify(await execute()); } }));
  } catch (err) {
    log('warn', '同步只读工具注册失败: ' + String((err && err.message) || err));
  }
}

function apply(ctx, config = {}) {
  const home = config.home || (process.env.DSH_HOME || path.join(os.homedir(), '.dsh'));
  let fileCfg = {};
  let configError;
  try { fileCfg = readSyncConfig(path.join(home, 'dsh-sync.json')); }
  catch (error) { configError = error.message; fileCfg = { enabled: false, autoRepo: false, patches: false }; }
  const overrides = { ...config };
  delete overrides.home;
  const cfg = resolveSyncConfig(fileCfg, overrides);
  const log = makeLogger(ctx);

  const engine = new SyncEngine(home, overrides, log);
  if (configError) engine.lastOutcome = { error: configError };
  // 会话活动探测要用宿主 agents 服务(判断「是否有会话正在生成」),把上下文注入引擎
  engine.setHostContext(ctx);
  const disposers = [];
  registerRoutes(ctx.webServer, storageRoutes({ engine }), disposers);
  installSendGuard(ctx, engine, disposers);
  registerHost(home); // Keep the lease until the process exits, even on plugin unload.
  const previousSync = readSyncStatus(home);
  restorePreviousSync(engine, previousSync, configError);
  const { startup, runStartup, goOffline } = createStartup({ engine, cfg, previousSync });
  const scheduler = createSyncScheduler({
    loadConfig: () => engine.loadConfig(),
    sync: () => runStartup(),
    log,
  });
  const checkUpdates = createUpdateChecker();
  try {
    registerRoutes(ctx.webServer, [
      ...syncRoutes({ engine, startup, runStartup, goOffline, scheduler, checkUpdates, previousSync, buildRevision, dshVersion }),
      ...recordsRoutes({ ctx, engine, home, startup, dshVersion }),
      ...settingsRoutes({ engine, home, scheduler }),
    ], disposers);
  } catch (err) {
    log('warn', 'webServer 不可用,API 未注册(命令行同步仍可用): ' + String((err && err.message) || err));
  }
  registerReadOnlyTools(ctx, engine, log, disposers);

  // Editing events and periodic timers must not trigger background sync.
  scheduler.refresh({ startup: startup.required });
  const stopGroupingWatch = watchGrouping({ engine,
    ready: () => startup.phase === 'ready' && !queuedDataRepairs(engine).length && !pendingDataVerification(engine).length,
    onScheduled: () => { startup.phase = 'restarting'; startup.message = '正在重新打开 DSH 以刷新会话分组。'; },
  });
  ctx.effect(() => () => {
    const current = engine.loadConfig();
    scheduler.stop();
    stopGroupingWatch();
    for (const d of disposers) { try { d(); } catch { /* ignore */ } }
    const repairQueued = queuedDataRepairs(engine).length > 0;
    if (repairQueued || (current.remote && current.enabled !== false && current.autoPushOnExit !== false && !['restarting', 'cancelling', 'offline'].includes(startup.phase))) {
      try {
        if (startExitSync(engine)) {
          saveSyncStatus(home, { deferred: true, message: '退出上传正在后台完成；下次启动会核对结果。' }, 'exit-pending');
          log('info', '已安排退出后的自动上传，结果将在下次启动显示');
        }
      } catch (e) { saveSyncStatus(home, { error: `退出上传未启动：${e.message}` }, 'exit'); }
    }
  });

  if (!cfg.remote) {
    log('info', `未配置 remote —— 同步只做本地快照提交。编辑 ${path.join(home, 'dsh-sync.json')} 填入 GitHub 私有仓库地址后启用云同步`);
  }
  log('info', `dsh-chatsync 已启动(mode=${cfg.mode || 'manual'}, home=${home}, 分支=${cfg.branch}, remote=${cfg.remote || '(未配置,仅本地快照)'}, UI=侧栏「⟳ 同步」按钮(实时进度) + 设置「同步」状态卡)`);
}

export { name, inject, apply };
