import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

test('fixture teardown removes readonly Git objects, preserves junction targets and refuses other roots', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-cleanup-test-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-cleanup-outside-'));
  t.after(() => { removeFixture(root); removeFixture(outside); });
  const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'ignore' });
  git(['init', '-b', 'main']); git(['config', 'user.name', 'fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
  fs.writeFileSync(path.join(root, 'note.txt'), 'synthetic readonly Git fixture');
  git(['add', '.']); git(['commit', '-m', 'fixture']);
  fs.writeFileSync(path.join(outside, 'original.txt'), 'outside stays unchanged');
  fs.symlinkSync(outside, path.join(root, 'chatsync-linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => removeFixture(os.tmpdir()), /non-fixture/);
  assert.throws(() => removeFixture(process.cwd()), /non-fixture/);
  assert.throws(() => removeFixture(path.join(root, 'chatsync-linked')), /root link/);
  removeFixture(root);
  assert.equal(fs.existsSync(root), false);
  assert.equal(fs.readFileSync(path.join(outside, 'original.txt'), 'utf8'), 'outside stays unchanged');
});
