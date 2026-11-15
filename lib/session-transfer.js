import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parseSessionLog, validateSessionLog } from './merge.js';
import { decodeRecoverySession } from './session-recovery.js';
import { sessionIdOfLogPath, sessionLogGeneration } from './session-path.js';
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL_DATA, safePath, atomicBytes, atomicJson, digest } from './recovery.js';
import { applyOfflineSession } from './session-safety.js';
import { MAX_SESSION_BYTES } from './privacy.js';
import { hostService, refreshSessionProjection } from './session-host.js';

const journalPath = engine => safePath(engine.home, LOCAL_DATA + '/session-applications.json');
export function pendingSessionTransfers(engine) {
  try {
    return JSON.parse(fs.readFileSync(journalPath(engine), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error('会话应用记录损坏，已停止同步');
  }
}
function finishApplication(engine, file) {
  const pending = pendingSessionTransfers(engine);
  if (pending[file]) {
    delete pending[file];
    atomicJson(journalPath(engine), pending);
  }
}
function stageApplication(engine, file, buffer, pending, hash) {
  const source = LOCAL_DATA + '/session-applications/' + hash + '.jsonl';
  const sourcePath = safePath(engine.home, source);
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  if (!fs.existsSync(sourcePath)) atomicBytes(sourcePath, buffer);
  else if (digest(fs.readFileSync(sourcePath)) !== hash) throw new Error('待应用会话原件校验失败');
  pending[file] = { source, hash };
  atomicJson(journalPath(engine), pending);
}
export async function retrySessionTransfers(engine) {
  if (engine.loadConfig().contentScope?.sessions === false && Object.keys(pendingSessionTransfers(engine)).length)
    return {
      downloadPending: true,
      error: '存在待完成的会话应用；会话同步已关闭，原件保留。重新开启后继续，或在数据检查中处理。',
    };
  for (const [file, attempt] of Object.entries(pendingSessionTransfers(engine))) {
    const bytes = fs.readFileSync(safePath(engine.home, attempt.source));
    if (digest(bytes) !== attempt.hash) throw new Error('待应用会话原件校验失败');
    const outcome = await applySessionTransfer(engine, file, bytes);
    if (outcome.deferred)
      return { error: 'session-application-pending', hint: outcome.hint, sessionDeferred: [{ file, ...outcome }] };
  }
  return null;
}

// A header cwd that is absolute only under the other OS's rules (C:\... read on
// macOS) was created on another platform. The host refuses to restore it here.
export const FOREIGN_SESSION_HINT = '会话的工作目录是另一种系统的路径，本机无法打开，未导入；云端保留原件';
export function foreignSessionCwd(cwd, hostPath = path) {
  if (typeof cwd !== 'string' || hostPath.isAbsolute(cwd)) return null;
  const other = hostPath === path.win32 ? path.posix : path.win32;
  return other.isAbsolute(cwd) ? cwd : null;
}

// An older host's validator refuses what a newer host legitimately wrote: an event it
// does not know, or a fork that carries its parent's delivery marker (DSH 0.2.2 accepts
// these, 0.2.1 does not). The sync still stops; the person needs to know what fixes it.
const NEWER_HOST_REFUSAL = /unknown event type|delivery marker names the wrong Session|unsupported/i;
export function explainRemoteSessionFailure(message) {
  const text = String(message || '');
  return NEWER_HOST_REFUSAL.test(text)
    ? text + '。另一台电脑的 DSH 可能比这台新，请把这台电脑的 DSH 更新到相同版本后再同步；两边的会话原件都还在。'
    : text;
}

// Structural continuity alone cannot prove a Session can be restored.
// Returns { foreign } for a session another OS created: it passed the host
// format check with its cwd projected to a local root, but must not be applied.
export async function validateTransferSession(engine, file, buffer) {
  const rows = parseSessionLog(buffer);
  if (!rows) throw new Error('会话记录不完整或序号不连续：' + file);
  const hostPath = engine.hostPath || path;
  const foreign = foreignSessionCwd(rows[0].cwd, hostPath);
  const key = sessionIdOfLogPath(file) + ':' + digest(buffer);
  const cache = (engine._validatedSessions ||= new Set());
  if (cache.has(key)) return foreign ? { foreign } : undefined;
  const historical = Number(rows[0].version ?? 0) < 4;
  const catalog = await (engine.loadTransferCatalog || transferCatalog)({ historical });
  const checked = foreign
    ? Buffer.from(
        [{ ...rows[0], cwd: hostPath === path.win32 ? 'C:\\' : '/' }, ...rows.slice(1)]
          .map(row => JSON.stringify(row))
          .join('\n') + '\n',
      )
    : buffer;
  const artifact = decodeRecoverySession(checked, catalog);
  if (artifact.header.id !== sessionIdOfLogPath(file)) throw new Error('会话身份与目录不一致：' + file);
  cache.add(key);
  if (cache.size > 128) cache.delete(cache.values().next().value);
  return foreign ? { foreign } : undefined;
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
      if (catalog?.createRestore) {
        if (historical) return catalog;
        return {
          createRestore: (...args) => catalog.createRestore(...args),
          async validateSeed({ header, events, inheritedEventCount }) {
            const { Session } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href);
            Session.create(header.id, events, header, inheritedEventCount);
          },
        };
      }
    } catch {
      /* A standalone CLI cannot safely infer the host's event vocabulary. */
    }
  }
  throw new Error('宿主会话格式接口不可用');
}

export function sessionService(engine) {
  return hostService(engine.ctx, 'sessionPersistence');
}

export function selectSessionGenerations(files) {
  const selected = new Map();
  for (const file of files) {
    const id = sessionIdOfLogPath(file);
    if (!id) continue;
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
  if (!id)
    return {
      deferred: true,
      reason: 'unsupported-session-file',
      hint: '会话目录中此类文件没有安全写入接口，已保留本机原件',
    };
  if (!buffer) return { deferred: true, reason: 'session-deletion', hint: '会话删除保留在传输副本，本机原件未删除' };
  const rows = parseSessionLog(buffer);
  if (!rows) return { deferred: true, reason: 'invalid-session-log', hint: '会话记录不完整或序号不连续' };
  if (foreignSessionCwd(rows[0].cwd, engine.hostPath || path))
    return { deferred: true, reason: 'foreign-platform-session', hint: FOREIGN_SESSION_HINT };
  const persistence = sessionService(engine);
  if (engine._offlineSessionApply && !engine.ctx)
    return applyOfflineSession(
      engine,
      file,
      buffer,
      expected === undefined
        ? fs.existsSync(safePath(engine.home, file))
          ? fs.readFileSync(safePath(engine.home, file))
          : null
        : expected,
    );
  if (!persistence?.open || !persistence?.create || !persistence?.stat)
    return {
      deferred: true,
      reason: 'session-api-unavailable',
      hint: '请在支持会话写入接口的 DSH 中同步，以应用已下载会话',
    };
  try {
    const catalog = await (engine.loadTransferCatalog || transferCatalog)();
    const incoming = decodeRecoverySession(buffer, catalog);
    if (incoming.header.id !== id) throw new Error('会话身份与路径不一致');
    const exists = await persistence.stat(id);
    const pending = pendingSessionTransfers(engine);
    const hash = digest(buffer);
    const alreadyPending = Boolean(pending[file]);
    if (alreadyPending && pending[file].hash !== hash) throw new Error('待应用会话与本次传输不一致');
    if (!exists) {
      // Native import validates a detached Session before publishing its header.
      await catalog.validateSeed?.(incoming);
      // Creation can publish a header or fail partway. Keep the full log first.
      stageApplication(engine, file, buffer, pending, hash);
    }
    let handle;
    try {
      handle = exists
        ? await persistence.open(id, 'write')
        : await persistence.create(incoming.header, { inheritedEventCount: incoming.inheritedEventCount });
    } catch (error) {
      // A concurrent host create won before we acquired any handle or wrote bytes.
      if (!exists && !alreadyPending && error?.name === 'SessionAlreadyExistsError') finishApplication(engine, file);
      throw error;
    }
    let readback;
    try {
      if (
        !isDeepStrictEqual(handle.header, incoming.header) ||
        handle.inheritedEventCount !== incoming.inheritedEventCount
      )
        return { deferred: true, reason: 'session-header-mismatch', hint: '会话身份或继承元数据不同，已保留两端原件' };
      const { events } = await handle.read();
      const shared = Math.min(events.length, incoming.events.length);
      for (let i = 0; i < shared; i++)
        if (!isDeepStrictEqual(events[i], incoming.events[i]))
          return {
            deferred: true,
            reason: 'divergent-session-history',
            hint: '会话发生同步冲突，已保留本机版本；可在同步页比较云端版本',
          };
      if (events.length > incoming.events.length && !alreadyPending)
        return { deferred: true, reason: 'local-session-ahead', hint: '本机会话已有新记录，保留并在下次同步上传' };
      if (events.length < incoming.events.length) {
        if (exists) stageApplication(engine, file, buffer, pending, hash);
        await handle.append(incoming.events.slice(events.length));
      }
      await handle.flush();
      ({ events: readback } = await handle.read());
      if (!isDeepStrictEqual(readback.slice(0, incoming.events.length), incoming.events))
        throw new Error('会话写入后读回不一致');
    } finally {
      await handle.close();
    }
    finishApplication(engine, file);
    refreshSessionProjection(engine.ctx, engine, incoming.header, incoming.inheritedEventCount, readback);
    return { applied: true, id, events: readback.length };
  } catch (error) {
    const busy = error?.name === 'SessionAlreadyOwnedError';
    return {
      deferred: true,
      reason: busy ? 'session-writer-held' : 'session-apply-failed',
      hint: busy
        ? '会话写入权正被宿主占用，已保留本机内容，释放后重试'
        : '会话未完成应用，原件仍在传输副本：' + error.message,
    };
  }
}

// Inspect the immutable fetched tree before merge (including fast-forward).
// Batch reads keep large histories from spawning one Git process per file.
export async function validateSessionTree(engine, head) {
  const listing = await engine.gitInput(['ls-tree', '-rlz', head, '--', 'sessions/'], '', 60000, false, {
    maxOutputBytes: 32 * 1024 * 1024,
  });
  if (!engine.ok(listing)) throw new Error('无法检查会话目录');
  const blobs = [];
  for (const row of listing.out.split('\0').filter(Boolean)) {
    const match = /^\d+ blob ([a-f0-9]+)\s+(\d+)\t(.+)$/.exec(row);
    if (!match || !sessionIdOfLogPath(match[3]) || engine.reviewScope?.sessions === false) continue;
    if (Number(match[2]) > MAX_SESSION_BYTES) throw new Error('会话超过检查上限：' + match[3]);
    blobs.push({ sha: match[1], size: Number(match[2]), file: match[3] });
  }
  for (let start = 0; start < blobs.length;) {
    const batch = [];
    let bytes = 0;
    while (
      start < blobs.length &&
      batch.length < 128 &&
      (bytes + blobs[start].size <= 16 * 1024 * 1024 || !batch.length)
    ) {
      const blob = blobs[start++];
      batch.push(blob);
      bytes += blob.size;
    }
    const read = await engine.gitInput(['cat-file', '--batch'], batch.map(b => b.sha).join('\n') + '\n', 60000, true, {
      maxOutputBytes: bytes + batch.length * 128,
    });
    if (!engine.ok(read)) throw new Error('无法完整读取会话对象');
    let offset = 0;
    for (const blob of batch) {
      const newline = read.out.indexOf(10, offset);
      if (newline < 0 || read.out.subarray(offset, newline).toString() !== `${blob.sha} blob ${blob.size}`)
        throw new Error('会话对象读取不完整');
      offset = newline + 1;
      const buffer = read.out.subarray(offset, offset + blob.size);
      if (buffer.length !== blob.size || read.out[offset + blob.size] !== 10 || !parseSessionLog(buffer))
        throw new Error(
          '会话快照未通过校验（' + (validateSessionLog(buffer).reason || 'invalid-session-log') + '）：' + blob.file,
        );
      await validateTransferSession(engine, blob.file, buffer);
      offset += blob.size + 1;
    }
    if (offset !== read.out.length) throw new Error('会话对象包含额外数据');
  }
}
