import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-config-'));
  t.after(() => removeFixture(home));
  const engine = new SyncEngine(home, { remote: path.join(home, 'synthetic-remote.git'), autoRepo: false });
  const git = args => execFileSync('git', args, { cwd: home, encoding: 'utf8' });
  return { engine, git };
}

test('repository setup notices external edits and replaces duplicate transport settings', async t => {
  const { engine, git } = fixture(t);
  const cfg = engine.loadConfig();
  assert.equal(await engine.ensureRepo(cfg), true);
  const invoke = engine.git.bind(engine), writes = [];
  engine.git = async (...args) => {
    if (args[0][0] === 'config' && args[0].includes('--replace-all')) writes.push(args[0]);
    return invoke(...args);
  };
  assert.equal(await engine.ensureRepo(cfg), true);
  assert.equal(writes.length, 0);
  git(['config', 'user.name', 'external identity']);
  git(['config', '--add', 'credential.helper', 'unwanted-helper']);
  git(['config', '--add', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
  git(['config', 'unrelated.setting', 'preserve this']);
  assert.equal(await engine.ensureRepo(cfg), true);
  assert.equal(git(['config', '--get', 'user.name']).trim(), cfg.gitUserName);
  assert.equal(git(['config', '--local', '--get-all', 'credential.helper']).trim(), 'manager');
  assert.equal(git(['config', '--local', '--get-all', 'remote.origin.fetch']).trim(), '+refs/heads/main:refs/remotes/origin/main');
  assert.equal(git(['config', '--get', 'unrelated.setting']).trim(), 'preserve this');
});

test('repository setup stops when required local configuration cannot be read or written', async t => {
  const { engine } = fixture(t);
  const cfg = engine.loadConfig(), invoke = engine.git.bind(engine);
  assert.equal(await engine.ensureRepo(cfg), true);
  engine.git = async (...args) => args[0].includes('--list')
    ? { code: 1, out: '', err: 'injected unreadable config' } : invoke(...args);
  assert.equal(await engine.ensureRepo(cfg), false);
  engine.git = async (...args) => args[0].includes('--replace-all')
    ? { code: 1, out: '', err: 'injected config lock' } : invoke(...args);
  assert.equal(await engine.ensureRepo({ ...cfg, gitUserName: 'changed identity' }), false);
});
