// What a session is about, read from its own log: the title DSH gave it and the
// first messages the user wrote. Used wherever the sync page names a session.
import fs from 'node:fs';
import path from 'node:path';
import { decodeZstdFrames } from './merge.js';
import { safePath } from './recovery.js';
import { scopeMirrorPath } from './scope.js';
import { sessionIdOfLogPath, sessionLogGeneration } from './session-path.js';

const MAX_LOG_BYTES = 64 * 1024 * 1024;
const PREVIEW_MESSAGES = 3;
const PREVIEW_CHARS = 240;

function logText(buf, file) {
  if (!buf || buf.length > MAX_LOG_BYTES) return null;
  return /\.zstd$/i.test(file) ? decodeZstdFrames(buf, MAX_LOG_BYTES) : buf.toString('utf8');
}

/** Title, message count and the first user messages of a session log. */
export function summarizeLog(buf, file) {
  const text = logText(buf, file);
  if (text === null) return null;
  let title = '',
    messages = 0,
    firstAt = null,
    lastAt = null;
  const preview = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (Number.isFinite(row.time)) {
      firstAt ??= row.time;
      lastAt = row.time;
    }
    if (row.type === 'session/title' && typeof row.data?.title === 'string' && row.data.title.trim())
      title = row.data.title.trim();
    if (row.type !== 'user/message') continue;
    messages += 1;
    if (preview.length >= PREVIEW_MESSAGES) continue;
    const words = (Array.isArray(row.data?.content) ? row.data.content : [])
      .filter(part => part?.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (words) preview.push(words.length > PREVIEW_CHARS ? words.slice(0, PREVIEW_CHARS) + '…' : words);
  }
  return { title, messages, preview, firstAt, lastAt };
}

// The newest log of a session in a data root (DSH data directory or transport copy).
function newestLog(root, id) {
  const base = path.join(root, 'sessions');
  if (!fs.existsSync(base)) return null;
  let found = null;
  for (const folder of fs.readdirSync(base)) {
    const dir = path.join(base, folder, id);
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const relative = `sessions/${folder}/${id}/${name}`;
      if (sessionIdOfLogPath(relative) !== id) continue;
      const generation = sessionLogGeneration(relative) ?? -1;
      if (!found || generation > found.generation) found = { relative, generation };
    }
  }
  return found && safePath(root, found.relative);
}

function cachedTitle(root, id) {
  try {
    const value = JSON.parse(
      fs
        .readFileSync(safePath(root, 'storages/session_projcache/sessions/' + id + '.json'), 'utf8')
        .replace(/^\uFEFF/, ''),
    )?.record?.rows?.title?.val;
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

function roots(engine) {
  const cfg = engine.loadConfig();
  const mirror = cfg.remote ? scopeMirrorPath(engine.home, cfg) : null;
  return [engine.home, mirror && fs.existsSync(mirror) ? mirror : null].filter(Boolean);
}

/** Title of a session that is on this computer or in the shared copy; '' when unknown. */
export function sessionTitle(engine, id) {
  const where = roots(engine);
  for (const root of where) {
    const title = cachedTitle(root, id);
    if (title) return title;
  }
  for (const root of where) {
    const file = newestLog(root, id);
    if (!file) continue;
    const title = summarizeLog(fs.readFileSync(file), file)?.title;
    if (title) return title;
  }
  return '';
}

// Last version of the session in the shared history, for sessions no longer present.
async function historyLog(engine, id) {
  const cfg = engine.loadConfig();
  if (!cfg.remote) return null;
  const folder = scopeMirrorPath(engine.home, cfg);
  if (!fs.existsSync(path.join(folder, '.git'))) return null;
  const git = args => engine.git(['-C', folder, ...args]);
  const spec = `:(glob)sessions/*/${id}/**`;
  const last = await git(['rev-list', '-1', `refs/remotes/origin/${cfg.branch}`, '--', spec]);
  if (!engine.ok(last) || !last.out.trim()) return null;
  for (const commit of [last.out.trim(), last.out.trim() + '^']) {
    const listing = await git(['ls-tree', '-r', '--name-only', commit, '--', 'sessions/']);
    if (!engine.ok(listing)) continue;
    const log = listing.out
      .split('\n')
      .filter(file => sessionIdOfLogPath(file) === id)
      .sort((a, b) => (sessionLogGeneration(b) ?? -1) - (sessionLogGeneration(a) ?? -1))[0];
    if (!log) continue;
    const shown = await engine.gitBytes(['-C', folder, 'show', commit + ':' + log]);
    if (engine.ok(shown)) return { buf: shown.out, file: log };
  }
  return null;
}

/** Title and first messages of a session, from this computer, the shared copy or its history. */
export async function sessionPreview(engine, id) {
  for (const root of roots(engine)) {
    const file = newestLog(root, id);
    if (!file) continue;
    const summary = summarizeLog(fs.readFileSync(file), file);
    if (summary)
      return {
        ok: true,
        id,
        source: root === engine.home ? 'local' : 'shared',
        ...summary,
        title: summary.title || cachedTitle(root, id),
      };
  }
  const old = await historyLog(engine, id);
  const summary = old && summarizeLog(old.buf, old.file);
  if (!summary) throw new Error('找不到这个会话的记录。');
  return { ok: true, id, source: 'history', ...summary };
}

const SESSION_PATH = /^(?:sessions\/[^/]+\/([^/]+)\/|storages\/session_projcache\/sessions\/([^/]+)\.json$)/i;

/** Title of the session a recovery record belongs to, read from the record's own saved copy when needed. */
export function recordSessionTitle(engine, record) {
  const file = String(record?.path || '').replace(/\\/g, '/');
  const match = SESSION_PATH.exec(file);
  if (!match) return null;
  const id = match[1] || match[2];
  const cache = (engine._recordTitles ||= new Map());
  if (cache.has(record.id)) return cache.get(record.id);
  const titles = (engine._sessionTitles ||= new Map());
  const known = titles.get(id);
  let title = known && Date.now() - known.at < 60000 ? known.title : sessionTitle(engine, id);
  if (!known || known.title !== title) titles.set(id, { title, at: Date.now() });
  if (!title && /^storages\/session_projcache\//.test(file))
    for (const side of ['local', 'remote']) {
      try {
        const bytes = engine.recovery.version(record, side);
        const saved = bytes && JSON.parse(bytes.toString('utf8'))?.record?.rows?.title?.val;
        if (typeof saved === 'string' && saved.trim()) {
          title = saved.trim();
          break;
        }
      } catch {
        /* keep trying the other saved version */
      }
    }
  if (!title && sessionIdOfLogPath(file))
    for (const side of ['local', 'remote']) {
      try {
        const bytes = engine.recovery.version(record, side);
        title = (bytes && summarizeLog(bytes, file)?.title) || '';
      } catch {}
      if (title) break;
    }
  cache.set(record.id, title);
  return title;
}
