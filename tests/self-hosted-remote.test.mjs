import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { saveConnection } from '../lib/connection.js';
import { isSelfHostedRemote, parseConfiguredRemote, parseSyncRemote } from '../lib/remote.js';
import { checkNetwork } from '../lib/network-check.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';

// A self-hosted server (#25): a bare repository reached over SSH, saved from its own
// help tab. It has no anonymous HTTPS read, so no privacy check is made (experimental).

test('self-hosted addresses are accepted only when saved as a self-hosted server', () => {
  for (const [address, fullName] of [
    ['alice@nas.local:/srv/git/dsh-sync.git', '/srv/git/dsh-sync.git'],
    ['alice@nas.local:dsh-sync.git', 'dsh-sync.git'],
    ['alice@192-168-1-2.lan:backups/dsh/dsh-sync.git', 'backups/dsh/dsh-sync.git'],
    ['ssh://alice@nas.local:2222/srv/git/dsh-sync.git', '/srv/git/dsh-sync.git'],
    ['ssh://alice@nas.local/dsh-sync', '/dsh-sync'],
  ]) {
    const parsed = parseSyncRemote(address, { selfHosted: true });
    assert.ok(parsed, address);
    assert.equal(parsed.provider, 'self-hosted');
    assert.equal(parsed.transport, 'ssh');
    assert.equal(parsed.host, address.includes('192-168') ? '192-168-1-2.lan' : 'nas.local');
    assert.equal(parsed.fullName, fullName);
    assert.equal(parsed.webUrl, null);
    assert.equal(parsed.probeUrl, null);
  }
  // The ordinary input keeps its rules: no absolute or single-level scp paths.
  assert.equal(parseSyncRemote('alice@nas.local:/srv/git/dsh-sync.git'), null);
  assert.equal(parseSyncRemote('alice@nas.local:dsh-sync.git'), null);
  for (const address of [
    'https://nas.local/srv/git/dsh-sync.git',
    'alice@nas.local:~/dsh-sync.git',
    'alice@nas.local:~alice/dsh-sync.git',
    'ssh://alice@nas.local/~/dsh-sync.git',
    'alice:secret@nas.local:/srv/dsh-sync.git',
    'ssh://alice:secret@nas.local/srv/dsh-sync.git',
    'alice@nas.local:/srv/../etc/dsh-sync.git',
    'alice@nas.local:/srv/./dsh-sync.git',
    'alice@nas.local:',
    'nas.local:/srv/dsh-sync.git',
    'git://nas.local/srv/dsh-sync.git',
    'git@github.com:alice/dsh-sync.git',
    'git@gitee.com:alice/dsh-sync.git',
    'ssh://alice@nas.local:70000/srv/dsh-sync.git',
  ])
    assert.equal(parseSyncRemote(address, { selfHosted: true }), null, address);
});

test('the self-hosted mark holds only for the exact address it was saved with', () => {
  const remote = 'alice@nas.local:/srv/git/dsh-sync.git';
  assert.equal(isSelfHostedRemote({ remote, selfHostedRemote: remote }), true);
  assert.equal(parseConfiguredRemote({ remote, selfHostedRemote: remote })?.provider, 'self-hosted');
  assert.equal(isSelfHostedRemote({ remote: 'git@gitee.com:alice/x.git', selfHostedRemote: remote }), false);
  assert.equal(isSelfHostedRemote({ remote, selfHostedRemote: '' }), false);
  assert.equal(isSelfHostedRemote({ remote: '', selfHostedRemote: '' }), false);
  assert.equal(parseConfiguredRemote({ remote, selfHostedRemote: '' }), null);
});

function engineAt(t, config) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-self-hosted-'));
  t.after(() => removeFixture(home));
  fs.writeFileSync(path.join(home, 'dsh-sync.json'), JSON.stringify(config));
  return new SyncEngine(home, {});
}

test('a saved self-hosted server skips the anonymous read; a changed address is checked again', async t => {
  const remote = 'ssh://alice@nas.local/srv/git/dsh-sync.git';
  const engine = engineAt(t, { remote, selfHostedRemote: remote, autoRepo: false });
  const reads = [];
  engine.anonymousRead = async url => {
    reads.push(url);
    return { code: 0, out: 'abc\trefs/heads/main\n', err: '' };
  };
  assert.deepEqual(await engine.verifyPrivateRemote(remote), { ok: true });
  assert.deepEqual(reads, []);
  // Another address, even on the same server, is not covered by the mark.
  const other = 'ssh://alice@nas.local/srv/git/other.git';
  const checked = await engine.verifyPrivateRemote(other);
  assert.deepEqual(reads, ['https://nas.local/srv/git/other.git']);
  assert.match(checked.error, /公开仓库/);
  // So is the saved address once the configuration points elsewhere.
  engine.writeConfig({ remote: other });
  reads.length = 0;
  await engine.verifyPrivateRemote(remote);
  assert.deepEqual(reads, ['https://nas.local/srv/git/dsh-sync.git']);
});

test('the network check reports SSH for a self-hosted server', async t => {
  const remote = 'alice@nas.local:/srv/git/dsh-sync.git';
  const engine = engineAt(t, { remote, selfHostedRemote: remote, autoRepo: false });
  const result = await checkNetwork(engine, { candidates: [], env: {}, readSystem: () => null });
  assert.equal(result.host, 'nas.local');
  assert.equal(result.route, 'ssh');
});

// Route a made-up SSH address to a local bare repository with url.<base>.insteadOf,
// so the whole save → first upload → retrieval path runs without an SSH server.
function withSshAlias(t, address, target) {
  const saved = { ...process.env };
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });
  process.env.GIT_CONFIG_COUNT = '1';
  process.env.GIT_CONFIG_KEY_0 = `url.${target}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = address;
}

test('two computers upload to and retrieve from an empty bare repository on a self-hosted server', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-self-hosted-e2e-'));
  t.after(() => removeFixture(root));
  const bare = path.join(root, 'srv', 'dsh-sync.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', bare], { stdio: 'ignore' });
  const address = 'alice@nas.local:/srv/git/dsh-sync.git';
  withSshAlias(t, address, bare);
  const make = name => {
    const home = path.join(root, name);
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, 'dsh-sync.json'), JSON.stringify({ workspaceSync: false }));
    const engine = new SyncEngine(home, { workspaceSync: false });
    engine.hostDshVersion = () => '0.2.2-rc.1';
    engine.anonymousRead = async () => assert.fail('a self-hosted server is never read anonymously');
    return acceptFixturePreviews(attachFixturePersistence(engine));
  };
  const a = make('a'),
    b = make('b');
  // Saving from the self-hosted tab: the empty repository lists no branches, which is fine.
  const saved = await saveConnection(a, { remote: address, expectedRemote: '', selfHosted: true });
  assert.equal(saved.config.remote, address);
  assert.equal(saved.config.selfHosted, true);
  assert.equal(saved.config.remoteWeb, null);
  assert.match(saved.hint, /已连接自建服务器 nas\.local/);
  const config = JSON.parse(fs.readFileSync(path.join(a.home, 'dsh-sync.json'), 'utf8'));
  assert.equal(config.selfHostedRemote, address);
  assert.equal(config.autoRepo, false);
  await saveConnection(b, { remote: address, expectedRemote: '', selfHosted: true });

  fs.mkdirSync(path.join(a.home, 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(a.home, 'attachments', 'note.txt'), 'from a\n');
  const first = await a.syncOnce('test', { forceCommit: true });
  assert.equal(first.error, undefined, JSON.stringify(first));
  assert.equal(
    execFileSync('git', ['--git-dir', bare, 'show', 'main:attachments/note.txt'], { encoding: 'utf8' }),
    'from a\n',
  );
  const second = await b.syncOnce('test', { forceCommit: true });
  assert.equal(second.error, undefined, JSON.stringify(second));
  assert.equal(fs.readFileSync(path.join(b.home, 'attachments', 'note.txt'), 'utf8'), 'from a\n');
  // The mark is machine-only: it never travels in the shared settings.
  const shared = execFileSync('git', ['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8' });
  if (shared.split('\n').includes('dsh-sync.json'))
    assert.doesNotMatch(
      execFileSync('git', ['--git-dir', bare, 'show', 'main:dsh-sync.json'], { encoding: 'utf8' }),
      /selfHostedRemote|nas\.local/,
    );

  // Saving an ordinary address afterwards drops the mark.
  b.verifyPrivateRemote = async () => ({ ok: true });
  b.git = async () => ({ code: 0, out: '', err: '' });
  await saveConnection(b, { remote: 'git@gitee.com:alice/dsh-sync.git', expectedRemote: address });
  const after = JSON.parse(fs.readFileSync(path.join(b.home, 'dsh-sync.json'), 'utf8'));
  assert.equal(after.selfHostedRemote, '');
});

test('saving a self-hosted server explains why the SSH read failed and keeps the old address', async t => {
  const engine = engineAt(t, { remote: '', autoRepo: true });
  const address = 'alice@nas.local:/srv/git/dsh-sync.git';
  for (const [err, reason] of [
    [
      'Host key verification failed.\nfatal: Could not read from remote repository.',
      /还没有确认服务器 nas\.local 的指纹/,
    ],
    ['alice@nas.local: Permission denied (publickey).', /拒绝了这台电脑的 SSH 密钥/],
    ["fatal: '/srv/git/dsh-sync.git' does not appear to be a git repository", /服务器上找不到这个仓库/],
    ['ssh: Could not resolve hostname nas.local: Name or service not known', /连接服务器 nas\.local 失败/],
  ]) {
    engine.git = async () => ({ code: 128, out: '', err });
    await assert.rejects(saveConnection(engine, { remote: address, expectedRemote: '', selfHosted: true }), reason);
  }
  await assert.rejects(
    saveConnection(engine, { remote: 'https://nas.local/srv/dsh-sync.git', expectedRemote: '', selfHosted: true }),
    /自建服务器仓库的 SSH 地址/,
  );
  await assert.rejects(saveConnection(engine, { remote: '', expectedRemote: '', selfHosted: true }), /SSH 地址/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(engine.home, 'dsh-sync.json'), 'utf8')), {
    remote: '',
    autoRepo: true,
  });
});
