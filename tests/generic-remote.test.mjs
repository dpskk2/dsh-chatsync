// Sync remotes on Git hosts other than GitHub (issue #12): address parsing, the
// anonymous-read privacy check against real Git over local HTTP, and saving.
import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { SyncEngine } from '../lib/sync.js';
import { parseSyncRemote } from '../lib/remote.js';
import { anonymousReadError } from '../lib/engine/remote-repo.js';
import { saveConnection } from '../lib/connection.js';
import { writeSyncConfig } from '../lib/config-file.js';

function fixture(t, config = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-generic-remote-'));
  t.after(() => removeFixture(home));
  const engine = new SyncEngine(home);
  if (Object.keys(config).length) writeSyncConfig(engine.configPath(), config);
  engine.gh = async () => assert.fail('GitHub CLI must not be used for other hosts');
  return engine;
}

test('any credential-free HTTPS or SSH Git address parses; GitHub keeps its strict form', () => {
  const cases = [
    [
      'https://gitee.com/alice/dsh-sync.git',
      'git',
      'https',
      'Gitee',
      'alice/dsh-sync',
      'https://gitee.com/alice/dsh-sync.git',
    ],
    [
      'git@gitee.com:alice/dsh-sync.git',
      'git',
      'ssh',
      'Gitee',
      'alice/dsh-sync',
      'https://gitee.com/alice/dsh-sync.git',
    ],
    [
      'ssh://git@git.example.com:2222/group/sub/repo.git',
      'git',
      'ssh',
      'git.example.com',
      'group/sub/repo',
      'https://git.example.com/group/sub/repo.git',
    ],
    [
      'https://GitLab.Example.com:8443/group/repo/',
      'git',
      'https',
      'gitlab.example.com',
      'group/repo',
      'https://GitLab.Example.com:8443/group/repo',
    ],
    [
      'https://github.com/alice/data.git',
      'github',
      'https',
      'GitHub',
      'alice/data',
      'https://github.com/alice/data.git',
    ],
    ['ssh://git@github.com/alice/data', 'github', 'ssh', 'GitHub', 'alice/data', 'https://github.com/alice/data.git'],
  ];
  for (const [remote, provider, transport, label, fullName, probeUrl] of cases) {
    const parsed = parseSyncRemote(remote);
    assert.ok(parsed, remote);
    assert.deepEqual(
      [parsed.provider, parsed.transport, parsed.label, parsed.fullName, parsed.probeUrl],
      [provider, transport, label, fullName, probeUrl],
      remote,
    );
  }
  assert.equal(
    parseSyncRemote('https://gitlab.example.com:8443/group/repo').webUrl,
    'https://gitlab.example.com:8443/group/repo',
  );
  assert.equal(parseSyncRemote('ssh://git@host.lan:2222/a/b').webUrl, 'https://host.lan/a/b');
  for (const remote of [
    'http://gitee.com/alice/data', // plain HTTP would expose the login
    'https://token@gitee.com/alice/data',
    'https://user:secret@gitlab.com/alice/data',
    'ssh://user:secret@host.lan/alice/data',
    'git@gitee.com:/srv/alice/data',
    'https://gitee.com/alice',
    'https://gitee.com/alice/../data',
    'https://gitee.com/alice/data?x=1',
    'https://github.com/alice/data/tree',
    'deploy@github.com:alice/data',
    'https://github.com:444/alice/data',
    'file:///srv/data.git',
    'C:/repos/data.git',
    '',
  ])
    assert.equal(parseSyncRemote(remote), null, remote);
});

test('only a login demand counts as private; readable, missing and failed reads fail closed', () => {
  const gitee = parseSyncRemote('git@gitee.com:alice/data.git');
  const private401 = {
    code: 128,
    err: "fatal: could not read Username for 'https://gitee.com': terminal prompts disabled",
  };
  assert.equal(anonymousReadError(gitee, private401), null);
  assert.equal(anonymousReadError(gitee, { code: 128, err: 'The requested URL returned error: 401' }), null);
  const cases = [
    [{ code: 0, out: 'abc\trefs/heads/main\n' }, /公开仓库/],
    [{ code: 0, out: '' }, /公开仓库/],
    [{ ...private401, timedOut: true }, /连接 Gitee 失败/],
    [{ code: 128, err: "fatal: repository 'https://gitee.com/alice/data.git/' not found" }, /找不到这个仓库/],
    [
      { code: 128, err: 'fatal: unable to access: The requested URL returned error: 403' },
      /无法确认 Gitee 上的仓库是否私有.*403/,
    ],
    [
      { code: 128, err: "fatal: unable to access 'https://gitee.com/': Could not resolve host: gitee.com" },
      /连接 Gitee 失败/,
    ],
    [{ code: 128, err: 'error: RPC failed; HTTP 429 curl 22 The requested URL returned error: 429' }, /无法确认/],
    [{ code: -1, err: 'spawn git ENOENT' }, /未检测到 Git/],
  ];
  for (const [result, expected] of cases) {
    const reason = anonymousReadError(gitee, result);
    assert.match(String(reason), expected, JSON.stringify(result));
    if (result.code !== -1)
      assert.match(reason, /SSH 地址通过同一站点的 HTTPS 地址 https:\/\/gitee\.com\/alice\/data\.git 检查/);
  }
});

/**
 * A dumb-HTTP Git server over a real bare repository. `private` demands Basic
 * auth (401) and serves the repository to any request carrying credentials, so
 * a probe that leaked stored credentials would see refs.
 */
async function gitServer(t, mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-generic-server-'));
  t.after(() => removeFixture(root));
  const work = path.join(root, 'work'),
    bare = path.join(root, 'data.git');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  fs.mkdirSync(work);
  git(work, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(work, 'a.txt'), 'a');
  git(work, 'add', 'a.txt');
  git(work, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'a');
  git(root, 'clone', '-q', '--bare', work, bare);
  git(bare, 'update-server-info');
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, authorization: req.headers.authorization || '' });
    if (mode === 'missing') return res.writeHead(404).end('Not found');
    if (mode === 'private' && !req.headers.authorization)
      return res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' }).end();
    const file = path.join(
      bare,
      decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/data\.git\//, ''),
    );
    if (!file.startsWith(bare) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}/data.git`, seen, root };
}

/** Real Git with every credential source the probe must ignore configured globally. */
function probingEngine(t, root) {
  const engine = fixture(t);
  const globalConfig = path.join(root, 'global.gitconfig');
  fs.writeFileSync(
    globalConfig,
    [
      '[credential]',
      '\thelper = "!f() { echo username=stored; echo password=secret; }; f"',
      '[http]',
      '\textraHeader = Authorization: Basic c3RvcmVkOnNlY3JldA==',
      '',
    ].join('\n'),
  );
  engine.applyProxyEnv = () => {};
  Object.assign(engine._gitEnv, { GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' });
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'])
    delete engine._gitEnv[name];
  return engine;
}

test('real Git: a login-protected repository is private even with stored credentials configured', async t => {
  const server = await gitServer(t, 'private');
  const engine = probingEngine(t, server.root);
  // The stored credentials do work: an ordinary read gets the refs.
  const ordinary = await engine._spawn('git', ['ls-remote', '--heads', server.url], 30000, {
    useGitEnv: true,
    cwd: os.tmpdir(),
  });
  assert.equal(ordinary.code, 0, ordinary.err);
  assert.match(ordinary.out, /refs\/heads\/main/);
  server.seen.length = 0;
  const probe = await engine.anonymousRead(server.url);
  assert.notEqual(probe.code, 0);
  assert.equal(anonymousReadError({ label: 'host', transport: 'https', probeUrl: server.url }, probe), null, probe.err);
  assert.ok(server.seen.length > 0);
  assert.ok(
    server.seen.every(r => !r.authorization),
    'the probe must not send stored credentials',
  );
});

test('real Git: an anonymously readable repository is refused as public', async t => {
  const server = await gitServer(t, 'public');
  const engine = probingEngine(t, server.root);
  const probe = await engine.anonymousRead(server.url);
  assert.equal(probe.code, 0, probe.err);
  assert.match(
    String(anonymousReadError({ label: 'host', transport: 'https', probeUrl: server.url }, probe)),
    /公开仓库/,
  );
});

test('real Git: a missing repository or unreachable host cannot be confirmed private', async t => {
  const server = await gitServer(t, 'missing');
  const engine = probingEngine(t, server.root);
  const parsed = { label: 'host', transport: 'https', probeUrl: server.url };
  assert.match(String(anonymousReadError(parsed, await engine.anonymousRead(server.url))), /找不到这个仓库/);
  const closed = http.createServer();
  await new Promise(resolve => closed.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${closed.address().port}/data.git`;
  await new Promise(resolve => closed.close(resolve));
  assert.match(String(anonymousReadError(parsed, await engine.anonymousRead(url))), /连接 host 失败/);
});

test('sync refuses a public non-GitHub remote before creating any repository', async t => {
  const engine = fixture(t, { remote: 'git@gitee.com:alice/data.git', autoRepo: false });
  const probed = [];
  engine.anonymousRead = async url => {
    probed.push(url);
    return { code: 0, out: 'abc\trefs/heads/main\n', err: '' };
  };
  engine.git = async () => assert.fail('must not execute Git after a failed repository check');
  const outcome = await engine._mainSync('test');
  assert.deepEqual(probed, ['https://gitee.com/alice/data.git']);
  assert.match(outcome.error, /公开仓库.*本次不会上传/);
  assert.equal(fs.existsSync(path.join(engine.home, '.git')), false);
});

test('a login-protected non-GitHub remote passes the upload check without GitHub CLI', async t => {
  const engine = fixture(t);
  engine.anonymousRead = async () => ({
    code: 128,
    out: '',
    err: "fatal: could not read Username for 'https://gitlab.example.com': terminal prompts disabled",
  });
  assert.deepEqual(await engine.verifyPrivateRemote('https://gitlab.example.com/team/sub/data.git'), { ok: true });
});

test('saving a non-GitHub connection needs a private repository this computer can read', async t => {
  const old = 'https://github.com/alice/old.git',
    remote = 'git@gitee.com:alice/dsh-sync.git';
  const engine = fixture(t, { remote: old, branch: 'main', enabled: false });
  const before = fs.readFileSync(engine.configPath());
  const login = {
    code: 128,
    out: '',
    err: "fatal: could not read Username for 'https://gitee.com': terminal prompts disabled",
  };
  const failures = [
    [{ code: 0, out: 'x\trefs/heads/main\n', err: '' }, null, /公开仓库.*原同步仓库未更改/],
    [{ code: 128, out: '', err: 'Could not resolve host: gitee.com' }, null, /连接 Gitee 失败/],
    [login, { code: 128, out: '', err: 'git@gitee.com: Permission denied (publickey).' }, /SSH 密钥/],
    [login, { code: 128, out: '', err: "fatal: repository 'x' not found" }, /找不到这个仓库，或当前账号无权访问/],
    [login, { code: null, out: '', err: '', timedOut: true }, /超时/],
  ];
  for (const [probe, read, expected] of failures) {
    engine.anonymousRead = async () => probe;
    engine.git = async args => {
      assert.deepEqual(args, ['ls-remote', '--heads', remote]);
      return read || assert.fail('must not read with credentials after the privacy check failed');
    };
    await assert.rejects(saveConnection(engine, { remote, expectedRemote: old }), expected);
    assert.deepEqual(fs.readFileSync(engine.configPath()), before);
  }
  engine.anonymousRead = async () => login;
  engine.git = async () => ({ code: 0, out: 'abc\trefs/heads/main\n', err: '' });
  const saved = await saveConnection(engine, { remote, expectedRemote: old });
  assert.equal(saved.config.remote, remote);
  assert.equal(saved.config.autoRepo, false);
  assert.deepEqual(saved.config.remoteWeb, { url: 'https://gitee.com/alice/dsh-sync', label: 'Gitee' });
  assert.match(saved.hint, /Gitee.*写入权限在首次上传时确认/);
  assert.equal(engine.loadConfig().enabled, false);
});

test('an HTTPS login failure on another host explains how to sign in once', async t => {
  const old = 'https://github.com/alice/old.git',
    remote = 'https://gitlab.example.com/team/data.git';
  const engine = fixture(t, { remote: old });
  engine.anonymousRead = async () => ({ code: 128, out: '', err: 'The requested URL returned error: 401' });
  engine.git = async () => ({
    code: 128,
    out: '',
    err: "fatal: could not read Username for 'https://gitlab.example.com'",
  });
  await assert.rejects(
    saveConnection(engine, { remote, expectedRemote: old }),
    /还没有 gitlab\.example\.com 的登录凭据。请先在终端运行 git ls-remote https:\/\/gitlab\.example\.com\/team\/data\.git/,
  );
  assert.equal(engine.loadConfig().remote, old);
});
