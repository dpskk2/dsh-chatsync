import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parseSessionLog, validateSessionLog } from './merge.js';
import { decodeRecoverySession } from './session-recovery.js';
import { sessionIdOfLogPath, sessionLogGeneration } from './session-path.js';
import fs from 'node:fs';
import { LOCAL_DATA, safePath, atomicJson, digest } from './recovery.js';
import { applyOfflineSession } from './session-safety.js';
import { MAX_SESSION_BYTES } from './privacy.js';

const journalPath = engine => safePath(engine.home, LOCAL_DATA + '/session-applications.json');
export function pendingSessionTransfers(engine) {
  try { return JSON.parse(fs.readFileSync(journalPath(engine), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('会话应用记录损坏，已停止同步'); }
}
function finishApplication(engine, file) {
  const pending = pendingSessionTransfers(engine);
  if (pending[file]) { delete pending[file]; atomicJson(journalPath(engine), pending); }
}
export async function retrySessionTransfers(engine) {
  if (engine.loadConfig().contentScope?.sessions === false && Object.keys(pendingSessionTransfers(engine)).length)
    return { downloadPending: true, error: '存在待完成的会话应用；会话同步已关闭，原件保留。重新开启后继续，或在数据检查中处理。' };
  for (const [file, attempt] of Object.entries(pendingSessionTransfers(engine))) {
    const bytes = fs.readFileSync(safePath(engine.home, attempt.source));
    if (digest(bytes) !== attempt.hash) throw new Error('待应用会话原件校验失败');
    const outcome = await applySessionTransfer(engine, file, bytes);
    if (outcome.deferred) return { error: 'session-application-pending', hint: outcome.hint, sessionDeferred: [{ file, ...outcome }] };
  }
  return null;
}

// Structural continuity alone cannot prove a Session can be restored.
export async function validateTransferSession(engine, file, buffer) {
  const rows = parseSessionLog(buffer);
  if (!rows) throw new Error('会话记录不完整或序号不连续：' + file);
  const key = sessionIdOfLogPath(file) + ':' + digest(buffer);
  const cache = engine._validatedSessions ||= new Set();
  if (cache.has(key)) return;
  const historical = Number(rows[0].version ?? 0) < 4;
  const catalog = await (engine.loadTransferCatalog || transferCatalog)({ historical });
  const artifact = decodeRecoverySession(buffer, catalog);
  if (artifact.header.id !== sessionIdOfLogPath(file)) throw new Error('会话身份与目录不一致：' + file);
  cache.add(key); if (cache.size > 128) cache.delete(cache.values().next().value);
}

// Resolve published host capabilities, without reaching into its private lease.
export async function transferCatalog({ historical = false } = {}) {
  for (const entry of [process.env.DSH_SYNC_HOST_ENTRY, process.argv[1], import.meta.url].filter(Boolean)) {
    try {
      const require = createRequire(entry);
      const module = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-format-catalog')).href);
      // Validate archived formats in their own vocabulary, without inventing
      // the historical child evidence required to migrate them into v4.
      const catalog = historical ? module.historicalSessionFormatCatalog : module.sessionFormatCatalog;
      if (catalog?.createRestore) return catalog;
    } catch { /* A standalone CLI cannot safely infer the host's event vocabulary. */ }
  }
  throw new Error('宿主会话格式接口不可用');
}

export function sessionService(engine) {
  try { return typeof engine.ctx?.get === 'function' ? engine.ctx.get('sessionPersistence') : engine.ctx?.sessionPersistence; }
  catch { return undefined; }
}

export function selectSessionGenerations(files) {
  const selected = new Map();
  for (const file of files) {
    const id = sessionIdOfLogPath(file); if (!id) continue;
    const version = sessionLogGeneration(file);
    if (version === null) throw new Error('会话日志代际无法识别：' + file);
    const current = selected.get(id);
    if (current?.version === version && current.file !== file) current.ambiguous = true;
    if (!current || version > current.version) selected.set(id, { version, file });
  }
  for (const [id, entry] of selected) if (entry.ambiguous) throw new Error('会话存在同代多份日志，无法安全选择：' + id);
  return new Set([...selected.values()].map(entry => entry.file));
}

// Only append through a handle owning the host's cross-process writer lease.
// A filesystem stat/recheck/rename cannot provide the same exclusion guarantee.
export async function applySessionTransfer(engine, file, buffer, expected) {
  const id = sessionIdOfLogPath(file);
  if (!id) return { deferred: true, reason: 'unsupported-session-file', hint: '会话目录中此类文件没有安全写入接口，已保留本机原件' };
  if (!buffer) return { deferred: true, reason: 'session-deletion', hint: '会话删除保留在传输副本，本机原件未删除' };
  if (!parseSessionLog(buffer)) return { deferred: true, reason: 'invalid-session-log', hint: '会话记录不完整或序号不连续' };
  const persistence = sessionService(engine);
  if (engine._offlineSessionApply && !engine.ctx)
    return applyOfflineSession(engine, file, buffer, expected === undefined ? fs.existsSync(safePath(engine.home, file)) ? fs.readFileSync(safePath(engine.home, file)) : null : expected);
  if (!persistence?.open || !persistence?.create || !persistence?.stat)
    return { deferred: true, reason: 'session-api-unavailable', hint: '请在支持会话写入接口的 DSH 中同步，以应用已下载会话' };
  let handle;
  try {
    const catalog = await (engine.loadTransferCatalog || transferCatalog)();
    const incoming = decodeRecoverySession(buffer, catalog);
    if (incoming.header.id !== id) throw new Error('会话身份与路径不一致');
    const exists = await persistence.stat(id);
    handle = exists ? await persistence.open(id, 'write') : await persistence.create(incoming.header,
      { inheritedEventCount: incoming.inheritedEventCount });
    if (!isDeepStrictEqual(handle.header, incoming.header) || handle.inheritedEventCount !== incoming.inheritedEventCount)
      return { deferred: true, reason: 'session-header-mismatch', hint: '会话身份或继承元数据不同，已保留两端原件' };
    const { events } = await handle.read();
    const shared = Math.min(events.length, incoming.events.length);
    for (let i = 0; i < shared; i++) if (!isDeepStrictEqual(events[i], incoming.events[i]))
      return { deferred: true, reason: 'divergent-session-history', hint: '会话已分叉，保留本机历史；可从恢复记录另存远端分支' };
    if (events.length > incoming.events.length && !pendingSessionTransfers(engine)[file])
      return { deferred: true, reason: 'local-session-ahead', hint: '本机会话已有新记录，保留并在下次同步上传' };
    // Persist the full intended seed before the first mutation. A failed partial
    // append is retried before exporting anything on the next sync or restart.
    const pending = pendingSessionTransfers(engine);
    const source = LOCAL_DATA + '/session-applications/' + digest(buffer) + '.jsonl';
    const sourcePath = safePath(engine.home, source);
    fs.mkdirSync(safePath(engine.home, LOCAL_DATA + '/session-applications'), { recursive: true });
    if (!fs.existsSync(sourcePath)) fs.writeFileSync(sourcePath, buffer, { flag: 'wx', flush: true });
    pending[file] = { source, hash: digest(buffer) };
    atomicJson(journalPath(engine), pending);
    const journal = fs.openSync(journalPath(engine), 'r+');
    try { fs.fsyncSync(journal); } finally { fs.closeSync(journal); }
    if (events.length < incoming.events.length) await handle.append(incoming.events.slice(events.length));
    await handle.flush();
    const readback = await handle.read();
    if (!isDeepStrictEqual(readback.events.slice(0, incoming.events.length), incoming.events)) throw new Error('会话写入后读回不一致');
    finishApplication(engine, file);
    return { applied: true, id, events: readback.events.length };
  } catch (error) {
    const busy = error?.name === 'SessionAlreadyOwnedError';
    return { deferred: true, reason: busy ? 'session-writer-held' : 'session-apply-failed',
      hint: busy ? '会话写入权正被宿主占用，已保留本机内容，释放后重试' : '会话未完成应用，原件仍在传输副本：' + error.message };
  } finally {
    if (handle) await handle.close();
  }
}

// Inspect the immutable fetched tree before merge (including fast-forward).
// Batch reads keep large histories from spawning one Git process per file.
export async function validateSessionTree(engine, head) {
  const listing = await engine.gitInput(['ls-tree', '-rlz', head, '--', 'sessions/'], '', 60000, false,
    { maxOutputBytes: 32 * 1024 * 1024 });
  if (!engine.ok(listing)) throw new Error('无法检查会话目录');
  const blobs = [];
  for (const row of listing.out.split('\0').filter(Boolean)) {
    const match = /^\d+ blob ([a-f0-9]+)\s+(\d+)\t(.+)$/.exec(row);
    if (!match || !sessionIdOfLogPath(match[3]) || engine.reviewScope?.sessions === false) continue;
    if (Number(match[2]) > MAX_SESSION_BYTES) throw new Error('会话超过检查上限：' + match[3]);
    blobs.push({ sha: match[1], size: Number(match[2]), file: match[3] });
  }
  for (let start = 0; start < blobs.length;) {
    const batch = []; let bytes = 0;
    while (start < blobs.length && batch.length < 128 && (bytes + blobs[start].size <= 16 * 1024 * 1024 || !batch.length)) {
      const blob = blobs[start++]; batch.push(blob); bytes += blob.size;
    }
    const read = await engine.gitInput(['cat-file', '--batch'], batch.map(b => b.sha).join('\n') + '\n', 60000, true,
      { maxOutputBytes: bytes + batch.length * 128 });
    if (!engine.ok(read)) throw new Error('无法完整读取会话对象');
    let offset = 0;
    for (const blob of batch) {
      const newline = read.out.indexOf(10, offset);
      if (newline < 0 || read.out.subarray(offset, newline).toString() !== `${blob.sha} blob ${blob.size}`)
        throw new Error('会话对象读取不完整');
      offset = newline + 1;
      const buffer = read.out.subarray(offset, offset + blob.size);
      if (buffer.length !== blob.size || read.out[offset + blob.size] !== 10 || !parseSessionLog(buffer))
        throw new Error('会话快照未通过校验（' + (validateSessionLog(buffer).reason || 'invalid-session-log') + '）：' + blob.file);
      await validateTransferSession(engine, blob.file, buffer);
      offset += blob.size + 1;
    }
    if (offset !== read.out.length) throw new Error('会话对象包含额外数据');
  }
}
