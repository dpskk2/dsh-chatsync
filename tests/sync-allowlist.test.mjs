import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { contentKind } from '../lib/scope.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';

// Like other multi-device sync products, only explicit categories travel; files that
// DSH, other plugins or the user add to the data directory stay on their own machine.
test('only listed DSH data belongs to a sync category', () => {
  const expected = {
    sessions: [
      'sessions/group/session-11111111-1111-1111-1111-111111111111/session.v4.jsonl.zstd',
      'storages/workspace.json',
      'storages/session_projcache/sessions/session-1.json',
      'storages/sync-meta/storages/workspace.json.vmap.json',
    ],
    attachments: ['attachments/a/photo.png'],
    settings: [
      'settings.yaml',
      'cordis.patch.yml',
      'profiles/desktop/cordis.patch.yml',
      'profiles/web/cordis.patch.yml',
      'dsh-sync.json',
      '.gitignore',
      'storages/session_projcache.json',
      'storages/sync-meta/settings.yaml.vmap.json',
      'storages/sync-meta/profiles/web/cordis.patch.yml.vmap.json',
    ],
    instructions: ['AGENTS.md', 'skills/review/SKILL.md', 'skills/review/scripts/check.py'],
  };
  for (const [kind, files] of Object.entries(expected))
    for (const file of files) assert.equal(contentKind(file), kind, file);
  for (const file of [
    'settings.yaml.imported',
    'electron/resources/default_app.asar',
    'dsh-runtimes/node/node.exe',
    'ext-bridge-token',
    'profiles/desktop/package.json',
    'profiles/desktop/pnpm-lock.yaml',
    'profiles/desktop/pnpm-workspace.yaml',
    'profiles/desktop/package.json.lock',
    'profiles/desktop/cordis.yml',
    'profiles/desktop/cordis.patch.yml.bak-1792848562267',
    'profiles/desktop/cordis.patch.yml.pre-migration',
    'storages/sync-meta/profiles/web/pnpm-lock.yaml.vmap.json',
    'storages/sync-meta/profiles/web/package.json.vmap.json',
    'dsh-sync.json.before-reset-20261024-161748',
    'memory/lessons.md',
    'AGENTS.local.md',
    'update-dsh.ps1',
    'restart-dsh-web.cmd',
    'last-update-status.txt',
    'backup/chatsync-lib-20261001/sync.js',
    'browser-extension/manifest.json',
    'patches/web-fetch-http/patch.json',
    'llm-deepseek/files-v3.json',
    'dsh-market/printed-build-keys.json',
    'storages/new-dsh-feature.json',
    'note.txt',
  ])
    assert.equal(contentKind(file), null, file);
});

function devices(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-allowlist-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
  const make = name => {
    const home = path.join(root, name);
    fs.mkdirSync(home);
    const engine = new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false });
    engine.verifyPrivateRemote = async () => ({ ok: true });
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
  return { root, remote, make, put, read, remoteFiles, sync };
}

const machineOnly = {
  'ext-bridge-token': 'a'.repeat(64),
  'profiles/desktop/package.json': '{"dependencies":{"chatsync":"file:C:/Users/a/chatsync.tgz"}}',
  'profiles/desktop/pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
  'profiles/desktop/cordis.patch.yml.bak-1': '- name: old\n',
  'memory/lessons.md': 'local lessons\n',
  'update-dsh.ps1': 'Write-Output local\n',
  'backup/chatsync-lib/sync.js': 'old plugin\n',
  'storages/new-dsh-feature.json': '{"machine":"a"}',
};

test(
  'files outside the sync categories never leave the machine, and instructions follow their own switch',
  { timeout: 120000 },
  async t => {
    const { make, put, read, remoteFiles, sync } = devices(t);
    const a = make('a'),
      b = make('b');
    put(a, 'settings.yaml', 'theme: dark\n');
    put(a, 'profiles/desktop/cordis.patch.yml', '- name: theme\n  value: dark\n');
    for (const [file, value] of Object.entries(machineOnly)) put(a, file, value);
    put(a, 'AGENTS.md', '# shared rules\n');
    put(a, 'skills/review/SKILL.md', '# review skill\n');
    await sync(a);
    let uploaded = remoteFiles();
    assert.ok(
      uploaded.has('settings.yaml') && uploaded.has('profiles/desktop/cordis.patch.yml'),
      [...uploaded].join(','),
    );
    for (const file of [...Object.keys(machineOnly), 'AGENTS.md', 'skills/review/SKILL.md'])
      assert.equal(uploaded.has(file), false, file);
    for (const [file, value] of Object.entries(machineOnly))
      assert.equal(read(a, file), value, 'local original kept: ' + file);

    a.overrides.syncInstructions = true;
    await sync(a);
    uploaded = remoteFiles();
    assert.ok(uploaded.has('AGENTS.md') && uploaded.has('skills/review/SKILL.md'));

    await sync(b);
    assert.equal(read(b, 'settings.yaml'), 'theme: dark\n');
    assert.equal(read(b, 'AGENTS.md'), null, 'instructions stay off on a machine that did not turn them on');
    for (const file of Object.keys(machineOnly)) assert.equal(read(b, file), null, file);
    b.overrides.syncInstructions = true;
    await sync(b);
    assert.equal(read(b, 'AGENTS.md'), '# shared rules\n');
    assert.equal(read(b, 'skills/review/SKILL.md'), '# review skill\n');
  },
);

test(
  'files an older version already uploaded stay on the remote but are neither imported nor overwritten',
  { timeout: 120000 },
  async t => {
    const { root, remote, make, put, read, remoteFiles, sync } = devices(t);
    // An older version pushed machine-only files into the shared history.
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
    const git = args => execFileSync('git', args, { cwd: old, stdio: 'ignore' });
    git(['-c', 'user.name=old', '-c', 'user.email=old@invalid', 'add', '.']);
    git(['-c', 'user.name=old', '-c', 'user.email=old@invalid', 'commit', '-m', 'old version']);
    git(['push', 'origin', 'HEAD:main']);

    const a = make('a');
    put(a, 'ext-bridge-token', 'a'.repeat(64));
    put(a, 'profiles/desktop/package.json', '{"from":"a"}');
    await sync(a);
    assert.equal(read(a, 'ext-bridge-token'), 'a'.repeat(64), 'the local token is never replaced by the remote one');
    assert.equal(read(a, 'profiles/desktop/package.json'), '{"from":"a"}');
    assert.equal(read(a, 'settings.yaml'), 'theme: light\n', 'listed settings still arrive');
    const shown = file => execFileSync('git', ['--git-dir', remote, 'show', 'main:' + file], { encoding: 'utf8' });
    assert.ok(remoteFiles().has('ext-bridge-token'), 'no deletion is propagated for files that stopped syncing');
    assert.equal(shown('ext-bridge-token'), 'b'.repeat(64), 'the local token is never uploaded over the old one');
    assert.equal(shown('profiles/desktop/package.json'), '{"from":"old"}');
  },
);
