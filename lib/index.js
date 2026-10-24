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
 * 另提供历史冲突副本审计界面。
 *
 * 配置:读 DSH home 下的 dsh-sync.json(remote 为 GitHub 私有仓库地址);
 *       mode=manual(默认,纯手动)/ auto(自动同步);设置页切换自动模式即时生效。
 */
import fs from 'node:fs';
import { sessionIdPattern, sessionIdOfLogPath } from './session-path.js';
import { parseSyncRemote } from './remote.js';
import { saveConnection } from './connection.js';
import os from 'node:os';
import path from 'node:path';
import { SyncEngine, resolveSyncConfig, humanSize, ZSTD_MAGIC, decodeZstdFrames, isDesktopHostProcess } from './sync.js';
import { createSyncScheduler } from './scheduler.js';
import { applyAllPatches, formatApplyResults } from './patches.js';
import { createUpdateChecker } from './updates.js';
import { safePath, digest, atomicJson, LOCAL_DATA, recoveryCategory } from './recovery.js';
import { normalizeScope } from './scope.js';
import { sessionRecoveryOptions, importRecoverySession } from './session-recovery.js';
import { previewSessionRelocation, importRelocatedSession } from './session-relocation.js';
import { registerHost, readSyncStatus, saveSyncStatus } from './session-safety.js';
import { startExitSync, scheduleOfflineSync } from './host-sync.js';
import { syncIssues } from './diagnostics.js';
import { detectDshVersion, recoveryGuide } from './recovery-guide.js';
import { readSyncConfig, writeSyncConfig } from './config-file.js';
import { scanDataHealth, previewDataRepair, previewDataRollback, queueDataRepair, queuedDataRepairs, cancelQueuedDataRepairs,
  pendingDataVerification, acknowledgeDataRepairs } from './data-health.js';
import { compareRecoveryBranches, preserveRecoveryBranches } from './branch-history.js';
import { canonicalWorkspacePath } from './workspace-target.js';
import { watchGrouping, groupingRepairStatus } from './host-grouping.js';
import { createSendGuard, protectPrompt } from './send-guard.js';

// zstd 解码(会话内容预览用):运行时有 zstd 才可用;旧版本自动降级(预览返回"不支持")
let zstdDecompressSync = null;
try { ({ zstdDecompressSync } = await import('node:zlib')); } catch { zstdDecompressSync = null; }

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

/** 把一次同步结果压成一句话 */
function summarize(r) {
  if (r?.repaired) return r.verificationAcknowledged ? '数据修复已完成并已确认检查，原件备份保留。'
    : '数据修复已完成。请到「设置 → 同步 → 检查与修复历史数据」，核对正文、项目归属和附件，再点击「已检查修复结果，允许同步」；原件备份保留。';
  if (r?.cancelled) return r.message || '本次同步已取消，已保存的改动保留。';
  if (r?.needsReview && !r.privacy) return '等待确认同步预览；请查看变更后选择“确认并继续”。';
  if (r?.downloadPending) return '已保存上传，已有会话更新待关闭后取回。';
  const parts = [];
  const upBytes = (r.transfers || []).filter((t) => t.op === 'push').reduce((a, t) => a + (t.size || 0), 0);
  const downBytes = (r.transfers || []).filter((t) => t.op === 'fetch').reduce((a, t) => a + (t.size || 0), 0);
  if (r.committed) parts.push('已提交本地快照');
  if (r.pulled === 'ff') parts.push('已拉取远端新数据' + (downBytes ? `(${humanSize(downBytes)})` : ''));
  if (r.pulled === 'merge') parts.push(r.unrelated ? '已并入远端历史' : '已合并双方数据');
  if (r.pulled === 'reset') parts.push('已整体取回远端');
  if (r.pushed) parts.push('已推送到远端' + (upBytes ? `(${humanSize(upBytes)})` : ''));
  if (r.conflicts && r.conflicts.length) parts.push(r.conflicts.length + ' 个冲突已按类型处理');
  if (r.sessionWarnings?.length) parts.push(r.sessionWarnings.length + ' 个会话未混合合并，双方原件保留在 Git 历史中，请查看详情');
  if (r.sessionDeferred?.length) parts.push(r.sessionDeferred.length + ' 个会话等待安全写入，请查看详情；本机原件保留');
  if (r.backupBranch) parts.push('远端备份: ' + r.backupBranch + (r.backupPushed ? '（已上传）' : '（仅本机）'));
  if (r.restartRequired) parts.push(r.restartHost === 'desktop' ? '请退出桌面应用后重新打开，以刷新会话列表' : '请重启 DSH，以刷新会话列表');
  if (r.skipped) parts.push('跳过(' + r.skipped + ')');
  if (r.error === 'auth') parts.push('凭据缺失: ' + (r.hint || '请先 gh auth login 或配置 PAT,再点同步'));
  else if (r.error) parts.push('未完成: ' + (r.hint || r.error));
  if (r.workspaces && r.workspaces.total) {
    const w = r.workspaces;
    const wparts = [];
    if (w.synced) wparts.push(w.synced + ' 个工作区已同步');
    if (w.pushed) wparts.push(w.pushed + ' 个已推送');
    if (w.pulled) wparts.push(w.pulled + ' 个已拉取');
    if (wparts.length) parts.push('工作区: ' + wparts.join(','));
    if (w.errors && w.errors.length) parts.push('工作区失败: ' + w.errors.map((e) => (e.title || e.id || '?')).join(', '));
  }
  if (!parts.length) parts.push('已是最新,无需变更');
  return parts.join(';');
}

/** 从一次同步结果里抽出可供状态接口展示/排障的摘要(不含敏感信息) */
function lastDetail(r) {
  if (!r) return null;
  const w = r.workspaces;
  const conflictCopies = [
    ...(Array.isArray(r.conflictCopies) ? r.conflictCopies : []),
    ...(w && Array.isArray(w.conflictCopies) ? w.conflictCopies : []),
  ];
  return {
    committed: Boolean(r.committed),
    pushed: Boolean(r.pushed),
    pulled: r.pulled || null,
    error: r.error || null,
    dataVerificationPending: r.dataVerificationPending === true,
    dataRepairQueued: r.dataRepairQueued === true,
    cancelled: r.cancelled === true,
    skipped: r.skipped || null,
    conflicts: Array.isArray(r.conflicts) ? r.conflicts : [],
    sessionWarnings: Array.isArray(r.sessionWarnings) ? r.sessionWarnings : [],
    sessionDeferred: Array.isArray(r.sessionDeferred) ? r.sessionDeferred.map(({ file, reason, hint }) => ({ file, reason, hint })) : [],
    scopeWarnings: Array.isArray(r.scopeWarnings) ? r.scopeWarnings : [],
    privacy: r.privacy || null,
    privacyReports: r.privacyReports || [],
    issues: syncIssues(r),
    review: r.review || null,
    needsReview: r.needsReview === true,
    conflictCopies: conflictCopies.map((c) => ({ kind: c.kind, id: c.id || null, path: c.path, copy: c.copy, conflictAt: c.conflictAt })),
    backupBranch: r.backupBranch || null,
    backupPushed: r.backupPushed === true,
    restartRequired: r.restartRequired === true,
    downloadPending: r.downloadPending === true,
    restartHost: r.restartHost || null,
    workspaces: w ? {
      total: w.total || 0,
      synced: w.synced || 0,
      pushed: w.pushed || 0,
      pulled: w.pulled || 0,
      skipped: w.skipped || null,
      errors: Array.isArray(w.errors) ? w.errors.map((e) => ({ id: e.id, title: e.title, path: e.path, error: e.error, operation: e.operation, gitError: e.gitError })) : [],
      backups: Array.isArray(w.backups) ? w.backups.map((b) => ({ id: b.id, branch: b.branch, pushed: b.pushed === true })) : [],
      created: Array.isArray(w.created) ? w.created.map((c) => ({ id: c.id, title: c.title, path: c.path, recorded: c.recorded })) : [],
    } : null,
    durationMs: r.durationMs || null,
    repoSize: r.repoSize || null,
    stages: Array.isArray(r.stages) ? r.stages.map((s) => ({ stage: s.stage, label: s.label, ms: s.ms })) : [],
    transfers: Array.isArray(r.transfers) ? r.transfers.map((t) => ({ op: t.op, label: t.label || null, size: t.size, speed: t.speed, totalObjects: t.totalObjects, reused: t.reused })) : [],
  };
}

/* ================= 会话内容预览 —— 冲突拷贝两侧内容展示 ================= */

/** 读会话投影缓存:标题/创建时间 */
function readProjection(home, id) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(home, 'storages', 'session_projcache', 'sessions', id + '.json'), 'utf8'));
    let title = p?.record?.rows?.title?.val;
    if (title && typeof title === 'object') title = title.title;
    const createdAt = Number(p?.record?.identity?.createdAt) || 0;
    return { title: typeof title === 'string' ? title : '', createdAt };
  } catch { return { title: '', createdAt: 0 }; }
}

/** 简易行级 diff(LCS),用于配置文件冲突预览;返回 unified-diff 风格文本 */
function unifiedTextDiff(aText, bText, aLabel = '本机', bLabel = '远端拷贝', maxLines = 400) {
  const a = String(aText || '').split('\n');
  const b = String(bText || '').split('\n');
  const n = a.length, m = b.length;
  if (n * m > 4_000_000) {
    // 大文件:退化为按内容集合的差异摘要(不做位置对齐),避免内存与耗时
    const setB = new Set(b);
    const onlyA = a.filter((x) => !setB.has(x));
    const setA = new Set(a);
    const onlyB = b.filter((x) => !setA.has(x));
    const cap = 100;
    return `--- ${aLabel}\n+++ ${bLabel}\n\n[文件较大(${n} vs ${m} 行),给出差异摘要]\n本机独有 ${onlyA.length} 行:\n${onlyA.slice(0, cap).map((x) => '-' + x).join('\n')}\n\n远端独有 ${onlyB.length} 行:\n${onlyB.slice(0, cap).map((x) => '+' + x).join('\n')}`;
  }
  const stride = m + 1;
  const dp = new Int32Array((n + 1) * stride);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const idx = i * stride + j;
      dp[idx] = a[i] === b[j] ? dp[(i + 1) * stride + j + 1] + 1 : Math.max(dp[(i + 1) * stride + j], dp[i * stride + j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push(' ' + a[i]); i++; j++; }
    else if (dp[(i + 1) * stride + j] >= dp[i * stride + j + 1]) { out.push('-' + a[i]); i++; }
    else { out.push('+' + b[j]); j++; }
  }
  while (i < n) out.push('-' + a[i++]);
  while (j < m) out.push('+' + b[j++]);
  const head = `--- ${aLabel}\n+++ ${bLabel}\n`;
  return out.length > maxLines ? head + out.slice(0, maxLines).join('\n') + `\n…(共 ${out.length} 行差异,已截断)` : head + out.join('\n');
}

/* ================= 会话内容预览 —— 读取会话日志(JSONL,zstd 压缩),抽取可展示的消息 ================= */

/** 把 .jsonl.zstd 的多个 zstd 帧串联解码为 UTF-8 文本(跳过损坏帧);非 zstd 内容原样返回 */
function decodeSessionText(buf, isZstd) {
  // 按魔数识别 zstd(冲突拷贝后缀不是 .zstd,但内容仍是压缩帧)
  const looksZstd = isZstd || (buf.length >= 4 && buf.subarray(0, 4).equals(ZSTD_MAGIC));
  if (!looksZstd) return buf.toString('utf8');
  if (typeof zstdDecompressSync !== 'function') throw new Error('当前 Node 版本不支持 zstd 解码(需 Node ≥ 22.10),无法预览会话内容');
  return decodeZstdFrames(buf) ?? buf.toString('utf8');
}

/** 从消息 content 部分抽取文本(支持数组或字符串) */
function partsToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const out = [];
  for (const p of content) {
    if (p && typeof p === 'object' && p.type === 'text' && typeof p.text === 'string') out.push(p.text);
  }
  return out.join('\n');
}

const PREVIEW_MAX_MESSAGES = 60; // 最多返回最近 60 条消息
const PREVIEW_MAX_TEXT = 4000;   // 每条消息文本最多 4000 字符

/** 按文件路径读会话预览(冲突拷贝等非标准路径也用得上) */
function readSessionPreviewPath(home, file, idHint) {
  let text;
  try {
    text = decodeSessionText(fs.readFileSync(file), file.endsWith('.zstd'));
  } catch (e) {
    return { id: idHint || '', found: true, error: String((e && e.message) || e), title: '', messageCount: 0, truncated: false, messages: [] };
  }
  const all = [];
  let title = '';
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || typeof rec !== 'object' || typeof rec.type !== 'string') continue;
    if (rec.type === 'session/title' && rec.data && typeof rec.data.title === 'string' && !title) {
      title = rec.data.title;
      continue;
    }
    if (rec.type === 'user/message') {
      const d = rec.data || {};
      // 只取真实用户输入(跳过系统注入的上下文快照等)
      if (d.source && d.source.kind && d.source.kind !== 'user') continue;
      const t = partsToText(d.content);
      if (t) all.push({ role: 'user', text: t, time: rec.time || 0 });
    } else if (rec.type === 'assistant/message') {
      const m = rec.data && rec.data.message;
      if (!m || !Array.isArray(m.content)) continue;
      const t = partsToText(m.content);
      if (t) all.push({ role: 'assistant', text: t, time: rec.time || 0 });
    }
  }
  const meaningful = all.filter((m) => m.text && m.text.trim());
  const total = meaningful.length;
  const truncated = total > PREVIEW_MAX_MESSAGES || meaningful.some((m) => m.text.length > PREVIEW_MAX_TEXT);
  const msgs = meaningful.slice(-PREVIEW_MAX_MESSAGES).map((m) => ({
    role: m.role,
    time: m.time,
    text: m.text.length > PREVIEW_MAX_TEXT ? m.text.slice(0, PREVIEW_MAX_TEXT) + '\n…(内容过长,已截断)' : m.text,
  }));
  if (!title) {
    const proj = readProjection(home, idHint);
    title = proj.title || '';
  }
  return { id: idHint || '', found: true, title, messageCount: total, truncated, messages: msgs };
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
  engine.sendGuard = createSendGuard(engine);
  if (typeof ctx.inject === 'function') ctx.inject(['sessionController'], protectedCtx => {
    const restore = protectPrompt(protectedCtx.sessionController, engine.sendGuard);
    protectedCtx.effect(() => restore);
  });
  else if (ctx.sessionController) disposers.push(protectPrompt(ctx.sessionController, engine.sendGuard));
  registerHost(home); // Keep the lease until the process exits, even on plugin unload.
  const previousSync = readSyncStatus(home);
  if (previousSync && !configError) {
    engine.lastSyncAt = previousSync.at; engine.lastOutcome = { ...previousSync.result };
    if (engine.lastOutcome.needsReview && !engine.lastOutcome.privacy) engine.lastOutcome = { deferred: true, message: '正在后台重新核对上次未完成的同步。' };
    if (previousSync.hostPid && previousSync.hostPid !== process.pid && !engine.lastOutcome.downloadPending)
      engine.lastOutcome.restartRequired = false;
  }
  // First-run setup stays accessible until a repository has been configured.
  const startupRequired = Boolean(cfg.remote) && cfg.autoPullOnStart !== false && cfg.enabled !== false && !pendingDataVerification(engine).length;
  const startup = { required: startupRequired,
    phase: startupRequired ? 'running' : 'ready', message: '' };
  let startupPromise = null;
  let startupAttempt = 0;
  const runStartup = (approval) => {
    if (startupPromise) return startupPromise;
    const attempt = ++startupAttempt;
    startup.phase = 'running'; startup.message = '启动同步中，请稍候…'; delete startup.review; delete startup.issues; delete startup.detail;
    startupPromise = engine.syncOnce('startup', { forceCommit: true, waitForLock: true, approval }).then(result => {
      if (attempt !== startupAttempt) return result;
      if (result.cancelled) { startup.phase = 'offline'; startup.message = '本次同步已取消，离线使用。'; return result; }
      if (result.needsReview && !result.privacy && result.review) {
        startup.review = result.review; startup.phase = 'review';
        startup.message = '同步等待你的确认，尚未完成。'; return result;
      }
      if (result.error || result.workspaces?.errors?.length) {
        startup.issues = syncIssues(result); startup.detail = lastDetail(result);
        throw new Error(summarize(result));
      }
      startup.phase = result.downloadPending ? 'pending' : 'ready';
      startup.message = result.downloadPending ? '部分旧会话等待安全写入；新会话与草稿可继续使用。' : '';
      return result;
    }).catch(e => { if (attempt === startupAttempt) { startup.phase = 'error'; startup.message = e.message; startup.issues ||= syncIssues({ error: e.message }); } return { error: e.message }; })
      .finally(() => { startupPromise = null; });
    return startupPromise;
  };
  if (startup.required && previousSync?.source === 'startup-offline'
    && !previousSync.result?.needsReview
    && !/另一 DSH 进程正在同步/.test(previousSync.result?.error || '')
    && (previousSync.result?.error || previousSync.result?.downloadPending || previousSync.result?.workspaces?.errors?.length)) {
    startup.phase = 'error'; startup.message = summarize(previousSync.result);
    startup.issues = syncIssues(previousSync.result); startup.detail = lastDetail(previousSync.result);
  }


  /* ================= 补丁管理 —— patches/ 随主仓库跨机同步,启动/同步后自动套用到 node_modules ================= */
  // 应用发生在 dsh 启动之后,当前进程仍是旧代码 → 重启 dsh 生效;幂等(内容一致即跳过)。
  let patchResults = [];
  let patchAppliedAt = 0;
  const runPatches = (reason) => {
    if (cfg.patches === false) return;
    // Desktop bundles its core runtime inside app.asar. These patches target the separately
    // installed Web runtime; running them from Desktop would silently modify the other host.
    if (isDesktopHostProcess()) return;
    try {
      const t0 = Date.now();
      const r = applyAllPatches(home);
      patchResults = r.results;
      patchAppliedAt = r.appliedAt;
      if (patchResults.length) {
        for (const line of formatApplyResults(patchResults)) log('info', `补丁[${reason}]: ${line}`);
        log('info', `补丁检查完成(${patchResults.length} 个,${Date.now() - t0}ms;套用需重启 dsh 生效)`);
      }
    } catch (e) {
      log('warn', '补丁应用失败: ' + String((e && e.message) || e));
    }
  };
  const patchesSummaryText = () => {
    // 桌面端不参与这套补丁机制(补丁只作用于独立 Web 运行时的 node_modules),
    // 不返回任何文本:设置页的同步状态卡不该出现一句与同步无关的本机限制说明。
    if (isDesktopHostProcess()) return '';
    if (cfg.patches === false || !patchResults.length) return '';
    const lines = formatApplyResults(patchResults);
    return lines.join(';') + (patchAppliedAt ? `(${new Date(patchAppliedAt).toLocaleString()})` : '');
  };
  // 启动即套用一次(DSH 升级覆盖 node_modules 后,重启就能补回;跨机拉到新补丁同样生效)
  runPatches('startup');
  const scheduler = createSyncScheduler({
    loadConfig: () => engine.loadConfig(),
    sync: () => runStartup(),
    afterSync: () => runPatches('after-sync'),
    log,
  });
  const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const json = (res, code, payload) => {
    res.writeHead(code, jsonHeaders);
    res.end(JSON.stringify(payload));
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (d) => { buf += d; });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
  engine.onSyncOutcome = result => {
    // A later successful manual round supersedes an old offline/review snapshot.
    if (result.error || result.cancelled || result.deferred || result.needsReview || result.downloadPending) return;
    delete startup.review; delete startup.issues; delete startup.detail;
    startup.phase = 'ready'; startup.message = '';
  };

  // —— API 路由:供浏览器端原生 UI(侧栏按钮 / 设置同步状态卡)调用 ——
  const checkUpdates = createUpdateChecker();
  try {
    disposers.push(ctx.webServer.register({
      kind: 'exact', path: '/dsh-sync/api/send-check',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          const body = JSON.parse(await readBody(req) || '{}');
          const state = engine.sendGuard.check(body?.sessionId);
          json(res, 200, { ok: true, ...state });
        } catch { json(res, 400, { ok: false, allowed: false, message: '发送前检查失败，消息未发送。' }); }
      },
    }));
    disposers.push(ctx.webServer.register({
      kind: 'exact', path: '/dsh-sync/api/startup',
      handler: async (req, res) => {
        if (req.method === 'GET') return json(res, 200, { ok: true, startup, progress: engine.progress || {} });
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        let body;
        try { body = JSON.parse(await readBody(req) || '{}'); }
        catch { return json(res, 400, { ok: false, error: '启动同步请求格式无效' }); }
        if (!body || typeof body !== 'object') return json(res, 400, { ok: false, error: '启动同步请求格式无效' });
        if (body.action === 'offline' && ['running', 'review', 'error', 'cancelling'].includes(startup.phase)) {
          ++startupAttempt; // A late result must not reopen the gate or schedule a restart.
          startup.phase = 'cancelling'; startup.message = '正在停止同步，已保存的改动会保留…';
          await engine.cancelSync();
          if (startupPromise) await startupPromise;
          startup.phase = 'offline'; startup.message = '本次离线使用，尚未确认远端最新数据。';
        } else if (body.action === 'confirm') {
          if (startup.phase !== 'review' || !startup.review?.id || body.approval !== startup.review.id)
            return json(res, 409, { ok: false, error: '预览已变化，请查看当前内容后重新确认。', startup });
          runStartup(body.approval);
        } else if (body.action === 'retry' && startup.phase !== 'cancelling' && startup.phase !== 'restarting') runStartup();
        else return json(res, 400, { ok: false, error: '当前不能执行此操作' });
        json(res, 200, { ok: startup.phase !== 'error', startup });
      },
    }));
    disposers.push(ctx.webServer.register({
      kind: 'exact', path: '/dsh-sync/api/update',
      handler: async (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
        json(res, 200, await checkUpdates(isDesktopHostProcess() ? 'desktop' : 'web'));
      },
    }));
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-sync/api/run',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        try {
          // 手动触发:免提交节流,点一下立刻提交
          const body = JSON.parse((await readBody(req)) || '{}');
          const r = await engine.syncOnce('web-button', { forceCommit: true, approval: body.approval });
          if (!r.error && !r.cancelled && !r.needsReview && !r.workspaces?.errors?.length) runPatches('after-sync');
          json(res, 200, { ok: !r.error && !r.cancelled && !r.needsReview && !r.downloadPending && !r.deferred && !(r.workspaces?.errors?.length), summary: summarize(r), detail: r });
        } catch (e) {
          json(res, 200, { ok: false, error: String((e && e.message) || e) });
        }
      },
    }));
    disposers.push(ctx.webServer.register({
      kind: 'exact', path: '/dsh-sync/api/cancel',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        let body;
        try { body = JSON.parse(await readBody(req) || '{}'); }
        catch { return json(res, 400, { ok: false, error: '取消请求格式无效' }); }
        if (!body || typeof body.runId !== 'string' || !body.runId)
          return json(res, 400, { ok: false, error: '请先读取当前同步状态' });
        if (!engine.inFlight || engine._syncControl?.id !== body.runId)
          return json(res, 409, { ok: false, error: '本轮同步已结束或已切换，请查看最新状态。' });
        try {
          await engine.cancelSync();
          json(res, 200, { ok: true, runId: body.runId, message: '已停止本轮同步；已完成的保存或上传保留。' });
        } catch (e) { json(res, 200, { ok: false, error: e.message }); }
      },
    }));
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-sync/api/status',
      handler: (req, res) => {
        const c = engine.loadConfig();
        const autoWanted = c.enabled !== false;
        // 会话活动(是否有会话正在生成):供界面提示「重启会打断哪些会话」;探测失败按未知处理,不影响接口
        const activity = engine.sessionActivity({ titles: true });
        const activeIds = Array.isArray(activity.activeIds) ? activity.activeIds.map(String) : [];
        const activeTitles = activity.titles && typeof activity.titles === 'object' ? activity.titles : {};
        json(res, 200, {
          ok: true,
          remote: c.remote || '',
          configError: c.configError || null,
          queuedRepairs: queuedDataRepairs(engine).length,
          dataVerificationPending: pendingDataVerification(engine).length > 0,
          autoRepo: c.autoRepo !== false,
          branch: c.branch,
          contentScope: c.contentScope, workspaceSync: c.workspaceSync !== false,
          mode: c.mode || 'manual',
                automatic: c.enabled !== false,
          auto: scheduler.active,
          autoConfigured: autoWanted,
          gitMissing: engine.gitMissing,
          workspaceCount: typeof engine.workspaces === 'function' ? engine.workspaces().length : 0,
          ungroupedCount: typeof engine.ungroupedSessionIds === 'function' ? engine.ungroupedSessionIds().length : 0,
          activeSessionCount: activity.activeCount || 0,
          activeSessionIds: activeIds,
          /* 界面显示用:会话名(name 解析不到时为空,由前端退化为工作目录名/短 id) */
          activeSessions: activeIds.slice(0, 5).map((id) => ({ id, name: activeTitles[id] || '' })),
          sessionActivitySource: activity.source || 'none',
          lastSyncAt: engine.lastSyncAt,
          lastOk: engine.lastOutcome ? !engine.lastOutcome.error && !engine.lastOutcome.cancelled && !engine.lastOutcome.downloadPending && !engine.lastOutcome.deferred && !engine.lastOutcome.workspaces?.errors?.length : null,
          lastMessage: engine.lastOutcome ? summarize(engine.lastOutcome) : '',
          lastDetail: lastDetail(engine.lastOutcome),
          startup, previousExitSync: previousSync,
          patches: patchesSummaryText(),
          autoRestartAfterRepair: c.autoRestartAfterRepair === true,
          restartAvailable: engine.restartAvailable(),
          hostKind: isDesktopHostProcess() ? 'desktop' : 'web',
          buildRevision, dshVersion, currentVersion: JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
          handoff: engine.handoffStatus(),
        });
      },
    }));
    for (const [endpoint, operation] of [
      ['preview', () => engine.localPreview()],
      ['doctor', () => engine.doctor()],
      ['recovery', () => ({ records: engine.recovery.list().map(record => ({ ...record, category: recoveryCategory(record), guide: recoveryGuide(record, dshVersion) })) })],
    ]) {
      disposers.push(ctx.webServer.register({ kind: 'exact', path: '/dsh-sync/api/' + endpoint,
        handler: async (req, res) => {
          if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
          try { json(res, 200, { ok: true, ...(await operation()) }); }
          catch (e) { json(res, 200, { ok: false, error: e.message }); }
        } }));
    }
    for (const action of ['preview', 'restore', 'import-session', 'preserve-branches', 'archive']) {
      disposers.push(ctx.webServer.register({ kind: 'exact', path: '/dsh-sync/api/recovery/' + action,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
          try {
            const body = JSON.parse(await readBody(req));
            if (action === 'archive') {
              if (engine.inFlight) throw new Error('同步正在进行，请稍后归档');
              const release = engine.acquireProcessLock();
              if (!release) throw new Error('另一 DSH 进程正在同步，请稍后归档');
              try { return json(res, 200, engine.recovery.archive(body.id, body.expectedVersions, body.archived !== false)); }
              finally { release(); }
            }
            if (action === 'preview') {
              let branches = null; try { branches = await compareRecoveryBranches(engine, body.id); } catch {}
              return json(res, 200, { ok: true, ...engine.recoveryPreview(body.id), branches,
                sessionImport: await sessionRecoveryOptions(engine, ctx, body.id) });
            }
            if (action === 'preserve-branches') return json(res, 200, await preserveRecoveryBranches(engine, ctx, body));
            if (action === 'import-session') return json(res, 200, await importRecoverySession(engine, ctx, body));
            if (body.expectedHash !== null && !/^[a-f0-9]{64}$/.test(body.expectedHash || '')) throw new Error('请先预览当前文件');
            json(res, 200, await engine.restoreRecovery(body.id, body.side, body.expectedHash));
          } catch (e) { json(res, 200, { ok: false, error: e.message }); }
        } }));
    }
    for (const action of ['scan', 'preview', 'queue', 'restart', 'cancel', 'workspace-path', 'import', 'verify']) {
      disposers.push(ctx.webServer.register({ kind: 'exact', path: '/dsh-sync/api/data-health/' + action,
        handler: async (req, res) => {
          if (req.method !== (action === 'scan' ? 'GET' : 'POST')) return json(res, 405, { ok: false, error: 'method not allowed' });
          try {
            if (action === 'scan') return json(res, 200, { ok: true, ...scanDataHealth(engine), verificationPending: pendingDataVerification(engine).length > 0 });
            const body = JSON.parse(await readBody(req));
            if (action === 'preview') {
              const scan = scanDataHealth(engine);
              const issue = scan.issues.find(item => item.key === body.key)
                || (body.relocate ? scan.ungroupedSessions.find(item => item.key === body.key || item.sessionId === body.sessionId) : null);
              if (issue?.kind === 'relocate' || body.relocate) return json(res, 200, { ok: true, ...await previewSessionRelocation(engine, ctx, issue) });
              return json(res, 200, { ok: true, ...(body.backupId ? previewDataRollback(engine, body.backupId) : await previewDataRepair(engine, body)) });
            }
            if (engine.inFlight) throw new Error('同步正在进行，请完成后再修复');
            if (action === 'verify') {
              const verified = acknowledgeDataRepairs(engine);
              engine.lastOutcome = { repaired: true, verificationAcknowledged: true };
              saveSyncStatus(home, engine.lastOutcome, 'data-verified');
              return json(res, 200, { ok: true, ...verified });
            }
            if (action === 'import') return json(res, 200, await importRelocatedSession(engine, ctx, body));
            if (action === 'workspace-path') {
              if (!engine.workspaces().some(ws => ws.id === body.workspaceId) || !path.isAbsolute(body.localPath || '')) throw new Error('请选择已登记项目并填写本机完整目录');
              const target = canonicalWorkspacePath(body.localPath), data = canonicalWorkspacePath(home);
              if (target === data || target.startsWith(data + path.sep) || data.startsWith(target + path.sep)) throw new Error('项目目录不能与 DSH 数据目录重叠');
              engine.setLocalWorkspacePath(body.workspaceId, body.localPath);
              return json(res, 200, { ok: true, hint: '已保存本机项目位置，下次同步前会重新核对目录是否重叠。' });
            }
            if (action === 'cancel') return json(res, 200, { ok: true, ...cancelQueuedDataRepairs(engine) });
            if (action === 'queue') return json(res, 200, { ok: true, ...queueDataRepair(engine, body.planId) });
            const activity = engine.sessionActivity();
            if (!activity.available || activity.activeCount > 0) throw new Error('请等待当前对话结束，再关闭并修复');
            if (!queuedDataRepairs(engine).length) throw new Error('没有已确认的修复计划');
            const result = scheduleOfflineSync(engine, { repair: true });
            if (!result.scheduled) throw new Error(result.reason);
            startup.phase = 'restarting';
            json(res, 200, { ok: true, hint: '将关闭应用，修复已确认的项目，然后重新打开；不会连接同步仓库。' });
          } catch (e) { json(res, 200, { ok: false, error: e.message }); }
        } }));
    }
    disposers.push(ctx.webServer.register({
      kind: 'exact', path: '/dsh-sync/api/connection',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          const result = await saveConnection(engine, JSON.parse((await readBody(req)) || '{}'));
          scheduler.refresh();
          json(res, 200, { ok: true, ...result });
        } catch (error) { json(res, 200, { ok: false, error: error.message }); }
      },
    }));
    // —— 配置读写:保存「同步后自动重启」等开关到 dsh-sync.json(与插件默认值/引擎逐层合并) ——
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-sync/api/config',
      handler: async (req, res) => {
        try {
          if (req.method === 'GET') {
            const c = engine.loadConfig();
            if (c.configError) throw new Error(c.configError);
            json(res, 200, {
              ok: true,
              config: {
                mode: c.mode || 'manual',
                automatic: c.enabled !== false,
                enabled: c.enabled !== false,
                intervalSeconds: c.intervalSeconds,
                autoPullOnStart: c.autoPullOnStart,
                autoPushOnExit: c.autoPushOnExit,
                workspaceSync: c.workspaceSync !== false,
                contentScope: c.contentScope,
                autoRestartAfterRepair: c.autoRestartAfterRepair === true,
                showSidebarSync: c.showSidebarSync !== false,
                proxy: c.proxy || '',
                remote: c.remote || '',
                branch: c.branch,
                autoRepo: c.autoRepo !== false,
              },
            });
            return;
          }
          if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return; }
          const body = JSON.parse((await readBody(req)) || '{}');
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('配置必须是 JSON 对象');
          const sidebarOnly = Object.keys(body).length === 1 && Object.hasOwn(body, 'showSidebarSync');
          if (engine.progress?.running && !sidebarOnly) throw new Error('同步正在进行，请完成后再保存设置。');
          const cfgFile = path.join(home, 'dsh-sync.json');
          // 只接受白名单字段；连接地址不接收访问令牌。
          const patch = {};
          if (body.showSidebarSync !== undefined) {
            if (typeof body.showSidebarSync !== 'boolean') throw new Error('侧边栏显示选项必须为布尔值。');
            patch.showSidebarSync = body.showSidebarSync;
          }
          if (body.remote !== undefined) {
            if (typeof body.remote !== 'string' || (body.remote.trim() && !parseSyncRemote(body.remote))) throw new Error('请输入 GitHub 私有仓库的 HTTPS 或 SSH 地址，不要包含访问令牌。');
            patch.remote = body.remote.trim();
          }
          if (body.branch !== undefined) {
            if (typeof body.branch !== 'string' || !body.branch.trim() || body.branch.includes('@{') || (await engine.git(['check-ref-format', '--branch', body.branch.trim()])).code !== 0) throw new Error('请输入有效的同步分支名，例如 main，并确认已安装 Git。');
            patch.branch = body.branch.trim();
          }
          if (body.autoRepo !== undefined) {
            if (typeof body.autoRepo !== 'boolean') throw new Error('自动建仓选项必须为布尔值');
            patch.autoRepo = body.autoRepo;
          }
          if (body.autoRestartAfterRepair !== undefined) patch.autoRestartAfterRepair = body.autoRestartAfterRepair === true;
          if (body.workspaceSync !== undefined) patch.workspaceSync = body.workspaceSync !== false;
          if (body.contentScope !== undefined) patch.contentScope = normalizeScope(body.contentScope);
          if (body.autoPullOnStart !== undefined) { patch.autoPullOnStart = body.autoPullOnStart === true; patch.lifecycleAutomation = 1; }
          if (body.autoPushOnExit !== undefined) { patch.autoPushOnExit = body.autoPushOnExit === true; patch.lifecycleAutomation = 1; }
          if (typeof body.mode === 'string' && ['manual', 'auto'].includes(body.mode)) patch.mode = body.mode;
          if (typeof body.proxy === 'string') patch.proxy = body.proxy.trim();
          /* 总开关只控制启动/退出；旧 mode/intervalSeconds 不再触发后台同步。 */
          if (body.enabled !== undefined) {
            if (typeof body.enabled !== 'boolean') throw new Error('自动同步开关必须是布尔值');
            patch.enabled = body.enabled;
          }
          if (body.automatic !== undefined) {
            if (typeof body.automatic !== 'boolean') throw new Error('自动同步开关必须是布尔值');
            if (body.mode !== undefined || body.enabled !== undefined) throw new Error('请只提供 automatic 自动同步开关。');
            patch.mode = body.automatic ? 'auto' : 'manual';
            patch.enabled = body.automatic;
            patch.lifecycleAutomation = 1;
          }
          if (body.intervalSeconds !== undefined) {
            const seconds = Number(body.intervalSeconds);
            if (!Number.isFinite(seconds) || seconds < 30 || seconds > 86400) throw new Error('自动同步间隔需在 30 秒到 24 小时之间。');
            patch.intervalSeconds = Math.round(seconds);
          }
          if (engine.inFlight && !sidebarOnly) throw new Error('同步正在进行，请完成后再保存设置。');
          // Read after async validation so another settings save cannot be lost.
          writeSyncConfig(cfgFile, patch);
          scheduler.refresh();
          const effective = engine.loadConfig();
          json(res, 200, { ok: true, saved: patch, auto: scheduler.active, autoConfigured: effective.enabled !== false, config: { automatic: effective.enabled !== false, mode: effective.mode, workspaceSync: effective.workspaceSync !== false, contentScope: effective.contentScope, enabled: effective.enabled !== false, intervalSeconds: effective.intervalSeconds, autoPullOnStart: effective.autoPullOnStart !== false, autoPushOnExit: effective.autoPushOnExit !== false, autoRestartAfterRepair: effective.autoRestartAfterRepair === true, showSidebarSync: effective.showSidebarSync !== false, remote: effective.remote || '', branch: effective.branch, autoRepo: effective.autoRepo !== false } });
        } catch (e) {
          json(res, 200, { ok: false, error: String((e && e.message) || e) });
        }
      },
    }));
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-sync/api/progress',
      handler: (req, res) => {
        const p = engine.progress || {};
        json(res, 200, {
          ok: true,
          running: Boolean(p.running),
          runId: engine.inFlight ? engine._syncControl?.id || null : null,
          cancelling: Boolean(engine.inFlight && engine._syncControl?.cancelled),
          canCancel: Boolean(engine.inFlight && engine._syncControl && !engine._syncControl.cancelled
            ),
          stage: p.stage || null,
          label: p.label || '',
          transfer: p.transfer || null,
          startedAt: p.startedAt || 0,
          lastSyncAt: engine.lastSyncAt,
          lastOk: engine.lastOutcome ? !engine.lastOutcome.error && !engine.lastOutcome.cancelled && !engine.lastOutcome.needsReview
            && !engine.lastOutcome.downloadPending && !engine.lastOutcome.deferred && !engine.lastOutcome.workspaces?.errors?.length : null,
          lastMessage: engine.lastOutcome ? summarize(engine.lastOutcome) : '',
        });
      },
    }));
    disposers.push(ctx.webServer.register({ kind: 'exact', path: '/dsh-sync/api/grouping',
      handler: (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
        try { json(res, 200, { ok: true, ...groupingRepairStatus(engine) }); }
        catch (e) { json(res, 200, { ok: false, error: e.message }); }
      },
    }));
    // —— 补丁管理:patches/ 随主仓库同步,这里查看状态/手动套用(套用后重启 dsh 生效)——
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-sync/api/patches',
      handler: (req, res) => {
        json(res, 200, { ok: true, enabled: cfg.patches !== false && !isDesktopHostProcess(), patches: patchResults, summary: patchesSummaryText(), appliedAt: patchAppliedAt });
      },
    }));
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-sync/api/patches/apply',
      handler: async (req, res) => {
        if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return; }
        if (isDesktopHostProcess()) { json(res, 200, { ok: false, error: patchesSummaryText() }); return; }
        runPatches('api');
        json(res, 200, { ok: true, patches: patchResults, summary: patchesSummaryText() });
      },
    }));
    // —— 历史冲突拷贝审计(只读):新版分层合并引擎已不再生成冲突拷贝,这里仅列出遗留项供清理参考 ——
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-sync/api/conflicts',
      handler: (req, res) => {
        try {
          const list = engine.outstandingConflicts();
          // 会话日志冲突:补上原标题(从投影缓存读),让用户能判断保留哪一侧;投影缓存冲突标记为可再生
          const CACHE = /^storages\/session_projcache\/sessions\/([^/]+)\.json$/i;
          for (const c of list) {
            const id = sessionIdOfLogPath(c.path);
            const cm = id ? null : CACHE.exec(c.path || '');
            if (id) {
              c.sessionId = id;
              c.title = readProjection(home, id).title || '(无标题)';
            } else if (cm && sessionIdPattern.test(cm[1])) {
              c.sessionId = cm[1];
              c.cache = true; // 可再生缓存:保留本机即可,下次同步会自动清理
              c.title = (readProjection(home, cm[1]).title || '(无标题)') + ' · 会话投影缓存(可再生)';
            } else {
              c.title = (c.path || '').split('/').pop() || c.path || '';
            }
          }
          json(res, 200, { ok: true, conflicts: list, count: list.length });
        } catch (e) {
          json(res, 200, { ok: false, error: String((e && e.message) || e) });
        }
      },
    }));
    // 冲突两侧内容预览:本机活动文件 vs 远端版本拷贝(标题 + 最近消息)
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-sync/api/conflict/preview',
      handler: async (req, res) => {
        if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return; }
        try {
          const body = JSON.parse((await readBody(req)) || '{}');
          const p = String(body.path || '');
          const cp = String(body.copy || '');
          const selected = engine.outstandingConflicts().find(c => c.path === p && c.copy === cp && c.kind === body.kind && (c.id || null) === (body.id || null));
          if (!selected) throw new Error('找不到对应的遗留冲突记录');
          const root = selected.kind === 'ws' ? engine.recoveryRoot({ kind: 'ws', workspaceId: selected.id }) : home;
          const idHint = sessionIdOfLogPath(p) || '';
          const localFile = safePath(root, p);
          if (idHint) {
            // 会话日志冲突:按消息预览
            const local = fs.existsSync(localFile) ? readSessionPreviewPath(home, localFile, idHint) : { id: idHint, found: false, title: '', messageCount: 0, truncated: false, messages: [] };
            let remote = { id: idHint, found: false, title: '', messageCount: 0, truncated: false, messages: [] };
            if (cp) {
              const remoteFile = safePath(root, cp);
              if (fs.existsSync(remoteFile)) remote = readSessionPreviewPath(home, remoteFile, idHint);
            }
            json(res, 200, { ok: true, kind: 'session', sessionId: idHint, local, remote });
          } else {
            // 配置文件冲突:文本 diff(本机 vs 远端拷贝),让用户能真正判断
            const readText = (file) => {
              if (!fs.existsSync(file)) return null;
              const buf = fs.readFileSync(file);
              if (buf.includes(0)) return { binary: true, bytes: buf.length };
              const MAX = 120 * 1024;
              let text = buf.toString('utf8');
              const truncated = text.length > MAX;
              if (truncated) text = text.slice(0, MAX) + '\n…(已截断)';
              return { text, bytes: buf.length, truncated };
            };
            const local = readText(localFile);
            let remote = null;
            if (cp) remote = readText(safePath(root, cp));
            const localText = local && !local.binary ? local.text : '';
            const remoteText = remote && !remote.binary ? remote.text : '';
            const diff = (!localText && !remoteText) ? '' : unifiedTextDiff(localText, remoteText);
            json(res, 200, { ok: true, kind: 'text', sessionId: idHint, local, remote, diff });
          }
        } catch (e) {
          json(res, 200, { ok: false, error: String((e && e.message) || e) });
        }
      },
    }));
    // 工作区路径覆盖:本机专属(不同步);可指定其他文件夹或清空恢复默认
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-sync/api/workspace/path',
      handler: async (req, res) => {
        if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return; }
        try {
          const body = JSON.parse((await readBody(req)) || '{}');
          const id = String(body.workspaceId || '').trim();
          if (!id) throw new Error('缺少 workspaceId');
          const p = String(body.path || '').trim();
          if (p) {
            const abs = path.resolve(p);
            try { fs.mkdirSync(abs, { recursive: true }); } catch (e) { throw new Error('无法创建文件夹 ' + abs + ': ' + (e && e.message)); }
            engine.setLocalWorkspacePath(id, abs);
          } else {
            engine.setLocalWorkspacePath(id, null);
          }
          json(res, 200, { ok: true, workspaceId: id, path: p || null });
        } catch (e) {
          json(res, 200, { ok: false, error: String((e && e.message) || e) });
        }
      },
    }));
  } catch (err) {
    log('warn', 'webServer 不可用,API 未注册(命令行同步仍可用): ' + String((err && err.message) || err));
  }

  // —— 历史冲突拷贝审计工具(只读):新版分层合并引擎不再生成冲突拷贝,仅用于查看/清理遗留项 ——
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
    disposers.push(tools.register({
      name: 'sync_conflicts',
      description: '只读列出历史遗留的冲突拷贝(.dsh-conflict-<时间戳>,主仓库或某个工作区)。新版同步已自动合并冲突、不再生成新拷贝,此工具仅用于审计/清理旧版本留下的副本,不用于人工裁决。',
      parameters: noParameters,
      output: toolOut,
      async execute() {
        const list = engine.outstandingConflicts();
        if (!list.length) return '(没有遗留的冲突拷贝 —— 新版同步已自动合并,无需人工裁决)';
        return list.map((c, i) =>
          `${i + 1}. ${c.kind === 'ws' ? '工作区[' + (c.id || '?') + ']' : '主仓库'} ${c.path}\n   本机版本: ${c.path}\n   远端版本拷贝: ${c.copy || '(无)'}`,
        ).join('\n');
      },
    }));
    // —— 补丁管理工具:patches/ 随同步仓库跨机分发,查看/套用本机补丁(web_fetch 代理回退等) ——
    disposers.push(tools.register({
      name: 'sync_patches',
      description: '查看并应用 dsh-chatsync 托管的 node_modules 补丁(如 web_fetch 直连失败回退系统代理)。补丁文件在 .dsh/patches/ 下、随同步仓库跨机分发,每次启动/同步后自动套用;应用后需重启 dsh 生效。无参数执行 = 检查并套用,返回每个补丁的当前状态。',
      parameters: noParameters,
      output: toolOut,
      async execute() {
        if (isDesktopHostProcess()) return patchesSummaryText();
        runPatches('tool');
        const lines = formatApplyResults(patchResults);
        return lines.length
          ? lines.join('\n') + '\n(套用后重启 dsh 生效;补丁文件与清单位于 .dsh/patches/<名字>/,随同步仓库跨机分发)'
          : '(补丁目录为空 —— 在 .dsh/patches/<名字>/ 放入 patch.json 清单与 payload 文件即可托管补丁,清单字段见插件 README「补丁管理」)';
      },
    }));
  } catch (err) {
    log('warn', '冲突拷贝审计工具注册失败: ' + String((err && err.message) || err));
  }

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

export { name, inject, apply, readSessionPreviewPath };
