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

// Fast-forward downloads also need this guard; a Git conflict is not required
// for a stale device registry to lose a surviving conversation's membership.
export function retainWorkspaceMembership(engine, before, after, available, removed = new Set()) {
  if (!before || !after) return after;
  const local = parseWorkspaceRegistry(before),
    next = parseWorkspaceRegistry(after);
  const cfg = engine.loadConfig();
  const key = (id, row) =>
    String(engine.localWorkspacePathOverride(id) || engine.workspacePathOf(row.path, cfg))
      .replace(/[/\\:]+/g, '\\')
      .replace(/\\+$/, '')
      .toLowerCase();
  const assigned = new Set(Object.values(next.tables.workspaces).flatMap(w => w.sessionIds || []));
  const archived = new Set(next.global?.archivedSessionIds || []);
  let changed = false;
  for (const [id, row] of Object.entries(local.tables.workspaces)) {
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
  return changed ? Buffer.from(JSON.stringify(next, null, 2)) : after;
}
