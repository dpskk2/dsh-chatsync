import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { mapWorkspacePath } from '../lib/workspace-path.js';
import { localDirectory, retainWorkspaceMembership } from '../lib/workspace-registry.js';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

const pathApi = process.platform === 'win32' ? path.win32 : path.posix;
const userHome = user => (process.platform === 'win32' ? `C:\\Users\\${user}` : `/home/${user}`);
const under = (user, ...rest) => pathApi.join(userHome(user), ...rest);
const defaultOf = user => under(user, 'Documents', 'deepseek-harness', 'default-workspace');
const session = letter =>
  `session-${letter.repeat(8)}-${letter.repeat(4)}-${letter.repeat(4)}-${letter.repeat(4)}-${letter.repeat(12)}`;

const log = (id, cwd) =>
  [
    { type: 'session', version: 4, id, createdAt: 1700000000000, cwd, isSeeded: false, delegationDepth: 0 },
    {
      seq: 0,
      time: 1700000000001,
      type: 'session/title',
      data: { title: 'fixture', messageSeqs: [], source: { kind: 'user' } },
    },
  ]
    .map(row => JSON.stringify(row))
    .join('\n') + '\n';
const row = (projectPath, sessionIds) => ({
  path: projectPath,
  title: pathApi.basename(projectPath),
  sessionIds,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const registry = rows => ({
  global: { initialized: true, workspaceIds: Object.keys(rows), archivedSessionIds: [], pinnedSessionIds: [] },
  tables: { workspaces: rows },
});

// Two computers on one test filesystem: each decides paths by its own home and folders.
function computers(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-issue21-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
  const make = (name, user, folders) => {
    const home = path.join(root, name);
    fs.mkdirSync(home);
    const engine = acceptFixturePreviews(
      attachFixturePersistence(
        new SyncEngine(home, {
          remote,
          autoRepo: false,
          workspaceSync: false,
          patches: false,
          autoRestartAfterRepair: false,
        }),
      ),
    );
    const here = new Set(folders);
    engine.verifyPrivateRemote = async () => ({ ok: true });
    engine.workspacePathOf = recorded =>
      mapWorkspacePath(recorded, { home: userHome(user), exists: folder => here.has(folder) });
    engine.localDirectory = folder => (here.has(folder) ? folder : null);
    engine.folders = here;
    return engine;
  };
  const git = (...args) => execFileSync('git', ['--git-dir=' + remote, ...args], { encoding: 'utf8' });
  return {
    make,
    shared: () => JSON.parse(git('show', 'main:storages/workspace.json')),
    commits: () => Number(git('rev-list', '--count', 'main').trim()),
  };
}
const put = (engine, id, cwd) => {
  const rel = `sessions/default-workspace/${id}/session.v4.jsonl`;
  fs.mkdirSync(path.dirname(path.join(engine.home, rel)), { recursive: true });
  fs.writeFileSync(path.join(engine.home, rel), log(id, cwd));
};
const registryFile = engine => path.join(engine.home, 'storages', 'workspace.json');
const writeRegistry = (engine, data) => {
  fs.mkdirSync(path.dirname(registryFile(engine)), { recursive: true });
  fs.writeFileSync(registryFile(engine), JSON.stringify(data, null, 2));
};
const readRegistry = engine => JSON.parse(fs.readFileSync(registryFile(engine), 'utf8'));
const sync = async (engine, opts = {}) => {
  const result = await engine.syncOnce('issue21', { forceCommit: true, ...opts });
  assert.equal(result.error, undefined, JSON.stringify(result));
  return result;
};

// The membership rule of @deepseek-ai/dsh-workspace (WorkspaceEntity.sessionIds): a
// project shows a session whose cwd is its path, or whose cwd does not exist here.
// Anything else lands in the sidebar's ungrouped bucket.
function projectsShown(engine) {
  const data = readRegistry(engine);
  const shown = {};
  for (const projectId of data.global.workspaceIds) {
    const project = data.tables.workspaces[projectId];
    for (const id of project.sessionIds) {
      const local = engine.scanSessions().find(item => item.id === id);
      if (!local) continue;
      const cwd = engine.sessionCwdOf(path.dirname(local.file), local.group);
      if (!engine.folders.has(cwd) || cwd === project.path) shown[id] = project.path;
    }
  }
  return shown;
}
// What the host's validateStoredState refuses to start with.
function assertHostCanLoad(data) {
  const rows = Object.entries(data.tables.workspaces);
  assert.deepEqual([...data.global.workspaceIds].sort(), rows.map(([id]) => id).sort());
  const paths = rows.map(([, item]) => item.path),
    owned = rows.flatMap(([, item]) => item.sessionIds);
  assert.equal(new Set(paths).size, paths.length, 'two projects claim one path');
  assert.equal(new Set(owned).size, owned.length, 'a session is in two projects');
}

test('connecting a second computer keeps every project grouped on both', { timeout: 240000 }, async t => {
  const { make, shared, commits } = computers(t);
  const foo = under('alice', 'work', 'foo');
  const a = make('a', 'alice', [defaultOf('alice'), foo]),
    b = make('b', 'bob', [defaultOf('bob')]);
  const inDefault = session('a'),
    inFoo = session('b'),
    onB = session('c');
  put(a, inDefault, defaultOf('alice'));
  put(a, inFoo, foo);
  writeRegistry(a, registry({ 'ws-a': row(defaultOf('alice'), [inDefault]), 'ws-foo': row(foo, [inFoo]) }));
  await sync(a);

  // B already has DSH's own default project with a conversation, as a real install does.
  put(b, onB, defaultOf('bob'));
  writeRegistry(b, registry({ 'ws-b': row(defaultOf('bob'), [onB]) }));
  await sync(b);
  assert.ok(shared().tables.workspaces['ws-foo'], 'the first project of A stays in the shared registry');
  assert.deepEqual(projectsShown(b), { [inDefault]: defaultOf('bob'), [inFoo]: foo, [onB]: defaultOf('bob') });
  assertHostCanLoad(readRegistry(b));

  // A is not disturbed: its own folders still hold its sessions and it sees B's too.
  await sync(a);
  assert.deepEqual(projectsShown(a), { [inDefault]: defaultOf('alice'), [inFoo]: foo, [onB]: defaultOf('alice') });
  assertHostCanLoad(readRegistry(a));

  // Each computer keeps its own paths without re-uploading them or asking to restart.
  await sync(b);
  const settledAt = commits();
  for (const engine of [a, b, a, b]) {
    const again = await sync(engine);
    assert.notEqual(again.restartRequired, true, 'nothing changed, so nothing needs a restart');
  }
  assert.equal(commits(), settledAt, 'differing local paths are not uploaded back and forth');

  // Leaving is not a pending download just because this computer's paths differ.
  const leaving = await sync(b, { uploadOnly: true });
  assert.notEqual(leaving.downloadPending, true);
});

test('a project deleted after connecting stays deleted on every computer', { timeout: 180000 }, async t => {
  const { make, shared } = computers(t);
  const foo = under('alice', 'work', 'foo');
  const a = make('a', 'alice', [defaultOf('alice'), foo]),
    b = make('b', 'bob', [defaultOf('bob')]);
  const inDefault = session('a');
  put(a, inDefault, defaultOf('alice'));
  writeRegistry(a, registry({ 'ws-a': row(defaultOf('alice'), [inDefault]), 'ws-foo': row(foo, []) }));
  await sync(a);
  writeRegistry(b, registry({ 'ws-b': row(defaultOf('bob'), []) }));
  await sync(b);
  assert.ok(readRegistry(b).tables.workspaces['ws-foo'], 'B took in the project on connecting');
  await sync(a);

  const local = readRegistry(b);
  delete local.tables.workspaces['ws-foo'];
  local.global.workspaceIds = local.global.workspaceIds.filter(id => id !== 'ws-foo');
  writeRegistry(b, local);
  await sync(b);
  assert.equal(shared().tables.workspaces['ws-foo'], undefined);
  await sync(a);
  assert.equal(readRegistry(a).tables.workspaces['ws-foo'], undefined);
});

function settleFixture(user, folders) {
  return {
    loadConfig: () => ({}),
    localWorkspacePathOverride: () => null,
    workspacePathOf: recorded =>
      mapWorkspacePath(recorded, { home: userHome(user), exists: folder => folders.includes(folder) }),
    localDirectory: folder => (folders.includes(folder) ? folder : null),
  };
}
const bytes = data => Buffer.from(JSON.stringify(data));
const settle = (engine, before, after) =>
  JSON.parse(retainWorkspaceMembership(engine, before && bytes(before), bytes(after), new Set()).toString());

test('a project uses this computer’s matching folder once it exists, on a first download too', () => {
  const foo = under('bob', 'work', 'foo');
  const after = registry({ 'ws-foo': row(under('alice', 'work', 'foo'), ['s1']) });
  assert.equal(settle(settleFixture('bob', [foo]), null, after).tables.workspaces['ws-foo'].path, foo);
  // Without that folder the recorded path stays: the host shows the session by its missing cwd.
  assert.equal(
    settle(settleFixture('bob', []), null, after).tables.workspaces['ws-foo'].path,
    after.tables.workspaces['ws-foo'].path,
  );
  // A registry already damaged by an older version returns to this computer's folder.
  const damaged = registry({ 'ws-b': row(defaultOf('bob'), ['s1']) });
  assert.equal(
    settle(settleFixture('alice', [defaultOf('alice')]), damaged, damaged).tables.workspaces['ws-b'].path,
    defaultOf('alice'),
  );
});

test('projects that land on one folder become one project the host can load', () => {
  const engine = settleFixture('carol', [defaultOf('carol')]);
  const result = settle(
    engine,
    registry({ local: row(defaultOf('carol'), ['s1']) }),
    registry({ one: row(defaultOf('alice'), ['s2']), two: row(defaultOf('bob'), ['s3', 's2']) }),
  );
  assert.deepEqual(result.global.workspaceIds, ['one']);
  assert.equal(result.tables.workspaces.one.path, defaultOf('carol'));
  assert.deepEqual(result.tables.workspaces.one.sessionIds.sort(), ['s2', 's3']);
  assertHostCanLoad(result);
});

test('a real directory resolves to its canonical path; anything else does not count', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-issue21-dir-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'file'), '');
  assert.equal(localDirectory(root), fs.realpathSync.native(root));
  assert.equal(localDirectory(path.join(root, 'file')), null);
  assert.equal(localDirectory(path.join(root, 'none')), null);
});
