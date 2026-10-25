import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-review-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  const make = name => {
    const home = path.join(root, name); fs.mkdirSync(home);
    const engine = new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false });
    engine.requireTransferReview = true;
    engine.verifyPrivateRemote = async () => ({ ok: true });
    return engine;
  };
  const put = (engine, file, value) => { const p = path.join(engine.home, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, value); };
  return { root, remote, make, put };
}


test('automatic first upload stops, stale confirmation cannot authorize changed contents, ordinary edits need no new confirmation', { timeout: 90000 }, async t => {
  const { remote, make, put } = fixture(t), engine = make('a');
  put(engine, 'attachments/note.txt', 'first');
  const first = await engine.syncOnce('interval', { forceCommit: true });
  assert.equal(first.needsReview, true);
  assert.ok(first.review.reasons.includes('首次上传此范围'));
  assert.notEqual(spawnSync('git', ['--git-dir', remote, 'rev-parse', '--verify', 'main'], { stdio: 'ignore' }).status, 0);
  put(engine, 'attachments/another.txt', 'another');
  const stale = await engine.syncOnce('manual', { forceCommit: true, approval: first.review.id });
  assert.equal(stale.needsReview, true);
  assert.notEqual(stale.review.id, first.review.id);
  const accepted = await engine.syncOnce('manual', { forceCommit: true, approval: stale.review.id });
  assert.equal(accepted.error, undefined, JSON.stringify(accepted));
  put(engine, 'attachments/note.txt', 'ordinary edit');
  const ordinary = await engine.syncOnce('manual', { forceCommit: true });
  assert.equal(ordinary.error, undefined, JSON.stringify(ordinary));
  assert.equal(ordinary.needsReview, undefined);
});

test('remote executable configuration stays off disk until the current preview is accepted', { timeout: 90000 }, async t => {
  const { make, put } = fixture(t), a = acceptFixturePreviews(make('a')), b = make('b');
  put(a, 'cordis.patch.yml', '- name: theme\n  value: dark\n');
  assert.equal((await a.syncOnce('test', { forceCommit: true })).error, undefined);
  const preview = await b.syncOnce('startup', { forceCommit: true });
  assert.equal(preview.needsReview, true);
  assert.ok(preview.review.executable.includes('cordis.patch.yml'));
  assert.equal(fs.existsSync(path.join(b.home, 'cordis.patch.yml')), false);
  const accepted = await b.syncOnce('manual', { forceCommit: true, approval: preview.review.id });
  assert.equal(accepted.error, undefined, JSON.stringify(accepted));
  assert.equal(fs.readFileSync(path.join(b.home, 'cordis.patch.yml'), 'utf8'), '- name: theme\n  value: dark\n');
});

test('mass deletion pauses upload and preserves the remote files until approved', { timeout: 90000 }, async t => {
  const { remote, make, put } = fixture(t), engine = make('a');
  const sync = acceptFixturePreviews(engine);
  for (let i = 0; i < 8; i++) put(engine, 'attachments/fixture-' + i + '.txt', 'fixture');
  assert.equal((await sync.syncOnce('test', { forceCommit: true })).error, undefined);
  // Call the original production method to inspect the blocked round.
  for (let i = 0; i < 5; i++) fs.unlinkSync(path.join(engine.home, 'attachments/fixture-' + i + '.txt'));
  const result = await SyncEngine.prototype.syncOnce.call(engine, 'interval', { forceCommit: true });
  assert.equal(result.needsReview, true);
  assert.ok(result.review.reasons.includes('删除较多'));
  assert.equal(execFileSync('git', ['--git-dir', remote, 'show', 'main:attachments/fixture-0.txt'], { encoding: 'utf8' }), 'fixture');
  const accepted = await SyncEngine.prototype.syncOnce.call(engine, 'manual', { forceCommit: true, approval: result.review.id });
  assert.equal(accepted.error, undefined, JSON.stringify(accepted));
  assert.notEqual(spawnSync('git', ['--git-dir', remote, 'cat-file', '-e', 'main:attachments/fixture-0.txt'], { stdio: 'ignore' }).status, 0);
});
