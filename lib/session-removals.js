import fs from 'node:fs';
import path from 'node:path';
import { LOCAL_DATA } from './recovery.js';
import { sessionIdPattern } from './session-path.js';

// Local, explicit deletion receipts prevent a stale remote copy from restoring
// a retired identity. They never infer deletion from absence or archival.
export function removedSessionIds(engine) {
  let rows;
  try { rows = JSON.parse(fs.readFileSync(path.join(engine.home, LOCAL_DATA, 'session-removals.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return new Set(); throw new Error('会话删除记录无法读取，请先检查本机数据'); }
  if (!Array.isArray(rows) || rows.some(row => !sessionIdPattern.test(row?.sessionId || '')))
    throw new Error('会话删除记录格式有误，请先检查本机数据');
  return new Set(rows.map(row => row.sessionId));
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
