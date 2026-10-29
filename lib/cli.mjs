// dsh-chatsync 手动同步入口:双击桌面「同步DSH.cmd」或在对话里让 agent 执行本脚本。
// 不依赖 dsh 是否运行;每次执行 = 提交本地快照 + 推送 + 拉取远端,一次完成(手动触发免提交节流)。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SyncEngine, resolveSyncConfig, formatTransfer, humanSize } from './sync.js';
import { liveHosts, saveSyncStatus } from './session-safety.js';
import {
  listSessionRepairs,
  previewSessionRepair,
  repairSessionImport,
  rollbackSessionRepair,
} from './session-repair.js';
import { readSyncConfig } from './config-file.js';

const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
let fileCfg = {};
try {
  fileCfg = readSyncConfig(path.join(home, 'dsh-sync.json'));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
let startupOverrides = {};
if (process.env.DSH_SYNC_OVERRIDES_FILE) {
  try {
    startupOverrides = JSON.parse(fs.readFileSync(process.env.DSH_SYNC_OVERRIDES_FILE, 'utf8'));
  } catch (e) {
    console.error('无法读取宿主同步设置：' + e.message);
    process.exit(1);
  }
}
const cfg = resolveSyncConfig(fileCfg, startupOverrides);
const startupOffline = process.argv.includes('--startup-offline');
if (startupOffline && liveHosts(home).length) {
  const result = { error: '还有 DSH 宿主正在运行，未应用远端会话；请关闭所有使用此数据目录的宿主后重试。' };
  saveSyncStatus(home, result, 'startup-offline');
  console.error(result.error);
  process.exit(1);
}

// Host-independent diagnostics share the same read-only engine methods.
const diagnostic = process.argv[2];
if (diagnostic?.startsWith('--session-repair-')) {
  const probe = new SyncEngine(home, { autoRepo: false }),
    args = process.argv.slice(3);
  try {
    let result;
    if (diagnostic === '--session-repair-list' && !args.length) result = listSessionRepairs(probe);
    else if (diagnostic === '--session-repair-preview' && args.length === 2)
      result = previewSessionRepair(probe, args[0], args[1]);
    else if (diagnostic === '--session-repair-apply' && args.length === 2 && args[1] === '--offline-dsh-closed')
      result = await repairSessionImport(probe, args[0], { offline: true });
    else if (diagnostic === '--session-repair-rollback' && args.length === 2 && args[1] === '--offline-dsh-closed')
      result = await rollbackSessionRepair(probe, args[0], { offline: true });
    else throw new Error('无效的停机会话修复参数；未执行同步');
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    process.exit(0);
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e.message }));
    process.exit(1);
  }
}
if (diagnostic && !['--status', '--preview', '--doctor', '--approve', '--startup-offline'].includes(diagnostic)) {
  console.error('未知参数，未执行同步。');
  process.exit(1);
}
if (['--status', '--preview', '--doctor'].includes(diagnostic)) {
  const probe = new SyncEngine(home, { autoRepo: false });
  const value =
    diagnostic === '--status'
      ? { handoff: probe.handoffStatus() }
      : diagnostic === '--preview'
        ? await probe.localPreview()
        : probe.doctor();
  console.log(JSON.stringify(value, null, 2));
  process.exit(0);
}

const log = (level, msg) => {
  const line = `[dsh-chatsync] ${msg}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

if (!cfg.remote) {
  log(
    'warn',
    '尚未配置 remote —— 编辑 ' + path.join(home, 'dsh-sync.json') + ' 填入 GitHub 私有仓库地址;本次只做本地快照。',
  );
}

// 手动触发:免提交节流
const engine = new SyncEngine(home, { ...startupOverrides, minCommitIntervalSeconds: 0 }, log);

// —— 实时进度:轮询 engine.progress,阶段切换时打印(带总计时;连续同名阶段如多个工作区按标签区分)——
let lastStageKey = null;
const poll = setInterval(() => {
  const p = engine.progress;
  if (!p || !p.running) return;
  const key = (p.stage || '') + '|' + (p.label || '');
  if (key !== lastStageKey) {
    lastStageKey = key;
    const el = p.startedAt ? '+' + ((Date.now() - p.startedAt) / 1000).toFixed(1) + 's' : '';
    console.log(`  ▶ ${p.label || p.stage}${el ? ' (' + el + ')' : ''}`);
  }
}, 200);

const syncReason = startupOffline ? 'startup-offline' : 'manual-cli';
const syncOptions = { forceCommit: true, waitForLock: startupOffline, offlineApply: startupOffline };
let r = await engine.syncOnce(syncReason, syncOptions).catch(e => ({ error: String(e?.message || e) }));
const answers = review => (review ? [review.id, ...(review.alternatives || []).map(choice => choice.id)] : []);
if (r.needsReview && process.argv[2] === '--approve' && answers(r.review).includes(process.argv[3])) {
  r = await engine
    .syncOnce(syncReason, { ...syncOptions, approval: process.argv[3] })
    .catch(e => ({ error: String(e?.message || e) }));
}
clearInterval(poll);
if (startupOffline) saveSyncStatus(home, r, 'startup-offline');

const parts = [];
if (r.downloadPending) parts.push('已有会话更新尚未应用，请关闭宿主后安全取回；本机原件保留');
if (r.cancelled) parts.push(r.message || '本次同步已取消');
const upBytes = (r.transfers || []).filter(t => t.op === 'push').reduce((a, t) => a + (t.size || 0), 0);
const downBytes = (r.transfers || []).filter(t => t.op === 'fetch').reduce((a, t) => a + (t.size || 0), 0);
if (r.committed) parts.push('已提交本地快照');
if (r.pulled) parts.push(`已拉取远端(${r.pulled}${downBytes ? ',下载 ' + humanSize(downBytes) : ''})`);
if (r.pushed) parts.push('已推送远端' + (upBytes ? `(上传 ${humanSize(upBytes)})` : ''));
if (r.conflicts?.length) parts.push(r.conflicts.length + ' 个冲突已按类型处理');
for (const w of r.sessionWarnings || [])
  parts.push('会话未混合合并: ' + w.path + '；原件提交 ' + w.localHead + ' / ' + w.remoteHead);
if (r.backupBranch) parts.push('远端旧版本备份在 ' + r.backupBranch + (r.backupPushed ? '（已上传）' : '（仅本机）'));
if (r.restartRequired) parts.push('会话列表需刷新，请重启正在使用的 DSH');
if (r.error) parts.push('出错: ' + r.error);
if (r.needsReview) {
  console.log(r.review.summary);
  console.log((r.review.confirmLabel || '确认') + ' ID: ' + r.review.id);
  for (const choice of r.review.alternatives || []) console.log(choice.label + ' ID: ' + choice.id);
}
if (r.workspaces?.errors?.length) parts.push(r.workspaces.errors.length + ' 个工作区同步失败');
if (r.skipped) parts.push('跳过: ' + r.skipped);
const failed = !!r.error || !!r.cancelled || !!r.downloadPending || !!r.deferred || !!r.workspaces?.errors?.length;
console.log(
  parts.length
    ? (failed ? '>> 同步未完成: ' : '>> 同步完成: ') + parts.join('；')
    : '>> 没有需要同步的变更(本地与远端一致)',
);

// —— 本次同步明细:阶段耗时 / 各仓库传输量 / 仓库体积 ——
if (r.stages && r.stages.length) {
  console.log('== 耗时构成(秒) ==');
  for (const s of r.stages) {
    if (s.ms >= 50) console.log(`   ${String(s.stage).padEnd(10)} ${(s.ms / 1000).toFixed(1).padStart(6)}  ${s.label}`);
  }
  console.log(`   总耗时      ${((r.durationMs || 0) / 1000).toFixed(1).padStart(6)}`);
}
if (r.transfers && r.transfers.length) {
  console.log('== 传输明细(实际网络传输) ==');
  for (const t of r.transfers) console.log('   ' + (t.label || t.op) + ': ' + formatTransfer(t));
}
if (r.repoSize != null)
  console.log(
    '== 本机同步副本（含历史） == ' +
      humanSize(r.repoSize) +
      '(首次同步只取当前快照；本次上传 ' +
      humanSize(upBytes) +
      ')',
  );

// 详细排障:逐个列出冲突(两边版本位置)、工作区同步结果与失败原因(保留在终端,退出后可翻看)
const conflictCopies = [
  ...(Array.isArray(r.conflictCopies) ? r.conflictCopies : []),
  ...(r.workspaces && Array.isArray(r.workspaces.conflictCopies) ? r.workspaces.conflictCopies : []),
];
if (conflictCopies.length) {
  console.log('-- 历史冲突拷贝(新版已自动合并冲突,不再生成;此处仅为遗留项,可用 sync_conflicts 查看):');
  for (const c of conflictCopies) {
    console.log(
      `   • ${c.kind === 'ws' ? '[工作区' + (c.id || '?') + '] ' : ''}${c.path}${c.copy ? '\n     远端版本拷贝: ' + c.copy : ''}`,
    );
  }
}
if (r.workspaces && (r.workspaces.total || (r.workspaces.errors && r.workspaces.errors.length))) {
  const w = r.workspaces;
  console.log(
    `-- 工作区: 共 ${w.total || 0},已同步 ${w.synced || 0},推送 ${w.pushed || 0},拉取 ${w.pulled || 0}` +
      (w.skipped ? `,跳过 ${w.skipped}` : ''),
  );
  if (w.errors && w.errors.length) {
    for (const e of w.errors)
      console.log(`   ✗ ${e.title || e.id || '?'}: ${e.error || '未知错误'}${e.path ? ' (' + e.path + ')' : ''}`);
  }
}
if (failed) process.exitCode = 1;
