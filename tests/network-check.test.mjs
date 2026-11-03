import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNetwork, localProxyCandidates } from '../lib/network-check.js';

// A stand-in engine: only the calls the check makes, with scripted Git answers.
function engine(cfg, { gitProxy = '', probe = { code: 0, out: '', err: '' } } = {}) {
  const calls = [];
  return {
    calls,
    loadConfig: () => ({ branch: 'main', proxy: '', ...cfg }),
    applyProxyEnv() {},
    ok: r => r.code === 0 && !r.timedOut,
    async git(args) {
      calls.push(args);
      if (args[0] === 'config')
        return gitProxy ? { code: 0, out: gitProxy + '\n', err: '' } : { code: 1, out: '', err: '' };
      return probe;
    },
  };
}
const quiet = { env: {}, readSystem: () => ({}), candidates: async () => [] };

test('direct GitHub access offers a host-scoped Git proxy command and its undo', async () => {
  const e = engine({ remote: 'https://github.com/a/dsh-sync.git' });
  const r = await checkNetwork(e, { ...quiet, candidates: async () => [{ port: 7890, url: 'http://127.0.0.1:7890' }] });
  assert.equal(r.route, 'direct');
  assert.equal(r.commands.set, 'git config --global http.https://github.com/.proxy http://127.0.0.1:7890');
  assert.equal(r.commands.unset, 'git config --global --unset http.https://github.com/.proxy');
  assert.equal(r.commands.placeholder, false);
  assert.equal(r.probe.ok, true);
  assert.deepEqual(e.calls.at(-1), ['ls-remote', '--heads', 'https://github.com/a/dsh-sync.git', 'refs/heads/main']);
});

test('without a listening proxy port the command carries a visible placeholder', async () => {
  const r = await checkNetwork(engine({ remote: '' }), quiet);
  assert.equal(r.label, 'GitHub');
  assert.match(r.commands.set, /端口号$/);
  assert.equal(r.commands.placeholder, true);
  assert.equal(r.probe, null);
});

test('proxy sources are reported in Git precedence order, with credentials hidden', async () => {
  const remote = 'https://github.com/a/b.git';
  let r = await checkNetwork(
    engine({ remote, proxy: 'http://u:p@10.0.0.2:8080' }, { gitProxy: 'http://127.0.0.1:7890' }),
    quiet,
  );
  assert.deepEqual([r.route, r.source, r.proxy], ['proxy', 'git-config', 'http://127.0.0.1:7890']);
  r = await checkNetwork(engine({ remote, proxy: 'http://u:p@10.0.0.2:8080' }), quiet);
  assert.deepEqual([r.source, r.proxy], ['manual', 'http://[已隐藏]@10.0.0.2:8080']);
  r = await checkNetwork(engine({ remote }), { ...quiet, env: { HTTPS_PROXY: 'http://127.0.0.1:1' } });
  assert.equal(r.source, 'env');
  r = await checkNetwork(engine({ remote }), { ...quiet, readSystem: () => ({ https: 'http://127.0.0.1:2' }) });
  assert.deepEqual([r.source, r.proxy], ['system', 'http://127.0.0.1:2']);
  assert.equal(r.commands, null);
});

test('domestic hosts and SSH remotes get no proxy command', async () => {
  let r = await checkNetwork(engine({ remote: 'https://gitee.com/a/b.git' }), quiet);
  assert.equal(r.domestic, true);
  assert.equal(r.commands, null);
  r = await checkNetwork(engine({ remote: 'git@github.com:a/b.git' }), quiet);
  assert.equal(r.route, 'ssh');
  assert.equal(r.commands, null);
});

test('a failed connection test explains the category', async () => {
  const r = await checkNetwork(
    engine(
      { remote: 'https://github.com/a/b.git' },
      { probe: { code: 128, err: 'fatal: unable to access: Could not resolve host: github.com' } },
    ),
    quiet,
  );
  assert.equal(r.probe.ok, false);
  assert.equal(r.probe.title, '网络连接中断');
});

test('local proxy detection keeps the common-port order and the scheme of each port', async () => {
  const found = await localProxyCandidates(async p => p === 10808 || p === 7890);
  assert.deepEqual(found, [
    { port: 7890, url: 'http://127.0.0.1:7890' },
    { port: 10808, url: 'socks5://127.0.0.1:10808' },
  ]);
});
