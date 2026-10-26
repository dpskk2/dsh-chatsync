import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSyncConfig, SyncEngine } from '../lib/sync.js';
import { parseSyncRemote } from '../lib/remote.js';

test('new connections enable automation and legacy manual preferences never gain automatic transfers', () => {
  assert.equal(resolveSyncConfig().enabled, true);
  assert.equal(resolveSyncConfig({ enabled: false }).enabled, false);
  assert.equal(resolveSyncConfig({ lifecycleAutomation: 1, enabled: false }, { enabled: true }).enabled, false);
  for (const enabled of [undefined, true, false]) {
    const old = { mode: 'manual', remote: 'https://github.com/a/data', ...(enabled === undefined ? {} : { enabled }) };
    const result = resolveSyncConfig(old);
    assert.equal(result.enabled, false);
    assert.deepEqual(old, {
      mode: 'manual',
      remote: 'https://github.com/a/data',
      ...(enabled === undefined ? {} : { enabled }),
    });
  }
});
test('explicit lifecycle switches, existing auto mode and pauses retain their behavior', () => {
  for (const autoPullOnStart of [true, false])
    for (const autoPushOnExit of [true, false]) {
      const original = { mode: 'manual', enabled: true, autoPullOnStart, autoPushOnExit };
      const config = resolveSyncConfig(original);
      assert.equal(config.enabled, true);
      assert.equal(config.autoPullOnStart, autoPullOnStart);
      assert.equal(config.autoPushOnExit, autoPushOnExit);
      assert.equal(resolveSyncConfig({ ...original, enabled: false }).enabled, false);
    }
  assert.equal(resolveSyncConfig({ mode: 'auto' }).enabled, true);
  assert.equal(resolveSyncConfig({ mode: 'manual', lifecycleAutomation: 1, enabled: true }).enabled, true);
});
test('host overrides remain effective and reading settings never rewrites their file', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-config-migration-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, 'dsh-sync.json'),
    bytes = Buffer.from(JSON.stringify({ mode: 'manual', enabled: true, remote: 'https://github.com/a/data' }));
  fs.writeFileSync(file, bytes);
  assert.equal(new SyncEngine(home).loadConfig().enabled, false);
  assert.equal(new SyncEngine(home, { enabled: true }).loadConfig().enabled, true);
  assert.equal(new SyncEngine(home, { enabled: false, autoPullOnStart: true }).loadConfig().enabled, false);
  assert.deepEqual(fs.readFileSync(file), bytes);
});
test('GitHub-only parsing rejects other backends and credential-bearing addresses', () => {
  for (const address of [
    'https://github.com/alice/data.git',
    'git@github.com:alice/data.git',
    'ssh://git@github.com/alice/data.git',
  ])
    assert.equal(parseSyncRemote(address)?.fullName, 'alice/data');
  for (const address of [
    'https://gitcode.com/alice/data',
    'https://gitee.com/alice/data',
    'https://token@github.com/alice/data',
    'https://github.com.evil/a/b',
    'https://github.com/a/../b',
  ])
    assert.equal(parseSyncRemote(address), null);
});
