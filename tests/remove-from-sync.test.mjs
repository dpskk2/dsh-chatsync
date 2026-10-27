import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { removeSessionsFromSync, removedSessionIds, SHARED_REMOVALS } from '../lib/session-removals.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

// Removing a session from sync is an explicit, shared decision: every computer
// stops uploading it, the shared copy drops its files and registration, and a
// computer that still holds a local copy neither re-uploads it nor warns forever.
const keep = 'session-33333333-3333-4333-8333-333333333333';
const drop = 'session-44444444-4444-4444-8444-444444444444';
const other = 'session-55555555-5555-4555-8555-555555555555';
const logOf = id => 'sessions/project/' + id + '/session.v4.jsonl';
const cacheOf = id => 'storages/session_projcache/sessions/' + id + '.json';
const log = id =>
  [
    { type: 'session', version: 4, id, cwd: 'C:/project' },
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'turn/end', seq: 1, time: 2, data: { turn: 1 } },
  ]
    .map(JSON.stringify)
    .join('\n') + '\n';
const registry = ids =>
  JSON.stringify({
    global: { initialized: true, workspaceIds: ['w'], archivedSessionIds: [] },
    tables: { workspaces: { w: { path: 'C:/project', title: 'project', sessionIds: ids } } },
  });

function devices(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-remove-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
  const make = name => {
    const home = path.join(root, name);
    fs.mkdirSync(home);
    const engine = new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false });
    engine.verifyPrivateRemote = async () => ({ ok: true });
    return acceptFixturePreviews(attachFixturePersistence(engine));
  };
  const put = (engine, file, value) => {
    fs.mkdirSync(path.dirname(path.join(engine.home, file)), { recursive: true });
    fs.writeFileSync(path.join(engine.home, file), value);
  };
  const remoteFiles = () =>
    new Set(
      execFileSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean),
    );
  const remoteJson = file =>
    JSON.parse(execFileSync('git', ['--git-dir', remote, 'show', 'main:' + file], { encoding: 'utf8' }));
  const sync = async engine => {
    const result = await engine.syncOnce('test', { forceCommit: true });
    assert.equal(result.error, undefined, JSON.stringify(result));
    return result;
  };
  return { make, put, remoteFiles, remoteJson, sync };
}

test(
  'a session removed from sync leaves the shared copy and every computer stops syncing it',
  { timeout: 180000 },
  async t => {
    const { make, put, remoteFiles, remoteJson, sync } = devices(t);
    const a = make('a'),
      b = make('b');
    for (const id of [keep, drop]) {
      put(a, logOf(id), log(id));
      put(a, cacheOf(id), JSON.stringify({ record: { rows: { title: { val: id } } } }));
    }
    put(a, 'storages/workspace.json', registry([keep, drop]));
    await sync(a);
    await sync(b);
    assert.ok(fs.existsSync(path.join(b.home, logOf(drop))));

    assert.deepEqual(removeSessionsFromSync(a, [drop]), { removed: [drop] });
    assert.ok(removedSessionIds(a).has(drop));
    await sync(a);
    let files = remoteFiles();
    assert.equal(files.has(logOf(drop)), false, 'the log leaves the shared copy');
    assert.equal(files.has(cacheOf(drop)), false, 'derived session files leave too');
    assert.ok(files.has(logOf(keep)));
    assert.deepEqual(remoteJson('storages/workspace.json').tables.workspaces.w.sessionIds, [keep]);
    assert.deepEqual(
      remoteJson(SHARED_REMOVALS).map(row => row.sessionId),
      [drop],
    );

    // B still holds a local copy; it learns the shared decision and stays quiet.
    const first = await sync(b);
    assert.equal(first.scopeWarnings, undefined, JSON.stringify(first.scopeWarnings));
    assert.ok(removedSessionIds(b).has(drop));
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(b.home, 'storages/workspace.json'), 'utf8')).tables.workspaces.w.sessionIds,
      [keep],
    );
    await sync(b);
    files = remoteFiles();
    assert.equal(files.has(logOf(drop)), false, 'a computer with a local copy never uploads it again');
  },
);

test('removals made on two computers before they meet are both kept', { timeout: 180000 }, async t => {
  const { make, put, remoteJson, sync } = devices(t);
  const a = make('a'),
    b = make('b');
  for (const id of [keep, drop, other]) put(a, logOf(id), log(id));
  await sync(a);
  await sync(b);
  removeSessionsFromSync(a, [drop]);
  removeSessionsFromSync(b, [other]);
  await sync(a);
  await sync(b);
  await sync(a);
  assert.deepEqual(
    remoteJson(SHARED_REMOVALS)
      .map(row => row.sessionId)
      .sort(),
    [drop, other].sort(),
  );
  assert.ok(removedSessionIds(a).has(other) && removedSessionIds(b).has(drop));
});

test('removing rejects malformed ids and is idempotent', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-remove-ids-'));
  t.after(() => removeFixture(home));
  const engine = new SyncEngine(home);
  assert.throws(() => removeSessionsFromSync(engine, ['../escape']), /会话标识无效/);
  assert.throws(() => removeSessionsFromSync(engine, []), /请选择/);
  assert.deepEqual(removeSessionsFromSync(engine, [drop]), { removed: [drop] });
  assert.deepEqual(removeSessionsFromSync(engine, [drop]), { removed: [] });
  assert.deepEqual([...removedSessionIds(engine)], [drop]);
});
