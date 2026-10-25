import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { apply } from '../lib/index.js';
import { SyncEngine } from '../lib/sync.js';
import { checkDefaultBackup } from '../lib/connection.js';

// Every engine instance (including the transport mirror a sync creates) must use
// the fake CLI, so no test can reach the real GitHub account of this machine.
function fakeGh(t, respond) {
  const calls = [];
  t.mock.method(SyncEngine.prototype, 'gh', async function (args) {
    calls.push(args);
    return { code: 0, out: '', err: '', ...respond(args) };
  });
  return calls;
}
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-default-backup-'));
  t.after(() => removeFixture(home));
  return new SyncEngine(home);
}
const missingCli = () => ({ code: -1, err: 'Error: spawn gh ENOENT' });
const loggedOut = () => ({ code: 1, err: 'To get started with GitHub CLI, please run:  gh auth login' });
const account = (view) => args => (args[0] === 'api' ? { out: 'alice\n' } : view(args));

test('manual first sync without a GitHub account explains why nothing was uploaded', async t => {
  for (const [label, respond, expected] of [
    ['CLI missing', missingCli, /未找到 GitHub CLI/],
    ['logged out', loggedOut, /尚未登录或登录已失效/],
  ]) {
    await t.test(label, async t => {
      fakeGh(t, respond);
      const engine = fixture(t);
      const outcome = await engine.syncOnce('web-button', { forceCommit: true });
      assert.match(outcome.error ?? '', expected, JSON.stringify(outcome));
      assert.match(outcome.error, /本次不会上传/);
      assert.equal(engine.loadConfig().remote, '');
    });
  }
});

test('a repeated manual attempt within the retry window repeats the reason without asking GitHub again', async t => {
  const calls = fakeGh(t, missingCli);
  const engine = fixture(t);
  assert.equal(await engine.bootstrapRemote({ repoName: 'dsh-sync' }), null);
  assert.match(engine._bootstrapError ?? '', /未找到 GitHub CLI/);
  const asked = calls.length;
  assert.equal(await engine.bootstrapRemote({ repoName: 'dsh-sync' }), null);
  assert.equal(calls.length, asked);
  assert.match(engine._bootstrapError ?? '', /未找到 GitHub CLI/);
});

test('automatic sync without a GitHub account keeps the local snapshot and records the reason', async t => {
  fakeGh(t, missingCli);
  const engine = fixture(t);
  assert.equal(await engine.bootstrapRemote({ repoName: 'dsh-sync' }, { automatic: true }), null);
  assert.equal(engine._bootstrapError, null);
  assert.match(engine.remoteNotice(), /未找到 GitHub CLI/);
  const outcome = await engine.syncOnce('startup', { forceCommit: true, waitForLock: true });
  assert.equal(outcome.error, undefined, JSON.stringify(outcome));
  assert.equal(engine.loadConfig().remote, '');
  assert.match(engine.remoteNotice(), /未找到 GitHub CLI/);
});

test('the transport mirror never creates or reuses a repository on its own', async t => {
  const calls = fakeGh(t, missingCli);
  const engine = fixture(t);
  await engine.syncOnce('startup', { forceCommit: true, waitForLock: true });
  assert.equal(calls.filter(args => args[0] === 'api').length, 1, JSON.stringify(calls));
});

test('a successful setup clears the earlier reason', async t => {
  let available = false;
  fakeGh(t, args => (!available ? missingCli() : args[0] === 'api' ? { out: 'alice\n' } : { out: '{"visibility":"PRIVATE"}' }));
  const engine = fixture(t);
  await engine.bootstrapRemote({ repoName: 'dsh-sync' }, { automatic: true });
  assert.notEqual(engine.remoteNotice(), '');
  available = true; engine._bootstrapAt = 0;
  assert.equal(await engine.bootstrapRemote({ repoName: 'dsh-sync' }), 'https://github.com/alice/dsh-sync.git');
  assert.equal(engine.remoteNotice(), '');
});

test('checking the default backup reports the account and whether dsh-sync will be reused or created', async t => {
  for (const [label, respond, ok, expected] of [
    ['reuse', account(() => ({ out: '{"visibility":"PRIVATE"}' })), true, /将复用 alice\/dsh-sync/],
    ['create', account(() => ({ code: 1, err: 'GraphQL: Could not resolve to a Repository with the name alice/dsh-sync' })), true, /将在首次同步时创建 alice\/dsh-sync/],
    ['public', account(() => ({ out: '{"visibility":"PUBLIC"}' })), false, /不是私有仓库/],
    ['offline', account(() => ({ code: 1, err: 'dial tcp: lookup api.github.com: no such host' })), false, /连接 GitHub 失败/],
    ['CLI missing', missingCli, false, /未找到 GitHub CLI/],
    ['logged out', loggedOut, false, /尚未登录或登录已失效/],
  ]) {
    await t.test(label, async t => {
      const calls = fakeGh(t, respond);
      const engine = fixture(t);
      const result = await checkDefaultBackup(engine);
      assert.equal(result.ok, ok, JSON.stringify(result));
      assert.match(result.message, expected);
      assert.ok(calls.every(args => !(args[0] === 'repo' && args[1] === 'create')), 'checking never creates a repository');
      assert.equal(fs.existsSync(engine.configPath()), false, 'checking never changes the configuration');
      assert.equal(fs.existsSync(path.join(engine.home, '.git')), false);
    });
  }
});

test('checking the default backup lets the next manual sync retry immediately', async t => {
  fakeGh(t, missingCli);
  const engine = fixture(t);
  await engine.bootstrapRemote({ repoName: 'dsh-sync' });
  assert.ok(engine._bootstrapAt);
  await checkDefaultBackup(engine);
  assert.equal(engine._bootstrapAt, 0);
});

function host(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-default-backup-api-'));
  const routes = new Map(), cleanup = [];
  t.after(() => { cleanup.reverse().forEach(fn => fn()); removeFixture(home); });
  fs.writeFileSync(path.join(home, 'dsh-sync.json'), JSON.stringify({ mode: 'manual', autoPullOnStart: false, autoPushOnExit: false, enabled: true }));
  apply({
    webServer: { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path); } },
    on() { return () => {}; },
    effect(fn) { cleanup.push(fn()); },
    logger: { info() {}, warn() {}, debug() {} },
  }, { home, patches: false });
  return endpoint => new Promise(resolve => {
    const req = new EventEmitter(); req.method = 'GET';
    routes.get('/dsh-sync/api/' + endpoint)(req, { writeHead() {}, end(value) { resolve(JSON.parse(value)); } });
  });
}

test('status and the connection check endpoint expose why the default backup is not connected', async t => {
  fakeGh(t, missingCli);
  t.mock.method(SyncEngine.prototype, 'remoteNotice', () => '未找到 GitHub CLI。');
  const request = host(t);
  const status = await request('status');
  assert.equal(status.remote, '');
  assert.equal(status.remoteNotice, '未找到 GitHub CLI。');
  const check = await request('connection/check');
  assert.equal(check.ok, false);
  assert.match(check.message, /未找到 GitHub CLI/);
});
