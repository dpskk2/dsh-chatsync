import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { contentKind } from '../lib/scope.js';
import { recoveryCategory } from '../lib/recovery.js';
import { resetSettingsVersion, SETTINGS_RESET_MARKER } from '../lib/settings-version-reset.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';

// "Clear version record": a computer on an older DSH takes over settings sync from a
// newer one that is no longer used. Backups come first; the remote changes only by sync.
function devices(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-version-reset-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
  const make = (name, version) => {
    const home = path.join(root, name);
    fs.mkdirSync(home);
    const engine = new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false });
    engine.verifyPrivateRemote = async () => ({ ok: true });
    engine.hostDshVersion = () => version;
    return acceptFixturePreviews(attachFixturePersistence(engine));
  };
  const put = (engine, file, value) => {
    const target = path.join(engine.home, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  };
  const read = (engine, file) => {
    const target = path.join(engine.home, file);
    return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  };
  const git = (...args) =>
    execFileSync('git', ['--git-dir', remote, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const shown = file => {
    try {
      return git('show', 'main:' + file);
    } catch {
      return null;
    }
  };
  const sync = async engine => {
    const result = await engine.syncOnce('test', { forceCommit: true });
    assert.equal(result.error, undefined, JSON.stringify(result));
    return result;
  };
  const marker = engine => path.join(engine.home, SETTINGS_RESET_MARKER);
  return { make, put, read, git, shown, sync, marker };
}
const patch = theme => `- name: theme\n  value: ${theme}\n`;

/** A on the newer DSH wrote the settings; B, still older, is paused behind it. */
async function pausedBehindNewer(t) {
  const fixture = devices(t);
  const { make, put, sync } = fixture;
  const a = make('a', '0.2.2-rc.1'),
    b = make('b', '0.2.1-rc.5');
  put(a, 'cordis.patch.yml', patch('dark'));
  await sync(a);
  put(b, 'cordis.patch.yml', patch('light'));
  const paused = await sync(b);
  assert.deepEqual(paused.settingsPauseVersions, { own: '0.2.1-rc.5', other: '0.2.2-rc.1' });
  return { ...fixture, a, b };
}

test('clearing the version record backs up both sides, then the next sync takes over settings', async t => {
  const { b, read, git, shown, sync, marker } = await pausedBehindNewer(t);
  const remoteSettings = git('ls-tree', '-r', '--name-only', 'main')
    .split('\n')
    .filter(file => file && contentKind(file) === 'settings');
  assert.ok(remoteSettings.includes('cordis.patch.yml'), remoteSettings.join(','));

  const done = await resetSettingsVersion(b, { expectedVersion: '0.2.2-rc.1' });
  assert.deepEqual(done, { from: '0.2.2-rc.1', to: '0.2.1-rc.5', backups: remoteSettings.length });
  const records = b.recovery.list().filter(r => r.kind === 'settings-version-reset');
  assert.deepEqual(records.map(r => r.path).sort(), [...remoteSettings].sort());
  const patchRecord = records.find(r => r.path === 'cordis.patch.yml');
  assert.equal(b.recovery.version(patchRecord, 'remote').toString(), patch('dark'));
  assert.equal(b.recovery.version(patchRecord, 'local').toString(), patch('light'));
  assert.equal(patchRecord.otherVersion, '0.2.2-rc.1');
  assert.equal(patchRecord.ownVersion, '0.2.1-rc.5');
  assert.equal(recoveryCategory(patchRecord), 'history');
  const saved = JSON.parse(fs.readFileSync(marker(b), 'utf8'));
  assert.equal(saved.acknowledged, '0.2.2-rc.1');
  assert.equal(saved.own, '0.2.1-rc.5');
  assert.equal(saved.remoteCommit, git('rev-parse', 'main').trim());
  assert.match(shown('storages/sync-meta/settings-writer.json'), /0\.2\.2-rc\.1/, 'the remote is not touched directly');

  const resumed = await sync(b);
  assert.equal(resumed.settingsPause, undefined, resumed.settingsPause);
  assert.deepEqual(resumed.settingsVersionReset, {
    from: '0.2.2-rc.1',
    to: '0.2.1-rc.5',
    backups: remoteSettings.length,
  });
  assert.match(shown('storages/sync-meta/settings-writer.json'), /0\.2\.1-rc\.5/);
  assert.equal(fs.existsSync(marker(b)), false, 'the marker is removed once the record moved');
  // Settings merge by the normal rules; both sides' versions stay in the recovery records.
  assert.ok([patch('dark'), patch('light')].includes(read(b, 'cordis.patch.yml')));
  assert.equal(shown('cordis.patch.yml'), read(b, 'cordis.patch.yml'));
  const again = await sync(b);
  assert.equal(again.settingsVersionReset, undefined);
});

test('a stale page, a running sync or an unknown DSH version clears nothing', async t => {
  const { b, marker } = await pausedBehindNewer(t);
  await assert.rejects(resetSettingsVersion(b, { expectedVersion: '0.2.3' }), /版本记录已变化/);
  await assert.rejects(resetSettingsVersion(b, {}), /刷新同步状态/);
  b.inFlight = true;
  await assert.rejects(resetSettingsVersion(b, { expectedVersion: '0.2.2-rc.1' }), /同步正在进行/);
  b.inFlight = false;
  const version = b.hostDshVersion;
  b.hostDshVersion = () => null;
  await assert.rejects(resetSettingsVersion(b, { expectedVersion: '0.2.2-rc.1' }), /无法检测/);
  b.hostDshVersion = version;
  assert.equal(b.recovery.list().filter(r => r.kind === 'settings-version-reset').length, 0);
  assert.equal(fs.existsSync(marker(b)), false);
});

test('a failed backup leaves no marker, so the next sync still pauses', async t => {
  const { b, sync, marker } = await pausedBehindNewer(t);
  const save = b.recovery.save.bind(b.recovery);
  let calls = 0;
  b.recovery.save = (meta, sides) => {
    if (++calls === 2) throw new Error('disk full');
    return save(meta, sides);
  };
  await assert.rejects(resetSettingsVersion(b, { expectedVersion: '0.2.2-rc.1' }), /disk full/);
  b.recovery.save = save;
  assert.equal(fs.existsSync(marker(b)), false);
  const paused = await sync(b);
  assert.deepEqual(paused.settingsPauseVersions, { own: '0.2.1-rc.5', other: '0.2.2-rc.1' });
});

test('a marker for one version does not let this computer replace a different one', async t => {
  const { a, b, put, shown, sync, marker } = await pausedBehindNewer(t);
  await resetSettingsVersion(b, { expectedVersion: '0.2.2-rc.1' });
  a.hostDshVersion = () => '0.2.3';
  put(a, 'cordis.patch.yml', patch('green'));
  await sync(a);
  assert.match(shown('storages/sync-meta/settings-writer.json'), /0\.2\.3/);
  const paused = await sync(b);
  assert.deepEqual(paused.settingsPauseVersions, { own: '0.2.1-rc.5', other: '0.2.3' });
  assert.equal(paused.settingsVersionReset, undefined);
  assert.equal(shown('cordis.patch.yml'), patch('green'));
  assert.equal(fs.existsSync(marker(b)), false, 'a marker for another version is dropped');
});

test('clearing a version record does not authorize a newer unbacked snapshot from the same version', async t => {
  const { a, b, put, shown, sync, marker } = await pausedBehindNewer(t);
  await resetSettingsVersion(b, { expectedVersion: '0.2.2-rc.1' });
  put(a, 'cordis.patch.yml', patch('changed-after-backup'));
  await sync(a);

  const paused = await sync(b);
  assert.deepEqual(paused.settingsPauseVersions, { own: '0.2.1-rc.5', other: '0.2.2-rc.1' });
  assert.equal(paused.settingsVersionReset, undefined);
  assert.equal(shown('cordis.patch.yml'), patch('changed-after-backup'));
  assert.equal(fs.existsSync(marker(b)), false);
});
