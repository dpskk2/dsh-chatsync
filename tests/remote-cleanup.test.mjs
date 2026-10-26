import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { previewRemoteCleanup, applyRemoteCleanup, versionAtLeast } from '../lib/remote-cleanup.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';

// Files an older version uploaded stay in the shared tree until the user removes
// them on purpose, and only after every computer runs a version that will not
// import that removal as a deletion of its own copy.
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-remote-cleanup-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
  const old = path.join(root, 'old');
  execFileSync('git', ['clone', remote, old], { stdio: 'ignore' });
  for (const [file, value] of Object.entries({
    'ext-bridge-token': 'b'.repeat(64),
    'profiles/desktop/package.json': '{"from":"old"}',
    'settings.yaml': 'theme: light\n',
  })) {
    fs.mkdirSync(path.dirname(path.join(old, file)), { recursive: true });
    fs.writeFileSync(path.join(old, file), value);
  }
  const git = args =>
    execFileSync('git', ['-c', 'user.name=old', '-c', 'user.email=old@invalid', ...args], {
      cwd: old,
      stdio: 'ignore',
    });
  git(['add', '.']);
  git(['commit', '-m', 'older version']);
  git(['push', 'origin', 'HEAD:main']);
  const make = (name, version) => {
    const home = path.join(root, name);
    fs.mkdirSync(home);
    const engine = new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false });
    engine.verifyPrivateRemote = async () => ({ ok: true });
    engine.pluginVersion = () => version;
    return acceptFixturePreviews(attachFixturePersistence(engine));
  };
  const remoteFiles = () =>
    new Set(
      execFileSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean),
    );
  const sync = async engine => {
    const result = await engine.syncOnce('test', { forceCommit: true });
    assert.equal(result.error, undefined, JSON.stringify(result));
    return result;
  };
  return { make, remoteFiles, sync };
}

test('release versions compare numerically', () => {
  assert.equal(versionAtLeast('0.21.0', '0.21.0'), true);
  assert.equal(versionAtLeast('0.21.1', '0.21.0'), true);
  assert.equal(versionAtLeast('1.0.0', '0.21.0'), true);
  assert.equal(versionAtLeast('0.20.10', '0.21.0'), false);
  assert.equal(versionAtLeast('0.21.0-beta.1', '0.21.0'), true);
  assert.equal(versionAtLeast(null, '0.21.0'), false);
});

test(
  'cleanup lists only files outside the sync categories and waits for every computer to upgrade',
  { timeout: 120000 },
  async t => {
    const { make, remoteFiles, sync } = setup(t);
    const a = make('a', '0.21.0'),
      b = make('b', '0.20.3');
    fs.writeFileSync(path.join(a.home, 'ext-bridge-token'), 'a'.repeat(64));
    await sync(b);
    await sync(a);
    const preview = await previewRemoteCleanup(a);
    assert.deepEqual(preview.files, ['ext-bridge-token', 'profiles/desktop/package.json']);
    assert.equal(preview.blockers.length, 1);
    assert.match(preview.blockers[0].reason, /0\.20\.3/);
    await assert.rejects(applyRemoteCleanup(a, { previewId: preview.previewId }), /未升级到 0\.21\.0/);
    await assert.rejects(
      applyRemoteCleanup(a, { previewId: 'stale', retiredDevices: [preview.blockers[0].deviceId] }),
      /重新检查/,
    );
    assert.ok(remoteFiles().has('ext-bridge-token'), 'nothing is removed before confirmation');

    b.pluginVersion = () => '0.21.0';
    await sync(b);
    const ready = await previewRemoteCleanup(a);
    assert.deepEqual(ready.blockers, []);
    const done = await applyRemoteCleanup(a, { previewId: ready.previewId });
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.equal(done.removed, 2);
    const after = remoteFiles();
    assert.equal(after.has('ext-bridge-token'), false);
    assert.equal(after.has('profiles/desktop/package.json'), false);
    assert.ok(after.has('settings.yaml'), 'listed settings stay');
    assert.equal(
      fs.readFileSync(path.join(a.home, 'ext-bridge-token'), 'utf8'),
      'a'.repeat(64),
      'this computer keeps its own copy',
    );
    await sync(b);
    assert.equal(fs.existsSync(path.join(b.home, 'settings.yaml')), true);
    assert.deepEqual((await previewRemoteCleanup(a)).files, [], 'the confirmation is used once');
  },
);

test('a computer confirmed as retired no longer blocks the cleanup', { timeout: 120000 }, async t => {
  const { make, remoteFiles, sync } = setup(t);
  const a = make('a', '0.21.0'),
    b = make('b', null);
  await sync(b);
  await sync(a);
  const preview = await previewRemoteCleanup(a);
  assert.match(preview.blockers[0].reason, /版本未知/);
  const done = await applyRemoteCleanup(a, {
    previewId: preview.previewId,
    retiredDevices: [preview.blockers[0].deviceId],
  });
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(remoteFiles().has('ext-bridge-token'), false);
});
