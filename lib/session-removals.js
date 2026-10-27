import fs from 'node:fs';
import path from 'node:path';
import { LOCAL_DATA, atomicJson, safePath } from './recovery.js';
import { sessionIdPattern } from './session-path.js';

// Sessions removed from sync, shared through the sync repository so that every
// computer stops uploading them (a sessions-category file, merged as a union).
export const SHARED_REMOVALS = 'storages/sync-meta/sessions/removed.json';

function readRows(file, label) {
  let rows;
  try {
    rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(label + '无法读取，请先检查本机数据');
  }
  if (!Array.isArray(rows) || rows.some(row => !sessionIdPattern.test(row?.sessionId || '')))
    throw new Error(label + '格式有误，请先检查本机数据');
  return rows;
}

// Local, explicit deletion receipts and the shared removal list prevent a stale
// remote copy from restoring a retired identity. Absence or archival never counts.
export function removedSessionIds(engine) {
  const local = readRows(path.join(engine.home, LOCAL_DATA, 'session-removals.json'), '会话删除记录');
  const shared = readRows(safePath(engine.home, SHARED_REMOVALS), '同步移除记录');
  return new Set([...local, ...shared].map(row => row.sessionId));
}

/** The shared removal list as found under another root, such as the transport copy. */
export function sharedRemovalIds(root) {
  return new Set(readRows(safePath(root, SHARED_REMOVALS), '同步移除记录').map(row => row.sessionId));
}

/**
 * Remove sessions from sync on every computer. The next sync drops their files and
 * registration from the shared copy; local copies on each computer stay where they are.
 * @param {any} engine
 * @param {string[]} ids
 */
export function removeSessionsFromSync(engine, ids) {
  if (!Array.isArray(ids) || !ids.length) throw new Error('请选择要移出同步的会话');
  if (ids.some(id => typeof id !== 'string' || !sessionIdPattern.test(id))) throw new Error('会话标识无效');
  const file = safePath(engine.home, SHARED_REMOVALS);
  const rows = readRows(file, '同步移除记录');
  const known = new Set(rows.map(row => row.sessionId));
  const removed = [...new Set(ids)].filter(id => !known.has(id));
  if (removed.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const at = new Date().toISOString();
    atomicJson(file, [...rows, ...removed.map(sessionId => ({ sessionId, removedAt: at }))]);
  }
  return { removed };
}

/** Union of two removal lists (each side's JSON text); the earliest removal time wins. */
export function mergeRemovalLists(oursText, theirsText) {
  const byId = new Map();
  for (const text of [oursText, theirsText]) {
    let rows;
    try {
      rows = JSON.parse(text || '[]');
    } catch {
      return { ok: false };
    }
    if (!Array.isArray(rows) || rows.some(row => !sessionIdPattern.test(row?.sessionId || ''))) return { ok: false };
    for (const row of rows) {
      const seen = byId.get(row.sessionId);
      if (!seen || String(row.removedAt || '') < String(seen.removedAt || '')) byId.set(row.sessionId, row);
    }
  }
  const merged = [...byId.values()].sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  return { ok: true, value: JSON.stringify(merged, null, 2) + '\n' };
}

export function withoutRemovedSessions(bytes, removed) {
  if (!bytes || !removed.size) return bytes;
  const data = JSON.parse(bytes.toString());
  for (const row of Object.values(data.tables?.workspaces || {}))
    if (Array.isArray(row.sessionIds)) row.sessionIds = row.sessionIds.filter(id => !removed.has(id));
  for (const key of ['archivedSessionIds', 'pinnedSessionIds'])
    if (Array.isArray(data.global?.[key])) data.global[key] = data.global[key].filter(id => !removed.has(id));
  return Buffer.from(JSON.stringify(data, null, 2));
}
