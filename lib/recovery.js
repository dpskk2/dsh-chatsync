import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { decodeZstdFrames, deepEqual, parseSessionLog, ZSTD_MAGIC } from './merge.js';
import { recoveryPresentation } from './recovery-presentation.js';
import { sessionIdOfLogPath } from './session-path.js';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const LOCAL_DATA = '.chatsync-local';

// Finder and Explorer drop these into any folder a person opens. They are not user
// data, and under sessions/ another computer could not apply them.
export const OS_JUNK_FILE = /^(?:\.DS_Store|\._.+|Thumbs\.db|desktop\.ini)$/i;

export function recoveryCategory(record) {
  if (Object.values(record.imports || {}).some(attempt => attempt.status !== 'verified')) return 'attention';
  if (record.reviewState === 'archived') return 'history';
  if (record.reviewState === 'attention') return 'attention';
  if (['data-repair', 'scope-backup', 'restore-backup', 'settings-version-reset'].includes(record.kind))
    return 'history';
  return 'attention';
}

export function unhandledConflictSides(record) {
  const kept =
    record.forkReviewKept === undefined
      ? record.resultHash || (record.kept ? record.versions[record.kept]?.sha256 : record.versions.local.sha256)
      : record.forkReviewKept;
  return ['local', 'remote'].filter(side => {
    const hash = record.versions[side].sha256;
    const attempt = record.imports?.[side];
    if (attempt?.status === 'verified' && attempt.sourceHash === hash) return false;
    return kept !== hash || Boolean(attempt);
  });
}

function forkCandidate(record) {
  const sessionId = sessionIdOfLogPath(record.path);
  const local = record.versions?.local?.sha256;
  const remote = record.versions?.remote?.sha256;
  if (!sessionId || !/^[a-f0-9]{64}$/.test(local || '') || !/^[a-f0-9]{64}$/.test(remote || '') || local === remote)
    return null;
  if (
    !(record.kind === 'main' && record.status === 'merged') &&
    !(record.kind === 'scope-backup' && record.status === 'deferred')
  )
    return null;
  return { sessionId, key: JSON.stringify([sessionId, ...[local, remote].sort()]) };
}

function isFork(sessionId, local, remote) {
  if (!local || !remote || local.equals(remote)) return false;
  const left = parseSessionLog(local);
  const right = parseSessionLog(remote);
  if (left?.[0]?.id !== sessionId || !right || !deepEqual(left[0], right[0])) return false;
  if (!Number.isInteger(left[0].version) || left[0].version < 0 || left[0].version > 4) return false;
  const a = left.slice(1).filter(row => Object.hasOwn(row, 'seq'));
  const b = right.slice(1).filter(row => Object.hasOwn(row, 'seq'));
  // Packed historical rows use another encoding. Compare only a directly
  // aligned committed event, where a differing row proves independent history.
  return a.some((row, i) => row.seq === b[i]?.seq && !deepEqual(row, b[i]));
}

// Reject symlinks in every component, including the final file, before any I/O.
export function safePath(root, relative) {
  if (
    typeof relative !== 'string' ||
    !relative ||
    relative.includes('\0') ||
    relative.includes('\\') ||
    relative.split('/').some(p => !p || p === '.' || p === '..' || p.includes(':')) ||
    path.isAbsolute(relative)
  )
    throw new Error('无效的文件路径');
  const base = path.resolve(root);
  if (fs.lstatSync(base).isSymbolicLink()) throw new Error('不支持符号链接目录');
  let current = base;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('不支持符号链接文件或目录');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return current;
}

export function atomicJson(file, value) {
  atomicBytes(file, Buffer.from(JSON.stringify(value, null, 2) + '\n'));
}
export function atomicBytes(file, bytes) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx', flush: true });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

// Replace an imported file without exposing a half-written state to the host.
// Permission bits are kept; a symbolic link is written through as before, so a
// user's linked settings file is updated rather than replaced by a copy.
export const REPLACE_TEMP_SUFFIX = '.dsh-sync-tmp';
export function replaceBytes(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (stat?.isSymbolicLink()) {
    fs.writeFileSync(file, bytes);
    return;
  }
  const mode = stat ? stat.mode & 0o7777 : undefined;
  const temp = file + '.' + randomUUID() + REPLACE_TEMP_SUFFIX;
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx', flush: true, ...(mode !== undefined && { mode }) });
    if (mode !== undefined) fs.chmodSync(temp, mode);
    fs.renameSync(temp, file);
  } catch (error) {
    // The caller needs the original error; a temporary file that cannot be
    // removed is excluded from transport (REPLACE_TEMP_SUFFIX).
    try {
      fs.unlinkSync(temp);
    } catch {}
    throw error;
  }
}

export class RecoveryStore {
  constructor(home) {
    this.home = home;
    // Legacy records have no classification. Validate their payloads once per
    // process, and always read review/import state from the current metadata.
    this.forkCache = new Map();
  }
  directory(create = false) {
    const dir = safePath(this.home, LOCAL_DATA + '/recovery');
    if (create) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  recordPath(id) {
    if (!/^[0-9a-f-]{36}$/.test(id || '')) throw new Error('无效的恢复记录');
    return safePath(this.directory(), id + '/record.json');
  }
  save(meta, sides) {
    const root = this.directory(true);
    const id = randomUUID();
    const dir = safePath(root, id);
    fs.mkdirSync(dir);
    const versions = {};
    for (const side of ['local', 'remote']) {
      const buf = sides[side];
      versions[side] = buf === null ? { missing: true } : { bytes: buf.length, sha256: digest(buf) };
      if (buf !== null) fs.writeFileSync(path.join(dir, side + '.bin'), buf, { flag: 'wx', flush: true });
    }
    const record = { ...meta, format: 1, id, createdAt: Date.now(), versions };
    const sessionId = sessionIdOfLogPath(meta.path);
    if (sessionId && (meta.kind === 'main' || meta.kind === 'scope-backup')) {
      record.sessionFork = isFork(sessionId, sides.local, sides.remote);
    }
    atomicJson(path.join(dir, 'record.json'), record);
    const fd = fs.openSync(path.join(dir, 'record.json'), 'r+');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return record;
  }
  read(id) {
    const file = this.recordPath(id);
    if (fs.statSync(file).size > 64 * 1024) throw new Error('恢复记录过大');
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (record.id !== id || record.format !== 1) throw new Error('恢复记录格式不正确');
    return record;
  }
  list() {
    const dir = this.directory();
    if (!fs.existsSync(dir)) {
      this.forkCache.clear();
      return [];
    }
    const records = [];
    const ids = new Set(fs.readdirSync(dir));
    for (const id of this.forkCache.keys()) if (!ids.has(id)) this.forkCache.delete(id);
    for (const id of ids) {
      try {
        records.push(this.read(id));
      } catch {
        /* incomplete records never become restore candidates */
      }
    }
    return records.sort((a, b) => b.createdAt - a.createdAt);
  }
  version(record, side) {
    if (!['local', 'remote'].includes(side)) throw new Error('请选择本机或云端版本');
    const meta = record.versions[side];
    if (!meta) throw new Error('缺少版本信息');
    if (meta.missing) return null;
    const file = safePath(this.directory(), record.id + '/' + side + '.bin');
    const buf = fs.readFileSync(file);
    if (buf.length !== meta.bytes || digest(buf) !== meta.sha256) throw new Error('原件校验失败，已停止恢复');
    return buf;
  }
  sessionFork(record) {
    const candidate = forkCandidate(record);
    if (!candidate || record.sessionFork === false) return null;
    if (record.sessionFork === true) return candidate;
    if (this.forkCache.get(record.id)?.key !== candidate.key) {
      try {
        this.forkCache.set(record.id, {
          key: candidate.key,
          fork: isFork(candidate.sessionId, this.version(record, 'local'), this.version(record, 'remote')),
        });
      } catch {
        // A broken legacy payload remains visible in recovery, where preview
        // reports its integrity error. Do not re-read it on every status poll.
        this.forkCache.set(record.id, { key: candidate.key, fork: false });
      }
    }
    return this.forkCache.get(record.id)?.fork ? candidate : null;
  }
  pendingSessionForks(records = this.list()) {
    const resolved = new Set();
    const pending = new Map();
    for (const record of records) {
      const fork = this.sessionFork(record);
      if (!fork) continue;
      const remaining = unhandledConflictSides(record);
      for (const side of ['local', 'remote']) {
        const hash = record.versions[side].sha256;
        const attempt = record.imports?.[side];
        const key = JSON.stringify([fork.sessionId, hash]);
        if (attempt?.status === 'verified' && attempt.sourceHash === hash) resolved.add(key);
        else if (remaining.includes(side)) {
          if (record.reviewState === 'archived' || record.forkHandled) resolved.add(key);
          else if (!pending.has(key)) pending.set(key, { id: record.id, sessionId: fork.sessionId });
        }
      }
    }
    const rows = new Map();
    for (const [key, row] of pending) if (!resolved.has(key)) rows.set(row.id, row);
    return [...rows.values()];
  }
  finish(id, result) {
    const record = this.read(id);
    atomicJson(this.recordPath(id), { ...record, ...result });
  }
  archive(id, expectedVersions, archived = true) {
    const record = this.read(id);
    if (!archived && this.sessionFork(record) && (record.forkHandled || !unhandledConflictSides(record).length))
      throw new Error('此会话冲突已处理完成');
    if (archived) {
      if (
        (!['merged', 'applied', 'repaired', 'restored'].includes(record.status) &&
          !(record.status === 'deferred' && this.sessionFork(record))) ||
        Object.values(record.imports || {}).some(attempt => attempt.status !== 'verified')
      ) {
        throw new Error('此记录仍有未完成的处理，请先完成恢复或修复');
      }
      for (const side of ['local', 'remote']) {
        const bytes = this.version(record, side);
        if ((bytes === null ? null : digest(bytes)) !== expectedVersions?.[side])
          throw new Error('原件已变化，请重新读取记录');
      }
    }
    this.finish(id, { reviewState: archived ? 'archived' : 'attention', reviewedAt: Date.now() });
    return { ok: true, hint: archived ? '已移入留存备份。' : '已放回待查看。' };
  }
  preview(id, options = {}) {
    const record = this.read(id);
    const display = side => {
      const buf = this.version(record, side);
      if (buf === null) return { missing: true };
      const presentation = recoveryPresentation(record, buf, { offset: options?.offsets?.[side] });
      const saved = { bytes: buf.length, sha256: record.versions[side].sha256, presentation };
      const compressed = buf.subarray(0, 4).equals(ZSTD_MAGIC);
      if (compressed && buf.length > 4 * 1024 * 1024)
        return { ...saved, binary: true, hint: '此会话较大，暂不支持原文比较' };
      const decoded = compressed ? decodeZstdFrames(buf, 4 * 1024 * 1024) : null;
      if (compressed && decoded === null) return { ...saved, binary: true, hint: '无法读取此会话的压缩格式' };
      if (!compressed && buf.includes(0)) return { ...saved, binary: true };
      const text = decoded ?? buf.subarray(0, 64 * 1024).toString('utf8');
      return {
        bytes: buf.length,
        presentation,
        sha256: digest(buf),
        text: text.slice(0, 64 * 1024),
        truncated: text.length > 64 * 1024 || (!compressed && buf.length > 64 * 1024),
      };
    };
    return { record, local: display('local'), remote: display('remote') };
  }
}

export function currentFile(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new Error('目标不是普通文件');
    return fs.readFileSync(file);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// The caller holds the engine's cross-process lock throughout this transaction.
export function restoreFile(store, id, side, root, expectedHash) {
  const record = store.read(id);
  if (!(
    (record.kind === 'ws' && record.status === 'merged') ||
    (record.kind === 'restore-backup' && record.status === 'restored')
  ))
    throw new Error('此记录仅支持只读预览；会话恢复需要宿主导入接口');
  if (record.path.split('/').some(p => /^\.git$/i.test(p))) throw new Error('不能恢复 Git 元数据');
  const file = safePath(root, record.path);
  const before = currentFile(file);
  if ((before === null ? null : digest(before)) !== expectedHash)
    throw new Error('文件已在预览后变化，请重新预览再恢复');
  const value = store.version(record, side);
  if (value === null) throw new Error('所选版本为删除状态；请在项目中手动确认删除');
  const backup = store.save(
    { kind: 'restore-backup', workspaceId: record.workspaceId, path: record.path, sourceId: id },
    { local: before, remote: value },
  );
  const temp = file + '.chatsync-restore-' + randomUUID();
  let replaced = false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, value, { flag: 'wx' });
    // Recheck after backup creation; an editor may have saved during the preview/backup.
    const check = currentFile(file);
    if ((check === null ? null : digest(check)) !== expectedHash) throw new Error('文件已变化，请重新预览');
    fs.renameSync(temp, file);
    replaced = true;
    if (digest(fs.readFileSync(file)) !== digest(value)) throw new Error('写入后的校验失败');
    store.finish(backup.id, { status: 'restored' });
    return { ok: true, backupId: backup.id, sha256: digest(value) };
  } catch (e) {
    if (replaced) {
      if (before === null) fs.unlinkSync(file);
      else fs.writeFileSync(file, before);
    }
    throw e;
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
