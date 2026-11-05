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
  t.after(() => {
    removeFixture(root);
    removeFixture(outside);
  });
  const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'ignore' });
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  fs.writeFileSync(path.join(root, 'note.txt'), 'synthetic readonly Git fixture');
  git(['add', '.']);
  git(['commit', '-m', 'fixture']);
  fs.writeFileSync(path.join(outside, 'original.txt'), 'outside stays unchanged');
  fs.symlinkSync(outside, path.join(root, 'chatsync-linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => removeFixture(os.tmpdir()), /non-fixture/);
  assert.throws(() => removeFixture(process.cwd()), /non-fixture/);
  assert.throws(() => removeFixture(path.join(root, 'chatsync-linked')), /root link/);
  removeFixture(root);
  assert.equal(fs.existsSync(root), false);
  assert.equal(fs.readFileSync(path.join(outside, 'original.txt'), 'utf8'), 'outside stays unchanged');
});

test('fixture teardown works when the temp directory is reached through a link, as on macOS', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-cleanup-base-'));
  t.after(() => removeFixture(base));
  const target = path.join(base, 'target'),
    link = path.join(base, 'link');
  fs.mkdirSync(target);
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  const names = ['TMPDIR', 'TMP', 'TEMP'],
    saved = names.map(name => process.env[name]);
  for (const name of names) process.env[name] = link;
  try {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-cleanup-linked-'));
    assert.ok(fixture.startsWith(link));
    removeFixture(fixture);
    assert.equal(fs.existsSync(fixture), false);
    assert.throws(() => removeFixture(link), /non-fixture/);
  } finally {
    names.forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    });
  }
});
