import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SyncEngine } from '../lib/sync.js';
import { watchGrouping, groupingRepairStatus, recordGroupingTransition } from '../lib/host-grouping.js';
import { windowsOutput } from '../lib/windows-output.js';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-grouping-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const engine = new SyncEngine(home, { enabled: true, autoRestartAfterRepair: true });
  fs.mkdirSync(path.join(home, 'storages'));
  const record = {
    global: { workspaceIds: ['ws'], archivedSessionIds: [] },
    tables: { workspaces: { ws: { path: home, sessionIds: ['a'] } } },
  };
  const write = () => fs.writeFileSync(path.join(home, 'storages/workspace.json'), JSON.stringify(record));
  write();
  const live = { sessionIds: [] },
    registry = { list: () => [live], archivedSessionIds: [] };
  engine.ctx = { get: name => (name === 'workspaceRegistry' ? registry : undefined) };
  engine.scanSessions = () => [{ id: 'a', file: 'a-log' }];
  engine.sessionHasTurn = () => true;
  engine.sessionCwdOf = () => home;
  engine.sessionActivity = () => ({ available: true, activeCount: 0 });
  engine.autoRestartHost = () => 'desktop';
  let scheduled = 0;
  engine.scheduleRestartAfterRepair = () => {
    scheduled++;
    return true;
  };
  return { engine, live, registry, record, write, scheduled: () => scheduled };
}

test('disk membership cannot hide a stale sidebar index; archives and blanks stay excluded', t => {
  const h = fixture(t);
  assert.deepEqual(h.engine.hostGroupingState(), {
    available: true,
    ungroupedIds: ['a'],
    refreshableIds: ['a'],
    ordinaryIds: [],
    archivedIds: [],
  });
  assert.deepEqual(h.engine.ungroupedSessionIds(), ['a']);
  h.live.sessionIds = ['a'];
  assert.deepEqual(h.engine.ungroupedSessionIds(), []);
  h.live.sessionIds = [];
  h.registry.archivedSessionIds = ['a'];
  assert.deepEqual(h.engine.ungroupedSessionIds(), []);
  h.registry.archivedSessionIds = [];
  h.engine.sessionHasTurn = () => false;
  assert.deepEqual(h.engine.ungroupedSessionIds(), []);
});

test('a missing or mismatched cwd is reported without repeated automatic restarts', t => {
  const h = fixture(t);
  h.engine.sessionCwdOf = () => path.join(h.engine.home, 'missing');
  assert.deepEqual(h.engine.hostGroupingState().ungroupedIds, ['a']);
  assert.deepEqual(h.engine.hostGroupingState().refreshableIds, []);
  assert.equal(h.engine.maybeScheduleRepairRestart({ restartRequired: true }), false);
  assert.equal(h.scheduled(), 0);
});

test('live unarchive is detected before disk persistence and before project membership exists', t => {
  const h = fixture(t);
  h.record.global.archivedSessionIds = ['a'];
  h.record.tables.workspaces.ws.sessionIds = [];
  h.write();
  h.registry.archivedSessionIds = ['a'];
  assert.deepEqual(h.engine.ungroupedSessionIds(), []);
  h.registry.archivedSessionIds = [];
  assert.deepEqual(h.engine.ungroupedSessionIds(), []);
  assert.deepEqual(h.engine.hostGroupingState().ordinaryIds, ['a']);
  const state = groupingRepairStatus(h.engine);
  assert.equal(state.enabled, true);
  assert.equal(state.count, 0);
  assert.equal(state.issueKey, null);
  assert.equal(state.refreshOnly, false);
  // A failed startup outcome and a send guard must not hide local diagnosis or
  // silently close the editor to repair it.
  h.engine.lastOutcome = { error: 'queued-data-repair' };
  h.engine.sendGuard = {};
  assert.equal(groupingRepairStatus(h.engine).count, 0);
  assert.equal(h.engine.maybeScheduleRepairRestart({ restartRequired: true }), false);
  assert.equal(h.scheduled(), 0);
});

test('refresh diagnosis parses a session directory, excluding archived and blank sessions', t => {
  const h = fixture(t),
    file = path.join(h.engine.home, 'session', 'session.v4.jsonl.zstd');
  h.engine.scanSessions = () => [{ id: 'a', file }];
  h.engine.sessionCwdOf = dir => {
    assert.equal(dir, path.dirname(file));
    return h.engine.home;
  };
  assert.equal(groupingRepairStatus(h.engine).refreshOnly, true);
  h.registry.archivedSessionIds = ['a'];
  assert.equal(groupingRepairStatus(h.engine).count, 0);
  h.registry.archivedSessionIds = [];
  h.engine.sessionHasTurn = () => false;
  assert.equal(groupingRepairStatus(h.engine).count, 0);
});

test('active-session deferral survives later sync outcomes and retries when idle', t => {
  const h = fixture(t);
  h.engine.sessionActivity = () => ({ available: true, activeCount: 1 });
  assert.equal(h.engine.maybeScheduleRepairRestart({ restartRequired: true }), false);
  h.engine.sessionActivity = () => ({ available: true, activeCount: 0 });
  assert.equal(h.engine.maybeScheduleRepairRestart({}), true);
  assert.equal(h.engine.maybeScheduleRepairRestart({ restartRequired: true }), false);
  assert.equal(h.scheduled(), 1);
});

test('cooldown prevents a repeating issue but permits a different grouping change within 12 hours', t => {
  const h = fixture(t);
  assert.equal(h.engine.maybeScheduleRepairRestart({ restartRequired: true }), true);
  h.engine._repairRestartScheduled = false;
  h.record.tables.workspaces.ws.updatedAt = new Date().toISOString();
  h.write();
  assert.equal(h.engine.maybeScheduleRepairRestart({ restartRequired: true }), false);
  h.record.tables.workspaces.ws.sessionIds.push('b');
  h.write();
  assert.equal(h.engine.maybeScheduleRepairRestart({ restartRequired: true }), true);
  assert.equal(h.scheduled(), 2);
});

test('monitor requires a stable local mismatch, never syncs, and respects offline/busy/disabled state', t => {
  const h = fixture(t);
  let tick,
    stopped = false,
    ready = false,
    notifications = 0;
  const stop = watchGrouping({
    engine: h.engine,
    ready: () => ready,
    onScheduled: () => notifications++,
    clock: {
      setInterval(fn, ms) {
        assert.equal(ms, 15000);
        tick = fn;
        return 7;
      },
      clearInterval(id) {
        assert.equal(id, 7);
        stopped = true;
      },
    },
  });
  h.engine.syncOnce = () => assert.fail('monitor must never sync');
  tick();
  tick();
  assert.equal(h.scheduled(), 0);
  ready = true;
  h.engine.inFlight = {};
  tick();
  tick();
  assert.equal(h.scheduled(), 0);
  h.engine.inFlight = null;
  tick();
  assert.equal(h.scheduled(), 0);
  tick();
  assert.equal(h.scheduled(), 1);
  assert.equal(notifications, 1);
  stop();
  assert.equal(stopped, true);
});

test('Windows failures retain readable Chinese from GBK, UTF-8, and UTF-16', () => {
  assert.equal(windowsOutput(Buffer.from('b4edcef33a20c8cecef120584d4c', 'hex')), '错误: 任务 XML');
  assert.equal(windowsOutput(Buffer.from('错误：XML 格式错误')), '错误：XML 格式错误');
  assert.equal(windowsOutput(Buffer.from('\uFEFF错误', 'utf16le')), '错误');
});

test('unknown activity, disabled automation, failed sync and unsupported projections cannot restart', t => {
  const h = fixture(t);
  h.engine.sessionActivity = () => ({ available: false, activeCount: 0 });
  assert.equal(h.engine.maybeScheduleRepairRestart({ restartRequired: true }), false);
  h.engine.sessionActivity = () => ({ available: true, activeCount: 0 });
  h.engine.overrides.autoRestartAfterRepair = false;
  assert.equal(h.engine.maybeScheduleRepairRestart({ restartRequired: true }), false);
  h.engine.overrides.autoRestartAfterRepair = true;
  for (const flag of ['error', 'cancelled', 'deferred', 'needsReview', 'downloadPending'])
    assert.equal(h.engine.maybeScheduleRepairRestart({ restartRequired: true, [flag]: true }), false);
  h.registry.list = () => [{ sessionIds: null }];
  assert.equal(h.engine.hostGroupingState().available, false);
  assert.equal(h.scheduled(), 0);
});

test('deleting a workspace never reconstructs it; archived accounting survives every sync hook', t => {
  const h = fixture(t);
  h.record.global.archivedSessionIds = ['a'];
  h.write();
  const original = fs.readFileSync(path.join(h.engine.home, 'storages/workspace.json'));
  h.engine.repairWorkspaceRegistry();
  assert.deepEqual(fs.readFileSync(path.join(h.engine.home, 'storages/workspace.json')), original);
  h.record.global.workspaceIds = [];
  h.record.tables.workspaces = {};
  h.write();
  h.registry.list = () => [];
  h.registry.archivedSessionIds = [];
  for (let i = 0; i < 3; i++) h.engine.repairWorkspaceRegistry();
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(h.engine.home, 'storages/workspace.json'))).tables.workspaces,
    {},
  );
  assert.equal(groupingRepairStatus(h.engine).count, 0);
  assert.equal(groupingRepairStatus(h.engine).ordinaryCount, 1);
  assert.equal(h.scheduled(), 0);
});

test('sync provenance detects lost membership only while the original workspace remains unchanged', t => {
  const h = fixture(t),
    before = Buffer.from(JSON.stringify(h.record));
  h.record.tables.workspaces.ws.sessionIds = [];
  h.write();
  recordGroupingTransition(h.engine, before, Buffer.from(JSON.stringify(h.record)));
  assert.equal(groupingRepairStatus(h.engine).count, 1);
  assert.equal(groupingRepairStatus(h.engine).refreshOnly, false);
  // A subsequent user change invalidates the old sync evidence.
  h.record.tables.workspaces.ws.updatedAt = 'user-change';
  h.write();
  assert.equal(groupingRepairStatus(h.engine).count, 0);
  const after = Buffer.from(JSON.stringify(h.record));
  h.record.global.workspaceIds = [];
  h.record.tables.workspaces = {};
  h.write();
  recordGroupingTransition(h.engine, after, Buffer.from(JSON.stringify(h.record)));
  assert.equal(groupingRepairStatus(h.engine).count, 0);
});

test('three-way merge respects workspace deletion, member removal and unarchive', async t => {
  const h = fixture(t),
    base = structuredClone(h.record),
    local = structuredClone(base),
    remote = structuredClone(base);
  base.global.archivedSessionIds = ['a'];
  remote.global.archivedSessionIds = ['a'];
  local.global.workspaceIds = [];
  local.tables.workspaces = {};
  local.global.archivedSessionIds = [];
  const inputs = {
    ':1:storages/workspace.json': base,
    ':2:storages/workspace.json': local,
    ':3:storages/workspace.json': remote,
  };
  h.engine.git = async args => ({ code: 0, out: JSON.stringify(inputs[args[1]]) });
  h.engine.localSessionIds = () => new Set(['a', 'b', 'c']);
  h.engine.remoteSessionIds = async () => new Set();
  assert.equal(await h.engine.unionMergeWorkspaceJson(), true);
  let merged = JSON.parse(fs.readFileSync(path.join(h.engine.home, 'storages/workspace.json')));
  assert.deepEqual(merged.global.workspaceIds, []);
  assert.deepEqual(merged.tables.workspaces, {});
  assert.deepEqual(merged.global.archivedSessionIds, []);
  inputs[':2:storages/workspace.json'] = structuredClone(base);
  inputs[':2:storages/workspace.json'].tables.workspaces.ws.sessionIds = ['b'];
  inputs[':3:storages/workspace.json'].tables.workspaces.ws.sessionIds = ['a', 'c'];
  assert.equal(await h.engine.unionMergeWorkspaceJson(), true);
  merged = JSON.parse(fs.readFileSync(path.join(h.engine.home, 'storages/workspace.json')));
  assert.deepEqual(merged.tables.workspaces.ws.sessionIds, ['b', 'c']);
});
