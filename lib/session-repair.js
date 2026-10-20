// Offline repair of a failed identity that ChatSync already created through the host.
// Never creates identities, edits source sessions, or marks host readback as complete.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import * as zlib from 'node:zlib';
import { digest, safePath, atomicJson, LOCAL_DATA } from './recovery.js';
import { ZSTD_MAGIC, decodeZstdFrames } from './merge.js';
import { sessionIdOfLogPath } from './session-path.js';

const MAX_BYTES = 17 * 1024 * 1024;
const ID = /^session-[0-9a-f-]{36}$/i;
const HASH = /^[0-9a-f]{64}$/;
function readBounded(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('修复材料不是普通文件或超过 17 MiB');
  const value = fs.readFileSync(file);
  if (value.length > MAX_BYTES) throw new Error('修复材料超过 17 MiB');
  return value;
}
function rows(bytes) {
  const text = bytes.subarray(0, 4).equals(ZSTD_MAGIC) ? decodeZstdFrames(bytes, MAX_BYTES) : bytes.toString('utf8');
  if (text === null || Buffer.byteLength(text) > MAX_BYTES || !text.endsWith('\n')) throw new Error('日志包含损坏或不完整内容，不能自动修复');
  const lines = text.split('\n').filter(line => line.trim());
  if (!lines.length || lines.length > 100004) throw new Error('日志内容数量不受支持');
  return lines.map(line => JSON.parse(line));
}
function synced(file) {
  const fd = fs.openSync(file, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function replace(file, bytes) {
  const temp = file + '.chatsync-repair-' + randomUUID();
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
  } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

export function prepareImportRescue(engine, id, side, target, payload, version) {
  if (!['local', 'remote'].includes(side) || !ID.test(target.sessionId) || !Number.isSafeInteger(version)) throw new Error('无效的修复种子身份');
  if (payload.length > MAX_BYTES) throw new Error('停机修复种子超过 17 MiB');
  const file = safePath(engine.recovery.directory(), id + '/seed-' + side + '.jsonl');
  const sha256 = digest(payload);
  if (target.rescue && (target.rescue.sha256 !== sha256 || target.rescue.version !== version)) throw new Error('停机修复种子与既有记录不同');
  if (fs.existsSync(file)) {
    if (digest(readBounded(file)) !== sha256) throw new Error('停机修复种子校验失败');
  } else {
    fs.writeFileSync(file, payload, { flag: 'wx', mode: 0o600 }); synced(file);
  }
  const rescue = { format: 1, sha256, bytes: payload.length, version };
  const current = engine.recovery.read(id);
  const existing = current.imports?.[side];
  if (!existing || existing.sessionId !== target.sessionId || existing.planHash !== target.planHash) throw new Error('导入记录已变化');
  engine.recovery.finish(id, { imports: { ...current.imports, [side]: { ...existing, rescue } } });
  synced(engine.recovery.recordPath(id));
  return rescue;
}

function materials(engine, id, side) {
  if (!['local', 'remote'].includes(side)) throw new Error('请选择 local 或 remote');
  const record = engine.recovery.read(id), attempt = record.imports?.[side];
  if (record.kind !== 'main' || record.status !== 'merged' || !attempt || attempt.status !== 'pending'
    || !ID.test(attempt.sessionId) || !HASH.test(attempt.planHash || '') || attempt.rescue?.format !== 1
    || !HASH.test(attempt.rescue.sha256 || '')) throw new Error('此记录不是可停机修复的待验收导入');
  const sourceId = sessionIdOfLogPath(record.path);
  if (!sourceId || sourceId === attempt.sessionId) throw new Error('修复身份不能是原会话');
  const planBytes = readBounded(safePath(engine.recovery.directory(), id + '/import-' + side + '.json'));
  if (digest(planBytes) !== attempt.planHash) throw new Error('分叉计划校验失败');
  const plan = JSON.parse(planBytes), original = engine.recovery.version(record, side);
  if (plan.format !== 1 || plan.sessionId !== attempt.sessionId || plan.sourceSessionId !== sourceId
    || plan.sourceHash !== attempt.sourceHash || digest(original) !== attempt.sourceHash
    || plan.workspaceId !== attempt.workspaceId || plan.meta?.parentSession !== sourceId || plan.meta?.isSeeded !== true) {
    throw new Error('分叉计划与导入记录或原件不一致');
  }
  const payload = readBounded(safePath(engine.recovery.directory(), id + '/seed-' + side + '.jsonl'));
  if (payload.length !== attempt.rescue.bytes || digest(payload) !== attempt.rescue.sha256) throw new Error('停机修复种子校验失败');
  const expected = rows(payload);
  if (expected[0]?.type !== 'session' || expected[0]?.id !== attempt.sessionId || expected[0]?.version !== attempt.rescue.version
    || expected[0]?.cwd !== plan.meta.cwd || expected[0]?.createdAt !== attempt.createdAt
    || expected[0]?.parentSession !== sourceId || expected[0]?.isSeeded !== true) throw new Error('修复种子头与身份、来源或项目不一致');
  const candidates = [], base = safePath(engine.home, 'sessions'); let visited = 0;
  const visit = (dir, depth) => {
    if (depth > 8) throw new Error('会话目录层级过深');
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (++visited > 50000) throw new Error('会话目录过大');
      const relative = path.relative(engine.home, path.join(dir, entry.name)).split(path.sep).join('/');
      const file = safePath(engine.home, relative);
      if (entry.isDirectory()) visit(file, depth + 1);
      else if (entry.isFile() && sessionIdOfLogPath(relative) === attempt.sessionId) candidates.push(relative);
    }
  };
  visit(base, 0);
  if (candidates.length !== 1) throw new Error('找不到唯一的待验收会话日志，已停止修复');
  const relative = candidates[0];
  if (!new RegExp('(?:^|/)(?:session|log)\\.v' + attempt.rescue.version + '\\.jsonl(?:\\.zstd)?$').test(relative)) throw new Error('待验收日志格式与修复种子不一致');
  const before = readBounded(safePath(engine.home, relative)), prefix = rows(before);
  if (prefix.length > expected.length || prefix.some((row, index) => !isDeepStrictEqual(row, expected[index]))) {
    throw new Error('待验收会话已被其他程序修改，不能自动覆盖');
  }
  return { record, attempt, plan, payload, relative, before, complete: prefix.length === expected.length };
}

export async function assertDshClosed(engine, confirmed) {
  if (confirmed !== true) throw new Error('请关闭全部 Web / Desktop DSH，并明确选择 --offline-dsh-closed');
  let result, count;
  if (process.platform === 'win32') {
    const script = "$ErrorActionPreference='Stop'; $repairProcesses=@(Get-CimInstance Win32_Process); if (@($repairProcesses | Where-Object { $_.Name -eq 'node.exe' -and -not $_.CommandLine }).Count) { throw 'Cannot inspect a Node process' }; @($repairProcesses | Where-Object { ($_.CommandLine -and $_.CommandLine.Replace([char]92,'/') -match '@deepseek-ai/(dsh/lib/bin[.]js|dsh-desktop-host/lib/index[.]js)') -or $_.Name -match '^DeepSeek\\s*Harness[.]exe$' }).Count";
    result = await engine._spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 10000, { maxOutputBytes: 4096 });
    if (engine.ok(result) && /^\d+\s*$/.test(result.out)) count = Number(result.out.trim());
  } else {
    result = await engine._spawn('ps', ['-axo', 'command='], 10000, { maxOutputBytes: 2 * 1024 * 1024 });
    if (engine.ok(result)) count = result.out.split('\n').filter(line => /@deepseek-ai\/(?:dsh\/lib\/bin\.js\s+web|dsh-desktop-host\/lib\/index\.js)/.test(line)).length;
  }
  if (!Number.isSafeInteger(count)) throw new Error('无法确认 DSH 已关闭，未写入');
  if (count) throw new Error('仍检测到 DSH 进程，请完全退出 Web 和 Desktop 后重试');
}

export function previewSessionRepair(engine, id, side) {
  const found = materials(engine, id, side);
  if (found.complete) throw new Error('内容已经完整，请启动 DSH 并重试原导入，完成宿主读回');
  const preview = { format: 1, id: randomUUID(), recoveryId: id, side, sessionId: found.attempt.sessionId,
    path: found.relative, beforeHash: digest(found.before), seedHash: found.attempt.rescue.sha256,
    planHash: found.attempt.planHash, expiresAt: Date.now() + 60 * 60 * 1000 };
  const directory = safePath(engine.home, LOCAL_DATA + '/session-repair/plans'); fs.mkdirSync(directory, { recursive: true });
  atomicJson(path.join(directory, preview.id + '.json'), preview);
  return { planId: preview.id, recoveryId: id, side, sessionId: preview.sessionId, path: preview.path,
    beforeHash: preview.beforeHash, seedHash: preview.seedHash, expiresAt: preview.expiresAt,
    hint: '仅修复本次导入创建的待验收身份；先关闭全部 DSH。修复后仍需启动 DSH 重试原导入，完成公开接口读回。' };
}

export function listSessionRepairs(engine) {
  return { repairs: engine.recovery.list().filter(record => record.kind === 'main' && record.status === 'merged')
    .flatMap(record => Object.entries(record.imports || {}).filter(([, attempt]) => attempt.status === 'pending')
      .map(([side, attempt]) => ({ recoveryId: record.id, side, sessionId: attempt.sessionId,
        seedAvailable: attempt.rescue?.format === 1,
        hint: attempt.rescue?.format === 1 ? '可先预览停机修复；完成后仍需宿主读回'
          : '请先在支持公开编码接口的宿主中重试原导入，准备修复种子' }))) };
}

export async function repairSessionImport(engine, planId, { offline = false } = {}) {
  if (!/^[0-9a-f-]{36}$/.test(planId || '')) throw new Error('无效的停机修复计划');
  await assertDshClosed(engine, offline);
  const release = engine.acquireProcessLock(); if (!release) throw new Error('另一进程正在操作此目录');
  let backup, found, after;
  try {
    const preview = JSON.parse(readBounded(safePath(engine.home, LOCAL_DATA + '/session-repair/plans/' + planId + '.json')));
    if (preview.id !== planId || preview.format !== 1 || !Number.isSafeInteger(preview.expiresAt) || preview.expiresAt < Date.now()) throw new Error('停机修复预览已失效');
    found = materials(engine, preview.recoveryId, preview.side);
    if (found.relative !== preview.path || found.attempt.sessionId !== preview.sessionId
      || digest(found.before) !== preview.beforeHash || found.attempt.rescue.sha256 !== preview.seedHash || found.attempt.planHash !== preview.planHash) {
      throw new Error('修复材料或目标在预览后变化，请重新预览');
    }
    if (found.relative.endsWith('.zstd')) {
      if (typeof zlib.zstdCompressSync !== 'function') throw new Error('压缩日志停机修复需要支持 Zstandard 的 Node.js');
      const boundary = found.payload.indexOf(10) + 1;
      after = Buffer.concat([zlib.zstdCompressSync(found.payload.subarray(0, boundary)), zlib.zstdCompressSync(found.payload.subarray(boundary))]);
    } else after = found.payload;
    if (!isDeepStrictEqual(rows(after), rows(found.payload))) throw new Error('修复内容编码校验失败');
    backup = engine.recovery.save({ kind: 'import-repair-backup', status: 'prepared', path: found.relative,
      recoveryId: preview.recoveryId, side: preview.side, sessionId: preview.sessionId, sourceHash: preview.beforeHash,
      repairedHash: digest(after), planId }, { local: found.before, remote: after });
    for (const name of ['local.bin', 'remote.bin', 'record.json']) synced(safePath(engine.recovery.directory(), backup.id + '/' + name));
    await assertDshClosed(engine, offline);
    const target = safePath(engine.home, found.relative);
    if (digest(readBounded(target)) !== preview.beforeHash) throw new Error('目标已变化，未写入');
    replace(target, after);
    if (digest(readBounded(target)) !== digest(after)) throw new Error('修复写入校验失败');
    engine.recovery.finish(backup.id, { status: 'awaiting-host-readback' });
    const current = engine.recovery.read(preview.recoveryId);
    engine.recovery.finish(current.id, { imports: { ...current.imports, [preview.side]: { ...current.imports[preview.side],
      repair: { backupId: backup.id, appliedAt: Date.now(), repairedHash: digest(after) } } } });
    return { repaired: true, backupId: backup.id, sessionId: preview.sessionId, requiresHostReadback: true,
      hint: '新会话内容已修复，原件与修复前内容均保留；同步仍暂停。启动 DSH 后重试同一导入，完成宿主读回与项目归属验收。' };
  } catch (error) {
    if (backup && found && after) {
      const target = safePath(engine.home, found.relative);
      if (digest(readBounded(target)) === digest(after)) {
        try { replace(target, found.before); engine.recovery.finish(backup.id, { status: 'rolled-back' }); }
        catch { throw new Error('修复未完成且回滚失败；备份 ' + backup.id + ' 已保留。' + error.message); }
      }
    }
    throw error;
  } finally { release(); }
}

export async function rollbackSessionRepair(engine, backupId, { offline = false } = {}) {
  await assertDshClosed(engine, offline);
  const release = engine.acquireProcessLock(); if (!release) throw new Error('另一进程正在操作此目录');
  try {
    const backup = engine.recovery.read(backupId);
    if (backup.kind !== 'import-repair-backup' || sessionIdOfLogPath(backup.path) !== backup.sessionId) throw new Error('此记录不是停机修复备份');
    const source = engine.recovery.read(backup.recoveryId);
    if (source.imports?.[backup.side]?.sessionId !== backup.sessionId || source.imports[backup.side].status === 'verified') throw new Error('导入身份已变化或已通过宿主验收，不能回滚为部分日志');
    const original = engine.recovery.version(backup, 'local'), repaired = engine.recovery.version(backup, 'remote');
    if (digest(original) !== backup.sourceHash || digest(repaired) !== backup.repairedHash) throw new Error('修复备份校验失败');
    const target = safePath(engine.home, backup.path), hash = digest(readBounded(target));
    if (hash !== backup.sourceHash && hash !== backup.repairedHash) throw new Error('会话已被其他程序修改，不能回滚');
    await assertDshClosed(engine, offline);
    if (digest(readBounded(target)) !== hash) throw new Error('目标已变化，不能回滚');
    if (hash === backup.repairedHash) replace(target, original);
    if (digest(readBounded(target)) !== backup.sourceHash) throw new Error('回滚写入校验失败');
    engine.recovery.finish(backupId, { status: 'rolled-back' });
    return { rolledBack: true, sessionId: backup.sessionId, requiresHostReadback: true };
  } finally { release(); }
}
