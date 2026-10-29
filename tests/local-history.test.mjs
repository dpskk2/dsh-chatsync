import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { analyzeRepoUsage } from '../lib/repo-usage.js';
import { previewLocalHistory, reclaimLocalHistory } from '../lib/local-history.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

// A clear made by an earlier version left a local backup ref pinning the old
// pack after its remote branch was deleted. The usage check shows that space,
// and reclaiming drops the ref only when the remote archive still holds it.
test(
  'old history pinned by local backup refs is shown and reclaimed only when kept remotely',
  {
    timeout: 180000,
  },
  async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-local-history-'));
    t.after(() => removeFixture(root));
    const remote = path.join(root, 'remote.git');
    execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
    const bare = (...args) => execFileSync('git', ['--git-dir', remote, ...args], { encoding: 'utf8' }).trim();
    const home = path.join(root, 'a');
    fs.mkdirSync(home);
    const engine = acceptFixturePreviews(
      attachFixturePersistence(new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false })),
    );
    engine.verifyPrivateRemote = async () => ({ ok: true });
    const ghCalls = [];
    engine.gh = async args => (ghCalls.push(args), { code: 1, out: '', err: 'not github' });
    const put = (file, value) => {
      fs.mkdirSync(path.dirname(path.join(home, file)), { recursive: true });
      fs.writeFileSync(path.join(home, file), value);
    };
    const sync = async () => {
      const result = await engine.syncOnce('test', { forceCommit: true });
      assert.equal(result.error, undefined, JSON.stringify(result));
    };
    put('attachments/large.bin', randomBytes(512 * 1024));
    await sync();
    put('attachments/large.bin', 'small now\n');
    await sync();
    const oldTip = bare('rev-parse', 'main');
    // Clear as an earlier version did: archive on the remote, new root commit,
    // remote backup branch deleted, but the local backup ref left in place.
    bare('branch', 'archive/sync-history/1-old', oldTip);
    const fresh = bare('commit-tree', oldTip + '^{tree}', '-m', 'cleared');
    bare('update-ref', 'refs/heads/main', fresh);
    await engine.git(['fetch', 'origin']);
    await engine.git(['reset', '--soft', 'origin/main']);
    await engine.git(['branch', 'backup/2026-10-25-left', oldTip]);
    await engine.git(['branch', 'backup/local-only', oldTip + '~1']);
    await engine.git(['reflog', 'expire', '--expire=now', '--all']);
    await engine.git(['gc', '--quiet']);

    const usage = await analyzeRepoUsage(engine);
    assert.equal(usage.historyBytes, 0, 'the sync branch itself has no history');
    assert.ok(usage.localOtherBytes > 400 * 1024, 'the pinned old pack is reported, not hidden as 0 B');
    assert.ok(usage.localBytes >= usage.totalBytes + usage.localOtherBytes - 1);

    const preview = await previewLocalHistory(engine);
    const byRef = Object.fromEntries(preview.refs.map(r => [r.ref, r]));
    assert.equal(byRef['refs/heads/backup/2026-10-25-left'].removable, true, 'the archive holds it');
    // Its ancestor is held by the archive too; a commit GitHub never saw would not be.
    assert.equal(byRef['refs/heads/backup/local-only'].removable, true);
    await engine.git(['branch', '-f', 'backup/local-only', fresh]);
    const unique = await engine.git([
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@invalid',
      'commit-tree',
      fresh + '^{tree}',
      '-m',
      'only here',
    ]);
    await engine.git(['update-ref', 'refs/heads/backup/local-only', unique.out.trim()]);
    const checked = await previewLocalHistory(engine);
    const only = checked.refs.find(r => r.ref === 'refs/heads/backup/local-only');
    assert.equal(only.removable, false, 'history only this computer has is protected');
    assert.equal(ghCalls.length, 0, 'a remote that is not on GitHub is never queried through the GitHub API');

    await assert.rejects(reclaimLocalHistory(engine, { previewId: preview.previewId }), /状态已变化/);
    const before = engine._transport.repoSizeBytes();
    const done = await reclaimLocalHistory(engine, { previewId: checked.previewId });
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.deepEqual(done.removed, ['refs/heads/backup/2026-10-25-left']);
    assert.ok(done.freedBytes > 400 * 1024);
    assert.ok(engine._transport.repoSizeBytes() < before / 2, 'the old pack is released');
    assert.equal(engine.ok(await engine.git(['rev-parse', '--verify', 'refs/heads/backup/local-only'])), true);
    assert.equal(bare('rev-parse', 'archive/sync-history/1-old'), oldTip, 'the remote archive is untouched');
    assert.equal(fs.readFileSync(path.join(home, 'attachments/large.bin'), 'utf8'), 'small now\n');
  },
);
