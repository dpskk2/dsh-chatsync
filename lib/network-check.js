// Read-only check of how this computer reaches the sync repository: which proxy
// Git will use (if any), whether the repository answers, and — when nothing routes
// through a proxy — a command the user can paste to give Git one.
import net from 'node:net';
import { parseSyncRemote } from './remote.js';
import { readWindowsProxy } from './proxy-env.js';
import { describeGitFailure } from './git-failure.js';

const PROXY_NAMES = ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'HTTP_PROXY', 'http_proxy'];
// Hosts that mainland China reaches well without a proxy.
const DOMESTIC = new Set(['gitee.com', 'gitcode.com', 'coding.net', 'e.coding.net']);
// Local ports common proxy clients listen on, with the scheme Git should use for each.
export const COMMON_PROXY_PORTS = [
  [7890, 'http'],
  [7897, 'http'],
  [10809, 'http'],
  [2080, 'http'],
  [10808, 'socks5'],
  [1080, 'socks5'],
];

const hidden = value => String(value || '').replace(/\/\/[^/@\s]*@/, '//[已隐藏]@');

function portOpen(port, timeoutMs = 400) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = open => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** Local proxy ports that accept connections, most common first. */
export async function localProxyCandidates(probe = portOpen) {
  const open = await Promise.all(COMMON_PROXY_PORTS.map(([port]) => probe(port)));
  return COMMON_PROXY_PORTS.filter((_, i) => open[i]).map(([port, scheme]) => ({
    port,
    url: `${scheme}://127.0.0.1:${port}`,
  }));
}

/** Which proxy Git will use for `origin`, and where that setting comes from. */
async function gitRoute(engine, cfg, origin, env, readSystem) {
  // Git's own http.proxy (global or for this host) wins over environment variables.
  const configured = await engine.git(['config', '--get-urlmatch', 'http.proxy', origin + '/'], 10000);
  if (engine.ok(configured) && configured.out.trim())
    return { route: 'proxy', source: 'git-config', proxy: hidden(configured.out.trim()) };
  const manual = String(cfg.proxy || '').trim();
  if (manual && manual.toLowerCase() !== 'auto') return { route: 'proxy', source: 'manual', proxy: hidden(manual) };
  const inherited = PROXY_NAMES.map(name => env[name]).find(value => String(value || '').trim());
  if (inherited) return { route: 'proxy', source: 'env', proxy: hidden(inherited) };
  const system = readSystem();
  if (system.https || system.http)
    return { route: 'proxy', source: 'system', proxy: hidden(system.https || system.http) };
  return { route: 'direct', source: null, proxy: null };
}

export async function checkNetwork(
  engine,
  { candidates = localProxyCandidates, env = process.env, readSystem = readWindowsProxy } = {},
) {
  const cfg = engine.loadConfig();
  if (cfg.configError) throw new Error(cfg.configError);
  engine.applyProxyEnv(cfg);
  const parsed = cfg.remote ? parseSyncRemote(cfg.remote) : null;
  // The default backup is a GitHub repository created on first sync.
  const host = parsed?.host || 'github.com';
  const label = parsed?.label || 'GitHub';
  const result = {
    ok: true,
    host,
    label,
    domestic: DOMESTIC.has(host),
    transport: parsed?.transport || 'https',
    route: 'direct',
    source: null,
    proxy: null,
    probe: null,
    candidates: [],
    commands: null,
  };
  if (result.transport === 'ssh') {
    // HTTP proxies do not apply to SSH; whatever ~/.ssh/config sets is used instead.
    result.route = 'ssh';
  } else {
    const origin = parsed ? new URL(parsed.webUrl).origin : 'https://github.com';
    Object.assign(result, await gitRoute(engine, cfg, origin, env, readSystem));
    if (result.route === 'direct' && !result.domestic) {
      result.candidates = await candidates();
      const url = result.candidates[0]?.url || 'http://127.0.0.1:端口号';
      result.commands = {
        set: `git config --global http.${origin}/.proxy ${url}`,
        unset: `git config --global --unset http.${origin}/.proxy`,
        placeholder: !result.candidates.length,
      };
    }
  }
  if (cfg.remote) {
    const started = Date.now();
    const answer = await engine.git(['ls-remote', '--heads', cfg.remote, 'refs/heads/' + cfg.branch], 20000);
    const failure = engine.ok(answer) ? null : describeGitFailure(answer, 'fetch');
    result.probe = {
      ok: !failure,
      ms: Date.now() - started,
      ...(failure && { title: failure.title, reason: failure.reason, action: failure.action }),
    };
  }
  return result;
}
