import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SyncEngine } from '../lib/sync.js';
import { saveConnection } from '../lib/connection.js';
import { writeSyncConfig } from '../lib/config-file.js';

const old = 'https://github.com/alice/old.git';
const remote = 'https://github.com/team/dsh-sync2.git';
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-connection-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const engine = new SyncEngine(home);
  writeSyncConfig(engine.configPath(), { remote: old, branch: 'backup', enabled: false, contentScope: { sessions: true, settings: false } });
  return engine;
}

test('custom backup is verified for privacy and write access before saving, retaining other preferences', async t => {
  const engine = fixture(t), calls = [];
  engine.gh = async args => {
    calls.push(args);
    assert.equal(engine.loadConfig().remote, old);
    writeSyncConfig(engine.configPath(), { workspaceSync: false });
    return { code: 0, out: JSON.stringify({ visibility: 'PRIVATE', viewerPermission: 'WRITE' }) };
  };
  const result = await saveConnection(engine, { remote: ' ' + remote + ' ', expectedRemote: old });
  assert.deepEqual(calls, [['repo', 'view', 'team/dsh-sync2', '--json', 'visibility,viewerPermission']]);
  assert.equal(result.config.remote, remote); assert.equal(result.config.autoRepo, false);
  const config = engine.loadConfig();
  assert.equal(config.branch, 'backup'); assert.equal(config.workspaceSync, false); assert.equal(config.enabled, false);
  assert.equal(config.contentScope.settings, false);
  assert.equal(fs.existsSync(path.join(engine.home, '.git')), false);
});

test('unavailable, public, read-only and malformed custom repositories leave config byte-for-byte intact', async t => {
  const engine = fixture(t), before = fs.readFileSync(engine.configPath());
  for (const result of [
    { code: 1, err: 'HTTP 404: Not Found' },
    { code: 1, err: 'proxyconnect: connection refused' },
    { code: 1, err: '', timedOut: true },
    { code: 0, out: '{"visibility":"PUBLIC","viewerPermission":"ADMIN"}' },
    { code: 0, out: '{"visibility":"PRIVATE","viewerPermission":"READ"}' },
    { code: 0, out: '{"visibility":"PRIVATE"}' },
    { code: 0, out: 'invalid' },
  ]) {
    engine.gh = async () => result;
    await assert.rejects(saveConnection(engine, { remote, expectedRemote: old }));
    assert.deepEqual(fs.readFileSync(engine.configPath()), before);
  }
});

test('blank enables the default repository without a network call or repository creation', async t => {
  const engine = fixture(t);
  engine.gh = async () => assert.fail('default save must not contact GitHub');
  writeSyncConfig(engine.configPath(), { autoRepo: false, repoOwner: 'legacy', repoName: 'legacy' });
  const result = await saveConnection(engine, { remote: ' ', expectedRemote: old });
  const config = engine.loadConfig();
  assert.equal(config.remote, ''); assert.equal(config.autoRepo, true);
  assert.equal(config.repoOwner, ''); assert.equal(config.repoName, 'dsh-sync');
  assert.match(result.hint, /首次同步/);
  assert.equal(fs.existsSync(path.join(engine.home, '.git')), false);
});

test('changes during verification, active sync, process locks and host overrides cannot replace a destination', async t => {
  const engine = fixture(t);
  engine.gh = async () => {
    writeSyncConfig(engine.configPath(), { remote: 'https://github.com/alice/newer.git' });
    return { code: 0, out: '{"visibility":"PRIVATE","viewerPermission":"ADMIN"}' };
  };
  await assert.rejects(saveConnection(engine, { remote, expectedRemote: old }), /已发生变化/);
  assert.match(engine.loadConfig().remote, /newer/);
  writeSyncConfig(engine.configPath(), { remote: old });
  engine.inFlight = Promise.resolve();
  await assert.rejects(saveConnection(engine, { remote: '', expectedRemote: old }), /同步正在进行/);
  engine.inFlight = null;
  const release = engine.acquireProcessLock();
  try { await assert.rejects(saveConnection(engine, { remote: '', expectedRemote: old }), /同步正在进行/); }
  finally { release(); }
  engine.overrides.remote = old;
  await assert.rejects(saveConnection(engine, { remote: '', expectedRemote: old }), /宿主配置限制/);
  assert.equal(engine.loadConfig().remote, old);
});
