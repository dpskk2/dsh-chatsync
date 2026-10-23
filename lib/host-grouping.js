import fs from 'node:fs';
import path from 'node:path';
import { canonicalWorkspacePath } from './workspace-target.js';
import { atomicJson, LOCAL_DATA } from './recovery.js';
import { createHash } from 'node:crypto';

const evidenceFile = engine => path.join(engine.home, LOCAL_DATA, 'grouping-evidence.json');
const projectRows = data => (data?.global?.workspaceIds || []).flatMap(id => {
  const row = data.tables?.workspaces?.[id];
  return row ? [{ id, ...row }] : [];
});
const registrySignature = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
// Absence alone does not establish corruption: DSH deliberately retains logs
// when a workspace is deleted. Only an observed sync transition is evidence.
export function recordGroupingTransition(engine, beforeBytes, afterBytes) {
  if (!beforeBytes || !afterBytes) return;
  const before = JSON.parse(beforeBytes.toString()), after = JSON.parse(afterBytes.toString());
  const next = projectRows(after), archived = new Set(after.global?.archivedSessionIds || []);
  const assigned = new Set(next.flatMap(w => w.sessionIds || []));
  const losses = [];
  for (const previous of projectRows(before)) {
    const target = next.find(w => w.id === previous.id && canonicalWorkspacePath(w.path) === canonicalWorkspacePath(previous.path));
    // A removed/replaced workspace is a normal deletion, not a repair request.
    if (!target) continue;
    for (const id of previous.sessionIds || []) if (!assigned.has(id) && !archived.has(id))
      losses.push({ id, workspaceId: target.id, path: target.path, registrySignature: registrySignature(after) });
  }
  const saved = readGroupingEvidence(engine);
  const entries = [...saved.filter(item => item.registrySignature === registrySignature(after) && !losses.some(loss => loss.id === item.id)), ...losses]
    .filter(item => next.some(w => w.id === item.workspaceId && canonicalWorkspacePath(w.path) === canonicalWorkspacePath(item.path))
      && !assigned.has(item.id) && !archived.has(item.id));
  if (entries.length || saved.length) {
    fs.mkdirSync(path.dirname(evidenceFile(engine)), { recursive: true });
    atomicJson(evidenceFile(engine), entries);
  }
}
function readGroupingEvidence(engine) {
  try { const value = JSON.parse(fs.readFileSync(evidenceFile(engine), 'utf8')); return Array.isArray(value) ? value : []; }
  catch { return []; }
}

export function classifyGrouping(engine, disk, live = null, archiveIds = null) {
  const rows = projectRows(disk), archived = new Set(archiveIds || disk.global?.archivedSessionIds || []);
  const owners = new Map(rows.flatMap(w => (w.sessionIds || []).map(id => [id, w])));
  const grouped = new Set((live || rows).flatMap(w => w.sessionIds));
  const evidence = readGroupingEvidence(engine).filter(item => item.registrySignature === registrySignature(disk) && rows.some(w => w.id === item.workspaceId
    && canonicalWorkspacePath(w.path) === canonicalWorkspacePath(item.path)));
  const ungroupedIds = [], refreshableIds = [], ordinaryIds = [], archivedIds = [];
  for (const session of engine.scanSessions()) {
    if (grouped.has(session.id) || !engine.sessionHasTurn(session.file)) continue;
    if (archived.has(session.id)) { archivedIds.push(session.id); continue; }
    const owner = owners.get(session.id), loss = evidence.find(item => item.id === session.id);
    if (!owner && !loss) { ordinaryIds.push(session.id); continue; }
    ungroupedIds.push(session.id);
    const cwd = engine.sessionCwdOf(path.dirname(session.file), session.group);
    try {
      if (owner && path.isAbsolute(cwd) && fs.statSync(cwd).isDirectory()
        && canonicalWorkspacePath(owner.path) === canonicalWorkspacePath(cwd)) refreshableIds.push(session.id);
    } catch { /* Diagnosis remains actionable; a restart cannot repair this path. */ }
  }
  return { ungroupedIds: [...new Set(ungroupedIds)], refreshableIds: [...new Set(refreshableIds)],
    ordinaryIds: [...new Set(ordinaryIds)], archivedIds: [...new Set(archivedIds)] };
}

// WorkspaceEntity.sessionIds is the same filtered in-memory projection used by
// the sidebar. The JSON file alone cannot reveal a stale header/cwd index.
export function hostGroupingState(engine) {
  try {
    const registry = typeof engine.ctx?.get === 'function' ? engine.ctx.get('workspaceRegistry') : engine.ctx?.workspaceRegistry;
    if (typeof registry?.list !== 'function') return { available: false, ungroupedIds: [], refreshableIds: [] };
    const live = registry.list();
    if (!Array.isArray(live) || live.some(ws => !ws || !Array.isArray(ws.sessionIds))) throw new Error('invalid workspace projection');
    const disk = JSON.parse(fs.readFileSync(path.join(engine.home, 'storages/workspace.json'), 'utf8'));
    // The running host owns archive changes. A delayed disk save must not hide
    // a session that the user has just unarchived.
    return { available: true, ...classifyGrouping(engine, disk, live,
      Array.isArray(registry.archivedSessionIds) ? registry.archivedSessionIds : null) };
  } catch { return { available: false, ungroupedIds: [], refreshableIds: [] }; }
}

// Local diagnosis stays available even when network sync or a queued repair is
// blocking startup. This route never rewrites data or schedules a restart.
export function groupingRepairStatus(engine) {
  const cfg = engine.loadConfig(), state = engine.hostGroupingState();
  const ids = state.available ? state.ungroupedIds : engine.ungroupedSessionIds();
  const sorted = [...new Set(ids)].sort();
  return { enabled: !cfg.configError && cfg.autoRestartAfterRepair === true,
    count: sorted.length, signature: sorted.join(','), busy: Boolean(engine.inFlight),
    ordinaryCount: state.ordinaryIds?.length || 0, archivedCount: state.archivedIds?.length || 0,
    refreshOnly: sorted.length > 0 && sorted.every(id => state.refreshableIds.includes(id)),
    issueKey: sorted.find(id => !state.refreshableIds.includes(id))
      ? 'membership:' + sorted.find(id => !state.refreshableIds.includes(id)) : null };
}

// This timer checks local grouping only. It never starts a network sync.
export function watchGrouping({ engine, ready, onScheduled, clock = globalThis }) {
  let previous = '';
  const tick = () => {
    const cfg = engine.loadConfig();
    if (!ready() || engine.inFlight || cfg.configError || cfg.enabled === false || cfg.autoRestartAfterRepair !== true) { previous = ''; return; }
    const state = engine.hostGroupingState();
    const key = state.refreshableIds.slice().sort().join(',');
    const stable = key && key === previous;
    if (key && key !== previous) engine.log('info', `运行分组自查：${state.refreshableIds.length} 个会话已在磁盘登记，但宿主分组尚未刷新；连续确认后检查空闲重开。`);
    previous = key;
    if (!stable && !engine._pendingRepairRestart) return;
    const result = engine.lastOutcome || {};
    if (stable) result.restartRequired = true;
    if (engine.maybeScheduleRepairRestart(result)) onScheduled();
  };
  const timer = clock.setInterval(tick, 15000);
  timer?.unref?.();
  return () => clock.clearInterval(timer);
}
