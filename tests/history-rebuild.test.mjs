import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { previewHistoryRebuild, applyHistoryRebuild } from '../lib/history-rebuild.js';
import { scanLocalStorage } from '../lib/local-storage.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

// Clearing the history keeps exactly the current content, saves the old history on
// this computer first, waits for every computer to upgrade, and another computer
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

test('clearing history keeps the current content and backs up the old history', { timeout: 240000 }, async t => {
  const { make, git, put, sync } = setup(t);
  const a = make('a', '0.21.0'),
    b = make('b', '0.20.3');
  put(a, 'attachments/note.txt', 'first\n');
  await sync(a);
  put(a, 'attachments/note.txt', 'second\n');
  put(a, 'attachments/old.txt', 'gone soon\n');
  await sync(a);
  fs.rmSync(path.join(a.home, 'attachments/old.txt'));
  await sync(a);
  await sync(b);
  git('branch', 'backup/2026-old', 'main');
  const oldTip = git('rev-parse', 'main');
  const tree = git('rev-parse', 'main^{tree}');

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
  const ready = await previewHistoryRebuild(a);
  assert.deepEqual(ready.blockers, []);
  const done = await applyHistoryRebuild(a, { previewId: ready.previewId, deleteBackupBranches: true });
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(git('rev-list', '--count', 'main'), '1', 'only the current content remains');
  assert.equal(git('rev-parse', 'main^{tree}'), tree, 'the current content is unchanged');
  assert.deepEqual(done.deletedBranches, ['backup/2026-old']);
  assert.equal(git('for-each-ref', 'refs/heads/backup/'), '');

  const bundle = path.join(a.home, done.backup);
  const restore = path.join(path.dirname(a.home), 'restore.git');
  execFileSync('git', ['init', '--bare', restore], { stdio: 'ignore' });
  execFileSync('git', ['--git-dir', restore, 'bundle', 'verify', '--quiet', bundle], { stdio: 'ignore' });
  const listed = execFileSync('git', ['bundle', 'list-heads', bundle], { cwd: a.home, encoding: 'utf8' });
  assert.match(listed, new RegExp(oldTip), 'the backup holds the old history');
  const scan = await scanLocalStorage(a);
  assert.ok(
    scan.items.some(item => item.category === 'history' && item.path === bundle),
    'the backup is listed with local backups',
  );

  // Both computers keep syncing on the new history; the old one is not pushed back.
  put(b, 'attachments/from-b.txt', 'b\n');
  await sync(b);
  await sync(a);
  assert.throws(() => git('merge-base', '--is-ancestor', oldTip, 'main'), 'the old history stays gone');
  assert.equal(fs.readFileSync(path.join(a.home, 'attachments/from-b.txt'), 'utf8'), 'b\n');
  assert.equal(fs.readFileSync(path.join(b.home, 'attachments/note.txt'), 'utf8'), 'second\n');
});

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
