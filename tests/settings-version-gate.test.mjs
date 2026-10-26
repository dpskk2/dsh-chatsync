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
// and must not overwrite it either. Sessions and attachments keep syncing.
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
  'settings pause in both directions while the two DSH versions differ, and resume once they match',
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
    assert.match(paused.settingsPause || '', /DSH 版本不同/);
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
