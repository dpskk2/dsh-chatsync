import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';

// A newer DSH can rewrite its settings format; an older DSH must not receive it,
// and must not overwrite it either. A newer DSH reads what an older one wrote, so it
// keeps syncing and takes over the version record. Sessions and attachments keep syncing.
function devices(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-version-gate-'));
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
  const shown = file => {
    try {
      return execFileSync('git', ['--git-dir', remote, 'show', 'main:' + file], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return null;
    }
  };
  const sync = async engine => {
    const result = await engine.syncOnce('test', { forceCommit: true });
    assert.equal(result.error, undefined, JSON.stringify(result));
    return result;
  };
  return { make, put, read, shown, sync };
}
const patch = theme => `- name: theme\n  value: ${theme}\n`;

test(
  'an older DSH pauses settings behind a newer record, and resumes once it is upgraded',
  { timeout: 120000 },
  async t => {
    const { make, put, read, shown, sync } = devices(t);
    const a = make('a', '0.2.1-rc.3'),
      b = make('b', '0.2.1-rc.2');
    put(a, 'cordis.patch.yml', patch('dark'));
    put(a, 'attachments/from-a.txt', 'shared file\n');
    await sync(a);
    assert.equal(shown('cordis.patch.yml'), patch('dark'));
    assert.match(shown('storages/sync-meta/settings-writer.json'), /0\.2\.1-rc\.3/);

    put(b, 'cordis.patch.yml', patch('light'));
    const paused = await sync(b);
    assert.equal(read(b, 'attachments/from-a.txt'), 'shared file\n', 'attachments still sync');
    assert.equal(read(b, 'cordis.patch.yml'), patch('light'), 'settings from another DSH version are not applied');
    assert.equal(shown('cordis.patch.yml'), patch('dark'), 'an older DSH does not overwrite the newer settings');
    assert.match(paused.settingsPause || '', /由较新的 DSH 0\.2\.1-rc\.3 写入，本机是 0\.2\.1-rc\.2/);
    assert.ok(
      paused.settingsPause.includes('0.2.1-rc.2') && paused.settingsPause.includes('0.2.1-rc.3'),
      paused.settingsPause,
    );
    assert.equal(
      read(b, 'storages/sync-meta/settings-writer.json'),
      null,
      'the version record never enters the data directory',
    );

    b.hostDshVersion = () => '0.2.1-rc.3';
    await sync(b);
    assert.notEqual(read(b, 'cordis.patch.yml'), null);
    assert.ok(
      [patch('dark'), patch('light')].includes(shown('cordis.patch.yml')),
      'settings flow again once versions match',
    );
  },
);

test('an unknown DSH version keeps the previous behaviour', { timeout: 120000 }, async t => {
  const { make, put, read, sync } = devices(t);
  const a = make('a', null),
    b = make('b', '0.2.1-rc.3');
  put(a, 'cordis.patch.yml', patch('dark'));
  await sync(a);
  await sync(b);
  assert.equal(read(b, 'cordis.patch.yml'), patch('dark'));
});

test('after every computer upgrades past the recorded version, settings resume on the first sync', async t => {
  // Reported case: both computers wrote with rc.5 and then both upgraded. No one is
  // left with the recorded version, so a pause "while versions differ" never ended.
  const { make, put, read, shown, sync } = devices(t);
  const a = make('a', '0.2.1-rc.5'),
    b = make('b', '0.2.1-rc.5');
  put(a, 'cordis.patch.yml', patch('dark'));
  await sync(a);
  await sync(b);
  assert.equal(read(b, 'cordis.patch.yml'), patch('dark'));
  assert.match(shown('storages/sync-meta/settings-writer.json'), /0\.2\.1-rc\.5/);

  a.hostDshVersion = () => '0.2.2-rc.1';
  b.hostDshVersion = () => '0.2.2-rc.1';
  put(a, 'cordis.patch.yml', patch('light'));
  const first = await sync(a);
  assert.equal(first.settingsPause, undefined, first.settingsPause);
  assert.equal(first.settingsPauseVersions, undefined);
  assert.equal(shown('cordis.patch.yml'), patch('light'), 'the newer DSH sends its settings');
  assert.match(shown('storages/sync-meta/settings-writer.json'), /0\.2\.2-rc\.1/, 'and takes over the record');
  const second = await sync(b);
  assert.equal(second.settingsPause, undefined);
  assert.equal(read(b, 'cordis.patch.yml'), patch('light'));
  const third = await sync(a);
  assert.equal(third.settingsPause, undefined);
});

test('once a newer DSH takes over, a computer still on the older one pauses and leaves the settings alone', async t => {
  const { make, put, read, shown, sync } = devices(t);
  const a = make('a', '0.2.1-rc.5'),
    b = make('b', '0.2.1-rc.5');
  put(a, 'cordis.patch.yml', patch('dark'));
  await sync(a);
  await sync(b);
  a.hostDshVersion = () => '0.2.2-rc.1';
  put(a, 'cordis.patch.yml', patch('light'));
  await sync(a);
  assert.match(shown('storages/sync-meta/settings-writer.json'), /0\.2\.2-rc\.1/);

  put(b, 'cordis.patch.yml', patch('blue'));
  put(b, 'attachments/from-b.txt', 'still syncs\n');
  const paused = await sync(b);
  assert.equal(
    paused.settingsPause,
    '同步仓库中的设置由较新的 DSH 0.2.2-rc.1 写入，本机是 0.2.1-rc.5，本轮暂停同步设置；把这台电脑的 DSH 更新到 0.2.2-rc.1 或更新版本后自动恢复。会话和附件照常同步。',
  );
  assert.deepEqual(paused.settingsPauseVersions, { own: '0.2.1-rc.5', other: '0.2.2-rc.1' });
  assert.equal(read(b, 'cordis.patch.yml'), patch('blue'), 'the newer settings are not applied');
  assert.equal(shown('cordis.patch.yml'), patch('light'), 'nor overwritten');
  assert.match(shown('storages/sync-meta/settings-writer.json'), /0\.2\.2-rc\.1/, 'the record stays with the newer');
  assert.equal(shown('attachments/from-b.txt'), 'still syncs\n');
});

test('a version that cannot be ordered still pauses while it differs from the record', async t => {
  const { make, put, read, shown, sync } = devices(t);
  const a = make('a', '0.2.1-rc.5'),
    b = make('b', 'dev-build');
  put(a, 'cordis.patch.yml', patch('dark'));
  await sync(a);
  put(b, 'cordis.patch.yml', patch('light'));
  const paused = await sync(b);
  assert.match(paused.settingsPause || '', /两台电脑的 DSH 版本不同（本机 dev-build，另一台 0\.2\.1-rc\.5）/);
  assert.deepEqual(paused.settingsPauseVersions, { own: 'dev-build', other: '0.2.1-rc.5' });
  assert.equal(read(b, 'cordis.patch.yml'), patch('light'));
  assert.equal(shown('cordis.patch.yml'), patch('dark'));
});
