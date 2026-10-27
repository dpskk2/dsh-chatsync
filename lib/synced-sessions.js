// The sessions in the shared copy and on this computer, listed for the sync page.
import fs from 'node:fs';
import path from 'node:path';
import { safePath } from './recovery.js';
import { scopeMirrorPath } from './scope.js';
import { sessionIdOfLogPath } from './session-path.js';
import { removedSessionIds } from './session-removals.js';

// Newest log of each session under a data root (DSH data directory or transport copy).
function sessionLogs(root) {
  const found = new Map();
  const base = path.join(root, 'sessions');
  if (!fs.existsSync(base)) return found;
  for (const folder of fs.readdirSync(base, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    for (const session of fs.readdirSync(path.join(base, folder.name), { withFileTypes: true })) {
      if (!session.isDirectory()) continue;
      for (const name of fs.readdirSync(path.join(base, folder.name, session.name))) {
        const relative = `sessions/${folder.name}/${session.name}/${name}`;
        const id = sessionIdOfLogPath(relative);
        if (!id) continue;
        const stat = fs.lstatSync(path.join(root, relative));
        if (!stat.isFile()) continue;
        const seen = found.get(id);
        if (!seen || stat.mtimeMs > seen.updatedAt) found.set(id, { folder: folder.name, updatedAt: stat.mtimeMs });
      }
    }
  }
  return found;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

// DSH names a project folder after its path, with non-ASCII characters as ~XXXX.
export function projectFolderLabel(folder) {
  const decoded = String(folder)
    .replace(/^-+|-+$/g, '')
    .replace(/~([0-9A-F]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return decoded.split('-').filter(Boolean).at(-1) || decoded;
}

/** @param {any} engine */
export function listSyncedSessions(engine) {
  const cfg = engine.loadConfig();
  const removed = removedSessionIds(engine);
  const mirror = cfg.remote ? scopeMirrorPath(engine.home, cfg) : null;
  const shared = mirror && fs.existsSync(path.join(mirror, '.git')) ? sessionLogs(mirror) : null;
  const local = sessionLogs(engine.home);
  const registry = readJson(safePath(engine.home, 'storages/workspace.json'));
  const project = new Map();
  for (const workspace of Object.values(registry?.tables?.workspaces || {}))
    for (const id of workspace?.sessionIds || []) project.set(id, workspace.title || workspace.path || '');
  const archived = new Set(registry?.global?.archivedSessionIds || []);
  const title = id => {
    for (const root of [engine.home, mirror].filter(Boolean)) {
      const value = readJson(safePath(root, 'storages/session_projcache/sessions/' + id + '.json'))?.record?.rows?.title
        ?.val;
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  };
  const sessions = [...new Set([...(shared?.keys() || []), ...local.keys()])]
    .filter(id => !removed.has(id))
    .map(id => {
      const seen = local.get(id) || shared.get(id);
      return {
        id,
        title: title(id),
        folder: projectFolderLabel(seen.folder),
        project: project.has(id) ? project.get(id) : null,
        archived: archived.has(id),
        onThisComputer: local.has(id),
        inShared: shared ? shared.has(id) : null,
        updatedAt: Math.max(local.get(id)?.updatedAt || 0, shared?.get(id)?.updatedAt || 0),
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return { ok: true, sharedKnown: Boolean(shared), removedCount: removed.size, sessions };
}
