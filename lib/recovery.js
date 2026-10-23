import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { decodeZstdFrames, ZSTD_MAGIC } from './merge.js';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const LOCAL_DATA = '.chatsync-local';

export function recoveryCategory(record) {
  if (Object.values(record.imports || {}).some(attempt => attempt.status !== 'verified')) return 'attention';
  if (record.reviewState === 'archived') return 'history';
  if (record.reviewState === 'attention') return 'attention';
  if (['data-repair', 'scope-backup', 'restore-backup'].includes(record.kind)) return 'history';
  return 'attention';
}

// Reject symlinks in every component, including the final file, before any I/O.
export function safePath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || relative.includes('\\')
    || relative.split('/').some(p => !p || p === '.' || p === '..' || p.includes(':'))
    || path.isAbsolute(relative)) throw new Error('无效的文件路径');
  const base = path.resolve(root);
  if (fs.lstatSync(base).isSymbolicLink()) throw new Error('不支持符号链接目录');
  let current = base;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('不支持符号链接文件或目录'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return current;
}

export function atomicJson(file, value) {
  atomicBytes(file, Buffer.from(JSON.stringify(value, null, 2) + '\n'));
}
export function atomicBytes(file, bytes) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(temp, bytes, { flag: 'wx', flush: true }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

export class RecoveryStore {
  constructor(home) { this.home = home; }
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
    atomicJson(path.join(dir, 'record.json'), record);
    const fd = fs.openSync(path.join(dir, 'record.json'), 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
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
    if (!fs.existsSync(dir)) return [];
    const records = [];
    for (const id of fs.readdirSync(dir)) {
      try { records.push(this.read(id)); } catch { /* incomplete records never become restore candidates */ }
    }
    return records.sort((a, b) => b.createdAt - a.createdAt);
  }
  version(record, side) {
    if (!['local', 'remote'].includes(side)) throw new Error('请选择本机或远端版本');
    const meta = record.versions[side];
    if (!meta) throw new Error('缺少版本信息');
    if (meta.missing) return null;
    const file = safePath(this.directory(), record.id + '/' + side + '.bin');
    const buf = fs.readFileSync(file);
    if (buf.length !== meta.bytes || digest(buf) !== meta.sha256) throw new Error('原件校验失败，已停止恢复');
    return buf;
  }
  finish(id, result) {
    const record = this.read(id);
    atomicJson(this.recordPath(id), { ...record, ...result });
  }
  archive(id, expectedVersions, archived = true) {
    const record = this.read(id);
    if (archived) {
      if (!['merged', 'applied', 'repaired', 'restored'].includes(record.status)
        || Object.values(record.imports || {}).some(attempt => attempt.status !== 'verified')) {
        throw new Error('此记录仍有未完成的处理，请先完成恢复或修复');
      }
      for (const side of ['local', 'remote']) {
        const bytes = this.version(record, side);
        if ((bytes === null ? null : digest(bytes)) !== expectedVersions?.[side]) throw new Error('原件已变化，请重新读取记录');
      }
    }
    this.finish(id, { reviewState: archived ? 'archived' : 'attention', reviewedAt: Date.now() });
    return { ok: true, hint: archived ? '已移入历史记录。' : '已放回待核对列表。' };
  }
  preview(id) {
    const record = this.read(id);
    const display = side => {
      const buf = this.version(record, side);
      if (buf === null) return { missing: true };
      const compressed = buf.subarray(0, 4).equals(ZSTD_MAGIC);
      if (compressed && buf.length > 4 * 1024 * 1024) return { bytes: buf.length, binary: true, hint: '此会话较大，暂不支持文本预览' };
      const decoded = compressed ? decodeZstdFrames(buf, 4 * 1024 * 1024) : null;
      if (compressed && decoded === null) return { bytes: buf.length, binary: true, hint: '无法读取此会话的压缩格式' };
      if (!compressed && buf.includes(0)) return { bytes: buf.length, binary: true };
      const text = decoded ?? buf.subarray(0, 64 * 1024).toString('utf8');
      return { bytes: buf.length, sha256: digest(buf), text: text.slice(0, 64 * 1024),
        truncated: text.length > 64 * 1024 || (!compressed && buf.length > 64 * 1024) };
    };
    return { record, local: display('local'), remote: display('remote') };
  }
}

export function currentFile(file) {
  try { const stat = fs.lstatSync(file); if (!stat.isFile()) throw new Error('目标不是普通文件'); return fs.readFileSync(file); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

// The caller holds the engine's cross-process lock throughout this transaction.
export function restoreFile(store, id, side, root, expectedHash) {
  const record = store.read(id);
  if (!((record.kind === 'ws' && record.status === 'merged') || (record.kind === 'restore-backup' && record.status === 'restored'))) throw new Error('此记录仅支持只读预览；会话恢复需要宿主导入接口');
  if (record.path.split('/').some(p => /^\.git$/i.test(p))) throw new Error('不能恢复 Git 元数据');
  const file = safePath(root, record.path);
  const before = currentFile(file);
  if ((before === null ? null : digest(before)) !== expectedHash) throw new Error('文件已在预览后变化，请重新预览再恢复');
  const value = store.version(record, side);
  if (value === null) throw new Error('所选版本为删除状态；请在项目中手动确认删除');
  const backup = store.save({ kind: 'restore-backup', workspaceId: record.workspaceId, path: record.path, sourceId: id }, { local: before, remote: value });
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
    if (replaced) { if (before === null) fs.unlinkSync(file); else fs.writeFileSync(file, before); }
    throw e;
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
