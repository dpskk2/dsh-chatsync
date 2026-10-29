import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { scopeMirrorPath } from '../lib/scope.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';
import { removeFixture } from './helpers/fixture-cleanup.mjs';
import { retainWorkspaceMembership } from '../lib/workspace-registry.js';

test('fast-forward registry downloads preserve membership but respect archive, project deletion and removal receipts', () => {
  const row = { path: 'C:/Users/local/project', sessionIds: ['a'] };
  const data = (rows, archived = []) =>
    Buffer.from(
      JSON.stringify({
        global: { workspaceIds: Object.keys(rows), archivedSessionIds: archived },
        tables: { workspaces: rows },
      }),
    );
  const engine = {
    loadConfig: () => ({}),
    localWorkspacePathOverride: () => null,
    workspacePathOf: () => 'C:/local/project',
  };
  const before = data({ local: row });
  const after = data({ remote: { ...row, path: 'C:/Users/remote/project', sessionIds: [] } });
  const result = retainWorkspaceMembership(engine, before, after, new Set(['a']));
  assert.deepEqual(JSON.parse(result).tables.workspaces.remote.sessionIds, ['a']);
  assert.deepEqual(
    JSON.parse(retainWorkspaceMembership(engine, before, data({}), new Set(['a']))).tables.workspaces,
    {},
  );
  assert.deepEqual(
    JSON.parse(
      retainWorkspaceMembership(engine, before, data({ local: { ...row, sessionIds: [] } }, ['a']), new Set(['a'])),
    ).tables.workspaces.local.sessionIds,
    [],
  );
  assert.deepEqual(
    JSON.parse(retainWorkspaceMembership(engine, before, after, new Set(['a']), new Set(['a']))).tables.workspaces
      .remote.sessionIds,
    [],
  );
});

test(
  'a new computer downloads the current snapshot without old Git blobs and can continue syncing',
  { timeout: 120000 },
  async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-current-'));
    t.after(() => removeFixture(root));
    const remote = path.join(root, 'remote.git');
    execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
    const make = name => {
      const home = path.join(root, name);
      fs.mkdirSync(home);
      const engine = acceptFixturePreviews(
        attachFixturePersistence(new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false })),
      );
      engine.verifyPrivateRemote = async () => ({ ok: true });
      return engine;
    };
    const a = make('a'),
      b = make('b');
    const sid = 'session-11111111-1111-1111-1111-111111111111';
    const log = 'sessions/group/' + sid + '/session.v4.jsonl';
    fs.mkdirSync(path.dirname(path.join(a.home, log)), { recursive: true });
    const originalLog =
      JSON.stringify({ type: 'session', version: 4, id: sid, cwd: root }) +
      '\n' +
      JSON.stringify({ type: 'turn/start', seq: 0 }) +
      '\n';
    fs.writeFileSync(path.join(a.home, log), originalLog);
    fs.mkdirSync(path.join(a.home, 'attachments'));
    fs.writeFileSync(path.join(a.home, 'attachments/note.txt'), 'historical-only payload');
    assert.equal((await a.syncOnce('test', { forceCommit: true })).error, undefined);
    const oldBlob = execFileSync('git', ['--git-dir', remote, 'rev-parse', 'main:attachments/note.txt'], {
      encoding: 'utf8',
    }).trim();
    fs.writeFileSync(path.join(a.home, 'attachments/note.txt'), 'current payload');
    assert.equal((await a.syncOnce('test', { forceCommit: true })).error, undefined);
    assert.equal((await b.syncOnce('test', { forceCommit: true })).error, undefined);
    const mirror = scopeMirrorPath(b.home, b.loadConfig());
    assert.equal(
      execFileSync('git', ['-C', mirror, 'rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim(),
      'true',
    );
    assert.notEqual(spawnSync('git', ['-C', mirror, 'cat-file', '-e', oldBlob], { stdio: 'ignore' }).status, 0);
    assert.equal(fs.readFileSync(path.join(b.home, 'attachments/note.txt'), 'utf8'), 'current payload');
    assert.ok(
      !b.recovery.list().some(record => record.kind === 'scope-backup'),
      'new files do not duplicate their full content in recovery',
    );
    const appended = originalLog + JSON.stringify({ type: 'turn/end', seq: 1 }) + '\n';
    fs.writeFileSync(path.join(a.home, log), appended);
    assert.equal((await a.syncOnce('test', { forceCommit: true })).error, undefined);
    assert.equal((await b.syncOnce('test', { forceCommit: true })).error, undefined);
    assert.equal(fs.readFileSync(path.join(b.home, log), 'utf8'), appended);
    assert.ok(
      !b.recovery.list().some(record => record.path === log),
      'successful append retains its prefix without full recovery copies',
    );
    fs.writeFileSync(path.join(b.home, 'attachments/from-b.txt'), 'from b');
    fs.writeFileSync(path.join(b.home, 'attachments/note.txt'), 'replaced payload');
    assert.equal((await b.syncOnce('test', { forceCommit: true })).error, undefined);
    assert.equal((await a.syncOnce('test', { forceCommit: true })).error, undefined);
    assert.equal(fs.readFileSync(path.join(a.home, 'attachments/from-b.txt'), 'utf8'), 'from b');
    const backup = a.recovery
      .list()
      .find(record => record.kind === 'scope-backup' && record.path === 'attachments/note.txt');
    assert.ok(backup, 'overwriting an existing user file still retains its original');
    assert.equal(a.recovery.version(backup, 'local').toString(), 'current payload');
  },
);

test('export prunes unknown directories and runtimes before trying to enumerate them', { timeout: 60000 }, async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-prune-'));
  t.after(() => removeFixture(home));
  const engine = acceptFixturePreviews(
    attachFixturePersistence(new SyncEngine(home, { autoRepo: false, workspaceSync: false })),
  );
  const blocked = ['electron', 'dsh-runtimes', 'llm-deepseek', 'unknown-plugin-data'];
  for (const name of blocked) fs.mkdirSync(path.join(home, name));
  const readdir = fs.readdirSync;
  fs.readdirSync = function (folder, ...args) {
    assert.ok(!blocked.includes(path.relative(home, String(folder))), 'must not enter ' + folder);
    return readdir.call(this, folder, ...args);
  };
  try {
    const result = await engine.syncOnce('test', { forceCommit: true });
    assert.equal(result.error, undefined, JSON.stringify(result));
  } finally {
    fs.readdirSync = readdir;
  }
});
