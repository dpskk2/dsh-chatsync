import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence, fixtureCatalog } from './helpers/session-persistence.mjs';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

// DSH has no "delete conversation" action. A session or a batch of files that is
// simply gone from one computer (cleared folder, failed disk, external tool) must
// never be pushed to every other computer as a deletion.
const id = 'session-22222222-2222-4222-8222-222222222222';
const sessionFile = 'sessions/project/' + id + '/session.v4.jsonl';
const sessionLog =
  [
    { type: 'session', version: 4, id, cwd: 'C:/project' },
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'turn/end', seq: 1, time: 2, data: { turn: 1 } },
  ]
    .map(JSON.stringify)
    .join('\n') + '\n';
const registry = JSON.stringify({
  global: { initialized: true, workspaceIds: ['w'], archivedSessionIds: [] },
  tables: { workspaces: { w: { path: 'C:/project', title: 'project', sessionIds: [id] } } },
});

function devices(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-missing-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
  // `reviewed` engines accept every preview, as an approving user would; the
  // others return the preview so a test can choose an answer itself.
  const make = (name, { reviewed = true } = {}) => {
    const home = path.join(root, name);
    fs.mkdirSync(home);
    const engine = attachFixturePersistence(new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false }));
    engine.verifyPrivateRemote = async () => ({ ok: true });
    engine.loadTransferCatalog = async () => fixtureCatalog;
    return reviewed ? acceptFixturePreviews(engine) : engine;
  };
  const put = (engine, file, value) => {
    fs.mkdirSync(path.dirname(path.join(engine.home, file)), { recursive: true });
    fs.writeFileSync(path.join(engine.home, file), value);
  };
  const has = (engine, file) => fs.existsSync(path.join(engine.home, file));
  const remoteFiles = () =>
    new Set(
      execFileSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean),
    );
  const sync = async (engine, opts = {}) => engine.syncOnce('test', { forceCommit: true, ...opts });
  return { make, put, has, remoteFiles, sync };
}

test(
  'a session missing on one computer stays in the shared copy and is restored there',
  { timeout: 120000 },
  async t => {
    const { make, put, has, remoteFiles, sync } = devices(t);
    const a = make('a'),
      b = make('b');
    put(a, sessionFile, sessionLog);
    put(a, 'storages/workspace.json', registry);
    assert.equal((await sync(a)).error, undefined);
    assert.ok(remoteFiles().has(sessionFile));

    // The log and the registry entry vanish on A, as after a cleared folder.
    fs.rmSync(path.join(a.home, 'sessions'), { recursive: true, force: true });
    fs.rmSync(path.join(a.home, 'storages/workspace.json'));
    const result = await sync(a);
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.ok(remoteFiles().has(sessionFile), 'absence is never uploaded as a deletion');
    assert.ok(remoteFiles().has('storages/workspace.json'), 'a missing registry is never uploaded as a deletion');
    assert.ok(has(a, sessionFile), 'the shared copy restores the session on the computer that lost it');

    assert.equal((await sync(b)).error, undefined);
    assert.ok(has(b, sessionFile), 'another computer still receives the session');
  },
);

test('an explicit removal receipt still removes the session from the shared copy', { timeout: 120000 }, async t => {
  const { make, put, has, remoteFiles, sync } = devices(t);
  const a = make('a');
  put(a, sessionFile, sessionLog);
  assert.equal((await sync(a)).error, undefined);
  assert.ok(remoteFiles().has(sessionFile));
  fs.rmSync(path.join(a.home, 'sessions'), { recursive: true, force: true });
  put(a, '.chatsync-local/session-removals.json', JSON.stringify([{ sessionId: id }]));
  assert.equal((await sync(a)).error, undefined);
  assert.equal(remoteFiles().has(sessionFile), false);
  assert.equal(has(a, sessionFile), false, 'a removed session is not restored');
});

test(
  'a bulk loss of attachments pauses for a choice: restore brings them back, confirm deletes them',
  { timeout: 180000 },
  async t => {
    const { make, put, has, remoteFiles, sync } = devices(t);
    const a = make('a', { reviewed: false });
    const files = Array.from({ length: 12 }, (_, i) => `attachments/shared/file-${i}.txt`);
    for (const file of files) put(a, file, 'attachment ' + file);
    let result = await sync(a);
    for (let round = 0; round < 5 && result.needsReview; round++)
      result = await sync(a, { approval: result.review.id });
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.ok(files.every(file => remoteFiles().has(file)));

    fs.rmSync(path.join(a.home, 'attachments'), { recursive: true, force: true });
    result = await sync(a);
    assert.equal(result.needsReview, true, JSON.stringify(result));
    assert.equal(result.review.counts.deleted, files.length);
    const restore = result.review.alternatives?.find(choice => choice.action === 'restore');
    assert.ok(restore, 'the preview offers to restore instead of deleting');
    assert.ok(
      files.every(file => remoteFiles().has(file)),
      'nothing is deleted before a choice',
    );

    result = await sync(a, { approval: restore.id });
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.ok(
      files.every(file => has(a, file)),
      'restore brings the files back',
    );
    assert.ok(files.every(file => remoteFiles().has(file)));

    fs.rmSync(path.join(a.home, 'attachments'), { recursive: true, force: true });
    result = await sync(a);
    assert.equal(result.needsReview, true);
    result = await sync(a, { approval: result.review.id });
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.ok(
      files.every(file => !remoteFiles().has(file)),
      'a confirmed deletion reaches the shared copy',
    );
    assert.ok(files.every(file => !has(a, file)));
  },
);

test('a single removed attachment syncs as an ordinary deletion without asking', { timeout: 120000 }, async t => {
  const { make, put, remoteFiles, sync } = devices(t);
  const a = make('a');
  put(a, 'attachments/shared/keep.txt', 'keep');
  put(a, 'attachments/shared/drop.txt', 'drop');
  put(a, 'attachments/shared/also-keep.txt', 'also keep');
  assert.equal((await sync(a)).error, undefined);
  fs.rmSync(path.join(a.home, 'attachments/shared/drop.txt'));
  const result = await a.syncOnce('test', { forceCommit: true });
  assert.equal(result.needsReview, undefined, JSON.stringify(result));
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.equal(remoteFiles().has('attachments/shared/drop.txt'), false);
  assert.ok(remoteFiles().has('attachments/shared/keep.txt'));
});
