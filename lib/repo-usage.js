// Read-only breakdown of what the sync repository holds and what a new computer
// downloads: the current version by kind, and the history behind it.
import fs from 'node:fs';
import path from 'node:path';
import { contentKind, transportable, scopeMirrorPath, SETTINGS_WRITER } from './scope.js';
import { sessionTitle } from './session-info.js';
import { parseSyncRemote } from './remote.js';

const ID = '[a-z][a-z0-9_-]{0,63}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SESSION_FILE = new RegExp(
  '^(?:sessions/[^/]+/(' + ID + ')/|storages/session_projcache/sessions/(' + ID + ')\\.json$)',
  'i',
);
export const USAGE_GROUPS = [
  ['sessions', '正在用的会话'],
  ['archived', '已归档的会话'],
  ['hidden', '在 DSH 中看不到的会话'],
  ['attachments', '附件'],
  ['settings', '设置'],
  ['instructions', '全局指令与技能'],
  ['leftover', '不再同步的旧文件'],
  ['meta', '同步记录'],
];

function sessionOf(file) {
  const match = SESSION_FILE.exec(file);
  return match ? match[1] || match[2] : null;
}

// Which group a path belongs to, judged against the registry of the current version.
function groupOf(file, registry) {
  if (!transportable(file) || file === SETTINGS_WRITER) return 'meta';
  const kind = contentKind(file);
  if (kind === null) return 'leftover';
  if (kind !== 'sessions') return kind;
  const id = sessionOf(file);
  if (!id) return 'meta';
  if (registry.archived.has(id)) return 'archived';
  return registry.registered.has(id) ? 'sessions' : 'hidden';
}

function readRegistry(text) {
  const registered = new Set(),
    archived = new Set();
  try {
    const value = JSON.parse(String(text).replace(/^\uFEFF/, ''));
    for (const ws of Object.values(value?.tables?.workspaces || {}))
      for (const id of ws?.sessionIds || []) registered.add(id);
    for (const id of value?.global?.archivedSessionIds || []) archived.add(id);
  } catch {}
  return { registered, archived };
}

const remoteKind = (name, cfg) =>
  name.startsWith('backup/')
    ? 'backup'
    : name.startsWith('chatsync-device/')
      ? 'device'
      : name.startsWith((cfg.workspaceBranchPrefix || 'ws') + '/')
        ? 'project'
        : 'other';

/** @param {any} engine */
export async function analyzeRepoUsage(engine) {
  const cfg = engine.loadConfig();
  const remote = parseSyncRemote(cfg.remote);
  if (cfg.configError) throw new Error(cfg.configError);
  if (!cfg.remote) throw new Error('尚未连接同步仓库。');
  if (engine.inFlight || engine.progress?.running) throw new Error('同步正在进行，请完成后再检查。');
  const folder = scopeMirrorPath(engine.home, cfg);
  if (!fs.existsSync(path.join(folder, '.git'))) throw new Error('还没有建立同步副本，请先同步一次。');
  const git = (args, timeout = 300000) => engine.git(['-C', folder, ...args], timeout);
  const head = await git(['rev-parse', '--verify', `refs/remotes/origin/${cfg.branch}^{commit}`]);
  if (!engine.ok(head)) throw new Error('还没有远端同步记录，请先同步一次。');
  const tip = head.out.trim();

  const shownRegistry = await git(['show', tip + ':storages/workspace.json']);
  const registry = readRegistry(engine.ok(shownRegistry) ? shownRegistry.out : '');
  const listing = await git(['ls-tree', '-r', '-z', '-l', tip]);
  if (!engine.ok(listing)) throw new Error('无法读取同步仓库的文件清单。');
  const current = new Map();
  for (const row of listing.out.split('\0').filter(Boolean)) {
    const tab = row.indexOf('\t');
    const [, type, sha, size] = row.slice(0, tab).split(/\s+/);
    if (type === 'blob') current.set(row.slice(tab + 1), { sha, size: Number(size) || 0 });
  }
  const currentShas = new Set([...current.values()].map(v => v.sha));

  // Compressed size of each object as stored, which is close to what a clone downloads.
  const objects = await git(['rev-list', '--objects', tip]);
  const sizes = await git([
    'cat-file',
    '--batch-all-objects',
    '--batch-check=%(objectname) %(objecttype) %(objectsize:disk)',
  ]);
  const commits = await git(['rev-list', '--count', tip]);
  const shallow = await git(['rev-parse', '--is-shallow-repository']);
  if (!engine.ok(objects) || !engine.ok(sizes) || !engine.ok(commits)) throw new Error('无法读取同步仓库的历史。');
  const disk = new Map();
  for (const line of sizes.out.split('\n').filter(Boolean)) {
    const [sha, type, size] = line.split(' ');
    disk.set(sha, { type, size: Number(size) || 0 });
  }

  const groups = Object.fromEntries(
    USAGE_GROUPS.map(([id]) => [id, { files: 0, bytes: 0, storedBytes: 0, historyBytes: 0 }]),
  );
  let structureBytes = 0,
    totalBytes = 0;
  const counted = new Set();
  for (const line of objects.out.split('\n').filter(Boolean)) {
    const space = line.indexOf(' ');
    const sha = space < 0 ? line : line.slice(0, space),
      file = space < 0 ? '' : line.slice(space + 1);
    if (counted.has(sha)) continue;
    counted.add(sha);
    const info = disk.get(sha);
    if (!info) continue;
    totalBytes += info.size;
    if (info.type !== 'blob') {
      structureBytes += info.size;
      continue;
    }
    if (currentShas.has(sha)) continue;
    // Only in history: attribute to the path where rev-list first met it.
    const group = groupOf(file, registry);
    groups[group].historyBytes += info.size;
  }
  const storedShas = new Set();
  // Sessions that can leave the sync: archived ones and those DSH does not show.
  const listed = { archived: new Map(), hidden: new Map() };
  for (const [file, { sha, size }] of current) {
    const id = groupOf(file, registry);
    const session = sessionOf(file);
    if (session && listed[id]) {
      const row = listed[id].get(session) || { id: session, bytes: 0 };
      row.bytes += disk.get(sha)?.size || 0;
      listed[id].set(session, row);
    }
    const group = groups[id];
    group.files += 1;
    group.bytes += size;
    if (!storedShas.has(sha)) {
      storedShas.add(sha);
      group.storedBytes += disk.get(sha)?.size || 0;
    }
  }
  const currentBytes = Object.values(groups).reduce((sum, g) => sum + g.storedBytes, 0);
  // Everything stored in this computer's copy, including history that only local
  // refs (old backups) still pin; the sync detail reports this same total.
  const localBytes = [...disk.values()].reduce((sum, d) => sum + d.size, 0);
  const historyBytes = Object.values(groups).reduce((sum, g) => sum + g.historyBytes, 0);

  // Branches the user's sync repository holds besides the sync branch. A new
  // computer only downloads the sync branch and its registered projects.
  let branches = null;
  const heads = await engine.git(['ls-remote', '--heads', cfg.remote], 60000);
  if (engine.ok(heads)) {
    branches = { project: 0, backup: 0, device: 0, other: 0 };
    for (const line of heads.out.split('\n').filter(Boolean)) {
      const name = line.split('\t')[1]?.replace(/^refs\/heads\//, '');
      if (name && name !== cfg.branch) branches[remoteKind(name, cfg)] += 1;
    }
  }

  return {
    ok: true,
    branch: cfg.branch,
    repositoryUrl: remote ? remote.webUrl : null,
    repositoryLabel: remote ? remote.label : null,
    commits: Number(commits.out.trim()) || 0,
    shallow: shallow.out.trim() === 'true',
    totalBytes,
    localBytes,
    localOtherBytes: Math.max(0, localBytes - totalBytes),
    currentBytes,
    historyBytes,
    structureBytes,
    groups: USAGE_GROUPS.map(([id, title]) => ({ id, title, ...groups[id] })),
    sessions: Object.fromEntries(
      Object.entries(listed).map(([key, rows]) => [
        key,
        [...rows.values()]
          .map(row => ({ ...row, title: sessionTitle(engine, row.id) }))
          .sort((a, b) => b.bytes - a.bytes),
      ]),
    ),
    branches,
  };
}
