import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

// When the shared repository's history is rebuilt (replaced by unrelated history),
// a computer's old transport copy must not merge its old history back in.
test(
  'a rebuilt remote history is adopted; the old transport copy is set aside, never pushed back',
  { timeout: 180000 },
  async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-rebuilt-'));
    t.after(() => removeFixture(root));
    const remote = path.join(root, 'remote.git');
    execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
    const home = path.join(root, 'a');
    fs.mkdirSync(home);
    const a = acceptFixturePreviews(
      attachFixturePersistence(new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false })),
    );
    a.verifyPrivateRemote = async () => ({ ok: true });
    const put = (file, value) => {
      fs.mkdirSync(path.dirname(path.join(home, file)), { recursive: true });
      fs.writeFileSync(path.join(home, file), value);
    };
    put('attachments/old-only.txt', 'only in the old history');
    put('attachments/kept.txt', 'kept');
    assert.equal((await a.syncOnce('test', { forceCommit: true })).error, undefined);
    fs.rmSync(path.join(home, 'attachments/old-only.txt'));
    assert.equal((await a.syncOnce('test', { forceCommit: true })).error, undefined);
    const oldHead = execFileSync('git', ['--git-dir', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();

    // Someone rebuilds the repository as one unrelated commit.
    const rebuild = path.join(root, 'rebuild');
    execFileSync('git', ['init', '--initial-branch=main', rebuild], { stdio: 'ignore' });
    fs.mkdirSync(path.join(rebuild, 'attachments'));
    fs.writeFileSync(path.join(rebuild, 'attachments/kept.txt'), 'kept');
    const git = args => execFileSync('git', args, { cwd: rebuild, stdio: 'ignore' });
    git(['add', '.']);
    git(['-c', 'user.name=r', '-c', 'user.email=r@invalid', 'commit', '-m', 'rebuilt']);
    git(['push', '--force', remote, 'main:main']);

    put('attachments/new.txt', 'added after the rebuild');
    const result = await a.syncOnce('test', { forceCommit: true });
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.equal(result.historyRebuilt, true);
    assert.notEqual(
      spawnSync('git', ['--git-dir', remote, 'merge-base', '--is-ancestor', oldHead, 'main']).status,
      0,
      'the old history is not pushed back',
    );
    assert.ok(
      Number(execFileSync('git', ['--git-dir', remote, 'rev-list', '--count', 'main'], { encoding: 'utf8' })) <= 2,
    );
    const files = execFileSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main'], {
      encoding: 'utf8',
    });
    assert.match(files, /attachments\/new\.txt/, 'this computer’s current content goes onto the new history');
    assert.doesNotMatch(files, /old-only\.txt/);
    const views = fs.readdirSync(path.join(home, '.chatsync-local', 'main-views'));
    assert.ok(
      views.some(name => /-replaced-\d+$/.test(name)),
      'the old copy is kept aside for cleanup: ' + views.join(','),
    );
  },
);
