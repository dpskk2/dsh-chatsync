import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { SyncEngine } from '../lib/sync.js';
import { previewHistoryRebuild, applyHistoryRebuild } from '../lib/history-rebuild.js';
import { scanLocalStorage } from '../lib/local-storage.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

// Clearing the history keeps exactly the current content, leaves old history on
// the remote, waits for every computer to upgrade, and another computer
// follows the rebuilt history instead of pushing the old one back.
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-history-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
  const make = (name, version) => {
    const home = path.join(root, name);
    fs.mkdirSync(home);
    const engine = new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false });
    engine.verifyPrivateRemote = async () => ({ ok: true });
    engine.pluginVersion = () => version;
    return acceptFixturePreviews(attachFixturePersistence(engine));
  };
  const git = (...args) => execFileSync('git', ['--git-dir', remote, ...args], { encoding: 'utf8' }).trim();
  const put = (engine, file, value) => {
    fs.mkdirSync(path.dirname(path.join(engine.home, file)), { recursive: true });
    fs.writeFileSync(path.join(engine.home, file), value);
  };
  const sync = async engine => {
    const result = await engine.syncOnce('test', { forceCommit: true });
    assert.equal(result.error, undefined, JSON.stringify(result));
    return result;
  };
  return { make, git, put, sync };
}

test(
  'clearing history keeps the current content and leaves the old history only on the remote',
  { timeout: 240000 },
  async t => {
    const { make, git, put, sync } = setup(t);
    const a = make('a', '0.21.0'),
      b = make('b', '0.20.3');
    put(a, 'attachments/note.txt', 'first\n');
    const oldBytes = randomBytes(1024 * 1024);
    put(a, 'attachments/large.bin', oldBytes);
    await sync(a);
    put(a, 'attachments/note.txt', 'second\n');
    put(a, 'attachments/large.bin', 'current small content\n');
    put(a, 'attachments/old.txt', 'gone soon\n');
    await sync(a);
    fs.rmSync(path.join(a.home, 'attachments/old.txt'));
    await sync(a);
    await sync(b);
    git('branch', 'backup/2026-old', 'main');
    const oldTip = git('rev-parse', 'main');
    const tree = git('rev-parse', 'main^{tree}');
    // Earlier releases kept pushed backup branches locally, pinning the pack.
    await a.git(['branch', 'backup/2026-old', oldTip]);
    await a.git(['gc', '--quiet']);
    const sizeBefore = a._transport.repoSizeBytes();

    const preview = await previewHistoryRebuild(a);
    assert.ok(preview.commits >= 3);
    assert.deepEqual(preview.backupBranches, ['backup/2026-old']);
    assert.equal(preview.blockers.length, 1, 'the computer on an older version is listed');
    await assert.rejects(applyHistoryRebuild(a, { previewId: preview.previewId }), /不是 0\.21\.0 或更新版本/);
    await assert.rejects(
      applyHistoryRebuild(a, { previewId: 'stale', retiredDevices: [preview.blockers[0].deviceId] }),
      /重新检查/,
    );
    assert.equal(git('rev-parse', 'main'), oldTip, 'nothing changes before confirmation');

    b.pluginVersion = () => '0.21.0';
    await sync(b);
    await sync(a);
    const invoke = a.git.bind(a),
      networkCalls = [];
    a.git = async (...args) => {
      if (args[0].includes('fetch') || args[0].includes('ls-remote')) networkCalls.push(args[0]);
      return invoke(...args);
    };
    const ready = await previewHistoryRebuild(a);
    assert.deepEqual(ready.blockers, []);
    assert.equal(networkCalls.length, 1, 'cached receipts and the branch advertisement need only one network call');
    assert.ok(networkCalls[0].includes('ls-remote'));
    const done = await applyHistoryRebuild(a, { previewId: ready.previewId, deleteBackupBranches: true });
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.equal(git('rev-list', '--count', 'main'), '1', 'only the current content remains');
    assert.equal(git('rev-parse', 'main^{tree}'), tree, 'the current content is unchanged');
    assert.deepEqual(done.deletedBranches, ['backup/2026-old']);
    assert.equal(git('for-each-ref', 'refs/heads/backup/'), '');

    assert.match(done.backup, /^archive\/sync-history\//);
    assert.equal(git('rev-parse', done.backup), oldTip, 'the archive branch holds the old history on the remote');
    assert.equal(a.ok(await a.git(['show-ref', '--verify', 'refs/heads/backup/2026-old'])), false);
    assert.ok(a._transport.repoSizeBytes() < sizeBefore / 2, 'clearing history actually releases the old local pack');
    assert.equal(a.ok(await a.git(['cat-file', '-e', oldTip + '^{commit}'])), false, 'the old tip is no longer cached');
    const scan = await scanLocalStorage(a);
    assert.ok(!scan.items.some(item => item.category === 'history'), 'no local history bundle is generated');

    // Both computers keep syncing on the new history; the old one is not pushed back.
    put(b, 'attachments/from-b.txt', 'b\n');
    await sync(b);
    await sync(a);
    assert.throws(() => git('merge-base', '--is-ancestor', oldTip, 'main'), 'the old history stays gone');
    assert.equal(fs.readFileSync(path.join(a.home, 'attachments/from-b.txt'), 'utf8'), 'b\n');
    assert.equal(fs.readFileSync(path.join(b.home, 'attachments/note.txt'), 'utf8'), 'second\n');
  },
);

test('a computer with unsynced changes is asked to sync first', { timeout: 120000 }, async t => {
  const { make, put, sync } = setup(t);
  const a = make('a', '0.21.0'),
    b = make('b', '0.21.0');
  put(a, 'attachments/note.txt', 'one\n');
  await sync(a);
  await sync(b);
  put(b, 'attachments/note.txt', 'two\n');
  await sync(b);
  await assert.rejects(previewHistoryRebuild(a), /先同步一次/);
});

test('a shallow copy can clear remote history without downloading old commits', { timeout: 120000 }, async t => {
  const { make, put, sync, git } = setup(t);
  const a = make('a', '0.21.0'),
    b = make('b', '0.21.0');
  put(a, 'attachments/note.txt', 'one\n');
  await sync(a);
  put(a, 'attachments/note.txt', 'two\n');
  await sync(a);
  await sync(b);
  const tree = git('rev-parse', 'main^{tree}');
  const preview = await previewHistoryRebuild(b);
  assert.equal(preview.shallow, true);
  const invoke = b.git.bind(b);
  b.git = async (...args) => {
    assert.equal(args[0].includes('--unshallow'), false);
    assert.equal(args[0].includes('--deepen'), false);
    return invoke(...args);
  };
  const done = await applyHistoryRebuild(b, { previewId: preview.previewId });
  assert.equal(done.ok, true);
  assert.equal(done.localCleanupError, null);
  assert.equal(git('rev-parse', 'main^{tree}'), tree);
  assert.equal(git('rev-list', '--count', 'main'), '1');
});

test('a backup changed after confirmation is not deleted', { timeout: 120000 }, async t => {
  const { make, put, sync, git } = setup(t);
  const a = make('a', '0.21.0');
  put(a, 'attachments/note.txt', 'one\n');
  await sync(a);
  const first = git('rev-parse', 'main');
  put(a, 'attachments/note.txt', 'two\n');
  await sync(a);
  git('branch', 'backup/raced', first);
  const preview = await previewHistoryRebuild(a);
  const invoke = a.git.bind(a);
  a.git = async (...args) => {
    if (args[0].includes('--atomic')) git('update-ref', 'refs/heads/backup/raced', preview.tip);
    return invoke(...args);
  };
  const result = await applyHistoryRebuild(a, { previewId: preview.previewId, deleteBackupBranches: true });
  assert.equal(result.ok, true);
  assert.match(result.branchError, /没有删除/);
  assert.deepEqual(result.deletedBranches, []);
  assert.equal(git('rev-parse', 'backup/raced'), preview.tip, 'the newly changed backup is preserved');
});

test(
  'history preview reports specific failures and refuses uploads to an unverified remote',
  { timeout: 120000 },
  async t => {
    const { make, put, sync, git } = setup(t);
    const a = make('a', '0.21.0');
    put(a, 'attachments/note.txt', 'one\n');
    await sync(a);
    put(a, 'attachments/note.txt', 'two\n');
    await sync(a);
    const invoke = a.git.bind(a);
    a.git = async (...args) =>
      args[0].includes('ls-remote') ? { code: 1, out: '', err: '', timedOut: true } : invoke(...args);
    await assert.rejects(previewHistoryRebuild(a), /读取同步仓库分支超时/);
    a.git = async (...args) =>
      args[0].includes('--count') ? { code: 1, out: '', err: 'synthetic invalid commit' } : invoke(...args);
    await assert.rejects(previewHistoryRebuild(a), /无法统计本机同步副本/);
    a.git = invoke;
    const preview = await previewHistoryRebuild(a),
      before = git('for-each-ref');
    a.verifyPrivateRemote = async () => ({ error: 'private verification failed' });
    await assert.rejects(applyHistoryRebuild(a, { previewId: preview.previewId }), /private verification failed/);
    assert.equal(git('for-each-ref'), before, 'private verification failure cannot write any remote branch');
  },
);

test('preview fetches a new receipt once and never trusts an older cached receipt', { timeout: 120000 }, async t => {
  const { make, sync } = setup(t);
  const a = make('a', '0.21.0'),
    b = make('b', '0.20.3');
  await sync(a);
  await sync(b);
  // Match main without fetching devices, so B's receipt is genuinely missing.
  assert.equal((await a.git(['fetch', '--no-tags', 'origin', 'main'])).code, 0);
  assert.equal((await a.git(['reset', '--hard', 'FETCH_HEAD'])).code, 0);
  const invoke = a.git.bind(a),
    networkCalls = [];
  a.git = async (...args) => {
    if (args[0].includes('fetch') || args[0].includes('ls-remote')) networkCalls.push(args[0]);
    return invoke(...args);
  };
  const preview = await previewHistoryRebuild(a);
  assert.equal(preview.blockers.length, 1);
  assert.match(preview.blockers[0].reason, /0\.20\.3/);
  assert.equal(networkCalls.length, 2, 'only the missing receipt adds a fetch');
  assert.ok(!networkCalls[1].some(v => v.includes('refs/heads/main')), 'main history is never fetched for preview');
  networkCalls.length = 0;
  assert.equal((await previewHistoryRebuild(a)).blockers.length, 1);
  assert.equal(networkCalls.length, 1);
});

test(
  'clearing history preserves local-only branches and refuses unreferenced recovery commits',
  { timeout: 120000 },
  async t => {
    const { make, put, sync, git } = setup(t);
    const a = make('a', '0.21.0');
    put(a, 'attachments/note.txt', 'one\n');
    await sync(a);
    put(a, 'attachments/note.txt', 'two\n');
    await sync(a);
    const tip = git('rev-parse', 'main');
    await a.git(['branch', 'backup/local-only', tip]);
    const created = await a.git(['commit-tree', tip + '^{tree}', '-m', 'synthetic recovery commit']);
    assert.equal(created.code, 0);
    const orphan = created.out.trim();
    await a.git(['update-ref', '--create-reflog', 'refs/chatsync-test/recovery', orphan]);
    await a.git(['update-ref', 'refs/chatsync-test/recovery', tip]);
    const preview = await previewHistoryRebuild(a);
    await assert.rejects(applyHistoryRebuild(a, { previewId: preview.previewId }), /未归档的独有提交/);
    assert.equal((await a.git(['cat-file', '-e', orphan + '^{commit}'])).code, 0);
    assert.equal(git('rev-parse', 'main'), tip);
    // Explicitly anchor the fixture recovery commit so cleanup may proceed.
    await a.git(['update-ref', 'refs/chatsync-test/kept', orphan]);
    const done = await applyHistoryRebuild(a, { previewId: preview.previewId });
    assert.equal(done.ok, true);
    assert.equal((await a.git(['rev-parse', 'refs/heads/backup/local-only'])).out.trim(), tip);
    assert.equal((await a.git(['cat-file', '-e', orphan + '^{commit}'])).code, 0);
  },
);
