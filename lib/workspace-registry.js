import fs from 'node:fs';

// Validation belongs to ordinary transport, not just the optional repair page.
export function parseWorkspaceRegistry(bytes) {
  const data = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  if (
    !object(data) ||
    !object(data.tables) ||
    !object(data.tables.workspaces) ||
    (data.global !== undefined && !object(data.global))
  )
    throw new Error('工作区登记表结构损坏');
  for (const [id, row] of Object.entries(data.tables.workspaces)) {
    if (
      !/^[\w-]+$/.test(id) ||
      !object(row) ||
      typeof row.path !== 'string' ||
      !row.path ||
      (row.sessionIds !== undefined &&
        (!Array.isArray(row.sessionIds) || row.sessionIds.some(id => typeof id !== 'string')))
    )
      throw new Error('项目身份、路径或会话列表格式损坏');
  }
  for (const key of ['workspaceIds', 'archivedSessionIds', 'pinnedSessionIds'])
    if (
      data.global?.[key] !== undefined &&
      (!Array.isArray(data.global[key]) || data.global[key].some(id => typeof id !== 'string'))
    )
      throw new Error('工作区全局登记格式损坏');
  return data;
}

/** The spelling the host stores for a directory on this computer, or null when there is none. */
export function localDirectory(target) {
  try {
    const real = fs.realpathSync.native(target);
    return fs.statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

// The shared registry holds whichever path the last writer recorded. The host
// hides a session whose existing cwd differs from its project's path, so each
// computer keeps its own folder for a project. It also refuses to start when two
// projects claim one path, so projects that land on the same folder become one.
function settleProjectPaths(engine, local, next) {
  const key = projectKey(engine),
    cfg = engine.loadConfig(),
    directory = engine.localDirectory || localDirectory;
  const rows = next.tables.workspaces,
    ownRows = Object.entries(local?.tables.workspaces || {});
  const holders = new Map();
  let changed = false;
  for (const [id, row] of Object.entries(rows)) {
    const project = key(id, row);
    const own = local?.tables.workspaces[id] || ownRows.find(([ownId, other]) => key(ownId, other) === project)?.[1];
    const mapped = engine.localWorkspacePathOverride(id) || engine.workspacePathOf(row.path, cfg);
    const place = (own && directory(own.path)) || (mapped && directory(mapped)) || own?.path || row.path;
    if (place !== row.path) {
      row.path = place;
      changed = true;
    }
    const holder = holders.get(place);
    if (!holder) {
      holders.set(place, row);
      continue;
    }
    holder.sessionIds = [...new Set([...(holder.sessionIds || []), ...(row.sessionIds || [])])];
    delete rows[id];
    if (next.global?.workspaceIds) next.global.workspaceIds = next.global.workspaceIds.filter(other => other !== id);
    changed = true;
  }
  return changed;
}

// Fast-forward downloads also need this guard; a Git conflict is not required
// for a stale device registry to lose a surviving conversation's membership.
export function retainWorkspaceMembership(engine, before, after, available, removed = new Set()) {
  if (!after) return after;
  const local = before ? parseWorkspaceRegistry(before) : null,
    next = parseWorkspaceRegistry(after);
  const key = projectKey(engine);
  const assigned = new Set(Object.values(next.tables.workspaces).flatMap(w => w.sessionIds || []));
  const archived = new Set(next.global?.archivedSessionIds || []);
  let changed = false;
  for (const [id, row] of Object.entries(local?.tables.workspaces || {})) {
    const target =
      next.tables.workspaces[id] ||
      Object.entries(next.tables.workspaces).find(([otherId, other]) => key(otherId, other) === key(id, row))?.[1];
    if (!target) continue; // An explicitly deleted project stays deleted.
    for (const sid of row.sessionIds || []) {
      if (!available.has(sid) || assigned.has(sid) || archived.has(sid) || removed.has(sid)) continue;
      (target.sessionIds ||= []).push(sid);
      assigned.add(sid);
      changed = true;
    }
  }
  if (settleProjectPaths(engine, local, next)) changed = true;
  return changed ? Buffer.from(JSON.stringify(next, null, 2)) : after;
}

// Both OS paths of one project compare equal once mapped to this computer.
function projectKey(engine) {
  const cfg = engine.loadConfig();
  return (id, row) =>
    String(engine.localWorkspacePathOverride(id) || engine.workspacePathOf(row.path, cfg) || row.path)
      .replace(/[/\\:]+/g, '\\')
      .replace(/\\+$/, '')
      .toLowerCase();
}

// This computer only speaks for the sessions it has. A session that is in the
// shared copy but not here (created on another OS, or not imported yet) keeps
// its project, archive and pin entries from the shared registry, so exporting
// the local registry never reads as that session leaving its project.
// A computer that has never taken in the shared registry (`neverSeen`, its first
// connection) cannot have deleted anything in it, so its projects all stay.
export function keepSharedSessionEntries(
  engine,
  exported,
  shared,
  absent,
  { neverSeen = false, removed = new Set() } = {},
) {
  if (!exported || !shared || (!absent.size && !neverSeen)) return exported;
  let next, previous;
  try {
    next = parseWorkspaceRegistry(exported);
    previous = parseWorkspaceRegistry(shared);
  } catch {
    return exported; // A damaged shared copy is not a source of entries.
  }
  const key = projectKey(engine);
  const assigned = new Set(Object.values(next.tables.workspaces).flatMap(w => w.sessionIds || []));
  let changed = false;
  for (const [id, row] of Object.entries(previous.tables.workspaces)) {
    const target =
      next.tables.workspaces[id] ||
      Object.entries(next.tables.workspaces).find(([otherId, other]) => key(otherId, other) === key(id, row))?.[1];
    if (!target) {
      if (!neverSeen) continue; // A project deleted here stays deleted.
      const sessionIds = (row.sessionIds || []).filter(sid => !assigned.has(sid) && !removed.has(sid));
      next.tables.workspaces[id] = { ...row, sessionIds };
      next.global ||= {};
      next.global.workspaceIds = [...(next.global.workspaceIds || []), id];
      for (const sid of sessionIds) assigned.add(sid);
      changed = true;
      continue;
    }
    for (const sid of row.sessionIds || []) {
      if ((!absent.has(sid) && !neverSeen) || assigned.has(sid) || removed.has(sid)) continue;
      (target.sessionIds ||= []).push(sid);
      assigned.add(sid);
      changed = true;
    }
  }
  for (const list of ['archivedSessionIds', 'pinnedSessionIds']) {
    const kept = (previous.global?.[list] || []).filter(sid => absent.has(sid) && !next.global?.[list]?.includes(sid));
    if (!kept.length) continue;
    next.global ||= {};
    next.global[list] = [...(next.global[list] || []), ...kept];
    changed = true;
  }
  return changed ? Buffer.from(JSON.stringify(next, null, 2)) : exported;
}
