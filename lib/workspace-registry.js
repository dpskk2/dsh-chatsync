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
