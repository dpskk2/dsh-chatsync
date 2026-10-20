import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SyncEngine } from '../lib/sync.js';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-private-'));
  t.after(() => removeFixture(home));
  const engine = new SyncEngine(home);
  engine.ghLogin = async () => 'alice';
  return engine;
}

test('missing Git produces an error outcome and never starts workspace sync', async t => {
  const engine = fixture(t);
  engine.gitMissing = true;
  engine.syncAllWorkspaces = async () => assert.fail('must not sync workspaces without Git');
  const outcome = await engine.syncOnce('test');
  assert.match(outcome.error, /Git/);
  assert.equal(engine.progress.stage, 'error');
});

test('auto setup refuses an existing public repository without saving remote', async (t) => {
  const engine = fixture(t);
  engine.gh = async () => ({ code: 0, out: '{"visibility":"PUBLIC"}', err: '' });
  assert.equal(await engine.bootstrapRemote({ repoName: 'dsh-sync' }), null);
  assert.equal(fs.existsSync(engine.configPath()), false);
  const outcome = await engine.syncOnce('test');
  assert.match(outcome.error, /私有/);
});

test('auto setup refuses an unparseable visibility response', async (t) => {
  const engine = fixture(t);
  engine.gh = async () => ({ code: 0, out: 'bad response', err: '' });
  assert.equal(await engine.bootstrapRemote({ repoName: 'dsh-sync' }), null);
  assert.equal(fs.existsSync(engine.configPath()), false);
});

test('manual remote verification fails closed and accepts private HTTPS or SSH', async (t) => {
  const engine = fixture(t);
  engine.gh = async () => ({ code: 0, out: '{"visibility":"PUBLIC"}', err: '' });
  assert.ok((await engine.verifyPrivateRemote('https://github.com/alice/data.git')).error);
  engine.gh = async () => ({ code: 1, out: '', err: 'offline' });
  assert.ok((await engine.verifyPrivateRemote('git@github.com:alice/data.git')).error);
  engine.gh = async () => ({ code: 0, out: '{"visibility":"PRIVATE"}', err: '' });
  assert.deepEqual(await engine.verifyPrivateRemote('git@github.com:alice/data.git'), { ok: true });
  assert.ok((await engine.verifyPrivateRemote('https://example.com/alice/data')).error);
});

test('sync aborts before initializing git if configured remote is not private', async (t) => {
  const engine = fixture(t);
  fs.writeFileSync(engine.configPath(), JSON.stringify({ remote: 'https://github.com/alice/data.git' }));
  engine.gh = async () => ({ code: 0, out: '{"visibility":"PUBLIC"}', err: '' });
  const outcome = await engine._mainSync('test');
  assert.match(outcome.error, /私有/);
  assert.equal(fs.existsSync(path.join(engine.home, '.git')), false);
});

test('repository failures show their cause and stop before any local or remote writes', async t => {
  const cases = [
    ['device/API EOF', { code: 1, err: 'Post "https://github.com/login/device/code": EOF' }, /连接 GitHub 失败/],
    ['DNS', { code: 1, err: 'dial tcp: lookup api.github.com: no such host' }, /网络、代理或 DNS/],
    ['proxy', { code: 1, err: 'proxyconnect tcp: connection refused' }, /连接 GitHub 失败/],
    ['timeout', { code: null, err: '', timedOut: true }, /连接 GitHub 失败/],
    ['logged out', { code: 1, err: 'To get started with GitHub CLI, please run: gh auth login' }, /尚未登录或登录已失效/],
    ['expired token', { code: 1, err: 'HTTP 401: Bad credentials' }, /尚未登录或登录已失效/],
    ['missing/private inaccessible', { code: 1, err: 'GraphQL: Could not resolve to a Repository' }, /地址及当前账号的访问权限/],
    ['forbidden', { code: 1, err: 'HTTP 403: Resource not accessible by integration' }, /无法访问 GitHub 仓库/],
    ['rate limit', { code: 1, err: 'HTTP 403: API rate limit exceeded' }, /请求次数已达到限制/],
    ['CLI missing', { code: -1, err: 'spawn gh ENOENT' }, /未找到 GitHub CLI/],
    ['service error', { code: 1, err: 'HTTP 502: upstream failed' }, /服务暂时不可用/],
    ['unknown error', { code: 1, err: 'unexpected failure' }, /暂时无法判断原因/],
    ['invalid JSON', { code: 0, out: 'bad response' }, /返回的仓库信息异常/],
    ['unknown visibility', { code: 0, out: '{"visibility":"UNKNOWN"}' }, /返回的仓库信息异常/],
    ['public', { code: 0, out: '{"visibility":"PUBLIC"}' }, /不是私有仓库/],
  ];
  for (const [label, result, expected] of cases) {
    await t.test(label, async t => {
      const engine = fixture(t);
      fs.writeFileSync(engine.configPath(), JSON.stringify({ remote: 'https://github.com/alice/data.git', autoRepo: false }));
      engine.gh = async () => ({ out: '', err: '', ...result });
      engine.git = async () => assert.fail('must not execute Git after a failed repository check');
      const outcome = await engine._mainSync('test');
      assert.match(outcome.error, expected);
      assert.match(outcome.error, /本次不会上传/);
      if (/EOF|DNS|proxy|timeout/.test(label)) assert.doesNotMatch(outcome.error, /gh auth login|私有仓库/);
      assert.equal(fs.existsSync(path.join(engine.home, '.git')), false);
    });
  }
});

test('network failure during auto setup does not attempt to create a repository', async t => {
  const engine = fixture(t);
  const calls = [];
  engine.gh = async args => {
    calls.push(args);
    return { code: 1, out: '', err: 'Get https://api.github.com/graphql: EOF' };
  };
  assert.equal(await engine.bootstrapRemote({ repoName: 'dsh-sync' }), null);
  assert.equal(calls.length, 1);
  assert.match(engine._bootstrapError, /连接 GitHub 失败/);
  assert.equal(fs.existsSync(engine.configPath()), false);
});

test('a killed timed-out CLI carries a timeout reason even without stderr', async t => {
  const engine = fixture(t);
  const result = await engine._spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 80);
  assert.equal(result.timedOut, true);
  assert.match(engine.githubRequestError(result), /连接 GitHub 失败/);
});

test('auto setup still creates a private repository after a missing repository response', async t => {
  const engine = fixture(t);
  const calls = [];
  engine.gh = async args => {
    calls.push(args);
    return args[1] === 'view' ? { code: 1, out: '', err: 'HTTP 404: Not Found' } : { code: 0, out: '', err: '' };
  };
  assert.equal(await engine.bootstrapRemote({ repoName: 'dsh-sync' }), 'https://github.com/alice/dsh-sync.git');
  assert.deepEqual(calls[1], ['repo', 'create', 'alice/dsh-sync', '--private']);
  assert.equal(JSON.parse(fs.readFileSync(engine.configPath())).remote, 'https://github.com/alice/dsh-sync.git');
});

test('failed main sync never starts workspace syncing', async (t) => {
  const engine = fixture(t);
  fs.writeFileSync(engine.configPath(), JSON.stringify({ remote: 'https://github.com/alice/data.git' }));
  engine.gh = async () => ({ code: 0, out: '{"visibility":"PUBLIC"}', err: '' });
  engine.syncAllWorkspaces = () => { throw new Error('workspace sync must not run'); };
  const outcome = await engine.syncOnce('test');
  assert.match(outcome.error, /私有/);
});

test('remote-head backup reports whether its branch reached the remote', async (t) => {
  const engine = fixture(t);
  engine.git = async () => ({ code: 0, out: '', err: '' });
  engine.runWithRetry = async () => ({ code: 1, out: '', err: 'offline' });
  const local = await engine.backupRemoteHead(null, null, 'abcdef');
  assert.ok(local.branch.startsWith('backup/'));
  assert.equal(local.pushed, false);
  engine.runWithRetry = async () => ({ code: 0, out: '', err: '' });
  assert.equal((await engine.backupRemoteHead(null, null, 'abcdef')).pushed, true);
});

test('two backups within the same second retain separate readable Git branches', async (t) => {
  const engine = fixture(t);
  await engine.git(['init']);
  await engine.git(['config', 'user.name', 'test']);
  await engine.git(['config', 'user.email', 'test@localhost']);
  fs.writeFileSync(path.join(engine.home, 'note.txt'), 'recover this content\n');
  await engine.git(['add', '.']);
  await engine.git(['commit', '-m', 'fixture']);
  const head = (await engine.git(['rev-parse', 'HEAD'])).out.trim();
  engine.runWithRetry = async () => ({ code: 1, out: '', err: 'offline' });
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000000 });
  const first = await engine.backupRemoteHead(null, null, head);
  const second = await engine.backupRemoteHead(null, null, head);
  assert.ok(first?.branch); assert.ok(second?.branch);
  assert.notEqual(first.branch, second.branch);
  for (const backup of [first, second]) {
    assert.equal(backup.pushed, false);
    const content = await engine.git(['show', backup.branch + ':note.txt']);
    assert.equal(content.code, 0);
    assert.equal(content.out, 'recover this content\n');
  }
});
