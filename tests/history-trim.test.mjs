import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { trimHistory, ensureMergeBase } from '../lib/history-trim.js';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=f@example.invalid', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();

// A bare remote and a full clone with `commits` pushed commits on main.
function fixture(t, commits) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-trim-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git'),
    copy = path.join(root, 'copy');
  git(root, 'init', '--quiet', '--bare', '-b', 'main', remote);
  git(root, 'clone', '--quiet', remote, copy);
  git(copy, 'checkout', '--quiet', '-b', 'main');
  for (let i = 1; i <= commits; i++) {
    fs.appendFileSync(path.join(copy, 'log.jsonl'), JSON.stringify({ seq: i }) + '\n');
    git(copy, 'add', 'log.jsonl');
    git(copy, 'commit', '--quiet', '-m', 'c' + i);
  }
  git(copy, 'push', '--quiet', 'origin', 'main');
  git(copy, 'fetch', '--quiet', 'origin');
  const engine = new SyncEngine(copy, { autoRepo: false, workspaceSync: false });
  return { root, remote, copy, engine, cfg: { remote, branch: 'main' } };
}

test('a copy in step with the remote keeps only its recent history', { timeout: 60000 }, async t => {
  const h = fixture(t, 12);
  assert.equal(await trimHistory(h.engine, h.cfg, { trimAt: 10, keep: 5 }), true);
  assert.equal(git(h.copy, 'rev-parse', '--is-shallow-repository'), 'true');
  assert.equal(git(h.copy, 'rev-list', '--count', 'HEAD'), '5');
  // The remote still holds every version.
  assert.equal(git(h.remote, 'rev-list', '--count', 'main'), '12');
  // Below the threshold nothing happens.
  assert.equal(await trimHistory(h.engine, h.cfg, { trimAt: 10, keep: 5 }), false);
});

test('history is not trimmed while this copy has commits the remote lacks', { timeout: 60000 }, async t => {
  const h = fixture(t, 12);
  fs.appendFileSync(path.join(h.copy, 'log.jsonl'), '{"seq":13}\n');
  git(h.copy, 'commit', '--quiet', '-am', 'local only');
  assert.equal(await trimHistory(h.engine, h.cfg, { trimAt: 10, keep: 5 }), false);
  // A commit only a reflog reaches also blocks trimming.
  git(h.copy, 'reset', '--quiet', '--hard', 'origin/main');
  assert.equal(await trimHistory(h.engine, h.cfg, { trimAt: 10, keep: 5 }), false);
  assert.equal(git(h.copy, 'rev-parse', '--is-shallow-repository'), 'false');
});

test('a trimmed copy fetches its early history when two heads meet below the cut', { timeout: 60000 }, async t => {
  const h = fixture(t, 12);
  assert.equal(await trimHistory(h.engine, h.cfg, { trimAt: 10, keep: 3 }), true);
  // Another computer continues from commit 4, which this copy no longer has.
  const other = path.join(h.root, 'other');
  git(h.root, 'clone', '--quiet', h.remote, other);
  git(other, 'checkout', '--quiet', '-b', 'side', 'HEAD~8');
  fs.writeFileSync(path.join(other, 'other.txt'), 'other computer\n');
  git(other, 'add', 'other.txt');
  git(other, 'commit', '--quiet', '-m', 'other');
  git(other, 'push', '--quiet', '--force', 'origin', 'side:main');
  git(h.copy, 'fetch', '--quiet', 'origin');
  const local = git(h.copy, 'rev-parse', 'HEAD'),
    remote = git(h.copy, 'rev-parse', 'origin/main');
  assert.throws(() => git(h.copy, 'merge-base', local, remote));
  assert.equal(await ensureMergeBase(h.engine, local, remote), true);
  assert.equal(git(h.copy, 'rev-parse', '--is-shallow-repository'), 'false');
  assert.ok(git(h.copy, 'merge-base', local, remote));
});
