// Sync remotes: any Git host over HTTPS or SSH. GitHub repositories are checked
// through the GitHub API; other hosts by an anonymous read (see verifyPrivateRemote).
// A self-hosted SSH server, saved as such by the user, is not checked (experimental).

/** Shown whenever an address cannot be used as a sync remote. */
export const REMOTE_FORMAT_HINT =
  '请输入私有 Git 仓库的 HTTPS 或 SSH 地址（GitHub、Gitee、GitLab 等），不要包含访问令牌或密码。';

const HOST = '([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)';
const PORT = '(?::(\\d{1,5}))?';
const PATH = '([\\w.-]+(?:/[\\w.-]+)+)/?';
/** @type {{ transport: 'https'|'ssh', pattern: RegExp, keys: string[] }[]} */
const FORMS = [
  // https://host[:port]/owner/repo — userinfo (tokens, passwords) never matches
  { transport: 'https', pattern: new RegExp(`^https://${HOST}${PORT}/${PATH}$`, 'i'), keys: ['host', 'port', 'path'] },
  // ssh://[user@]host[:port]/owner/repo
  {
    transport: 'ssh',
    pattern: new RegExp(`^ssh://(?:([\\w.-]+)@)?${HOST}${PORT}/${PATH}$`, 'i'),
    keys: ['user', 'host', 'port', 'path'],
  },
  // user@host:owner/repo (scp-like)
  { transport: 'ssh', pattern: new RegExp(`^([\\w.-]+)@${HOST}:(?!/)${PATH}$`, 'i'), keys: ['user', 'host', 'path'] },
];

const LABELS = { 'github.com': 'GitHub', 'gitee.com': 'Gitee', 'gitlab.com': 'GitLab', 'codeberg.org': 'Codeberg' };

/** Shown when an address saved as a self-hosted server cannot be used. */
export const SELF_HOSTED_FORMAT_HINT =
  '请输入自建服务器仓库的 SSH 地址，例如 用户名@服务器地址:/srv/git/dsh-sync.git、用户名@服务器地址:dsh-sync.git 或 ssh://用户名@服务器地址:端口/srv/git/dsh-sync.git；不支持 HTTPS 地址、~ 路径和含密码的地址。';

// A server set up with `git init --bare`: SSH only, the repository at an absolute
// or home-relative path of any depth. ~ paths, credentials and .. are refused.
const SELF_HOSTED_FORMS = [
  {
    pattern: new RegExp(`^ssh://([\\w.-]+)@${HOST}${PORT}(/[\\w.-]+(?:/[\\w.-]+)*)/?$`, 'i'),
    keys: ['user', 'host', 'port', 'path'],
  },
  { pattern: new RegExp(`^([\\w.-]+)@${HOST}:(/?[\\w.-]+(?:/[\\w.-]+)*)/?$`, 'i'), keys: ['user', 'host', 'path'] },
];
function parseSelfHosted(text) {
  for (const { pattern, keys } of SELF_HOSTED_FORMS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const { port, path, host: rawHost } = Object.fromEntries(keys.map((key, i) => [key, match[i + 1]]));
    const host = rawHost.toLowerCase();
    // Hosting sites are checked for privacy through their own tabs; never bypass that here.
    if (LABELS[host]) return null;
    if (port && !(Number(port) > 0 && Number(port) < 65536)) return null;
    const parts = path.replace(/^\//, '').split('/');
    if (parts.some(p => !p || p === '.' || p === '..')) return null;
    const repo = parts.at(-1).replace(/\.git$/i, '');
    if (!repo) return null;
    return {
      host,
      provider: 'self-hosted',
      transport: 'ssh',
      label: host,
      owner: parts.slice(0, -1).join('/'),
      repo,
      fullName: path.replace(/\/+$/, ''),
      webUrl: null,
      probeUrl: null,
    };
  }
  return null;
}

/**
 * Parse a sync remote; null when it is not a credential-free HTTPS or SSH address.
 * With `selfHosted`, only the SSH forms of a self-hosted server are accepted.
 * @param {unknown} value
 * @param {{ selfHosted?: boolean }} [options]
 */
export function parseSyncRemote(value, { selfHosted = false } = {}) {
  const text = String(value || '').trim();
  if (selfHosted) return parseSelfHosted(text);
  for (const { transport, pattern, keys } of FORMS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const { user, port, path, host: rawHost } = Object.fromEntries(keys.map((key, i) => [key, match[i + 1]]));
    const host = rawHost.toLowerCase();
    if (port && !(Number(port) > 0 && Number(port) < 65536)) return null;
    const parts = path.replace(/\.git$/i, '').split('/');
    if (parts.some(p => !p || p === '.' || p === '..' || /\.git$/i.test(p))) return null;
    const github = host === 'github.com';
    // GitHub has exactly owner/repo and answers SSH as git@ only.
    if (github && (parts.length !== 2 || (transport === 'ssh' && user !== 'git') || port)) return null;
    const repo = parts.at(-1),
      owner = parts.slice(0, -1).join('/');
    const fullName = parts.join('/');
    const webBase = 'https://' + host + (transport === 'https' && port ? ':' + port : '');
    return {
      host,
      provider: github ? 'github' : 'git',
      transport,
      label: LABELS[host] || host,
      owner,
      repo,
      fullName,
      webUrl: webBase + '/' + fullName,
      // The address an anonymous read is tried against: the remote itself over
      // HTTPS, otherwise the same host and path over HTTPS.
      probeUrl: transport === 'https' ? text.replace(/\/+$/, '') : webBase + '/' + fullName + '.git',
    };
  }
  return null;
}

/** Web page of the sync repository and its host's name; null when the address is unusable. */
export function remoteWeb(remote) {
  const parsed = parseSyncRemote(remote);
  return parsed ? { url: parsed.webUrl, label: parsed.label } : null;
}

/**
 * Whether the configured remote was saved as a self-hosted server. The mark lives
 * only in this computer's dsh-sync.json and lapses once the address changes.
 * @param {{ remote?: string, selfHostedRemote?: string }} cfg
 */
export function isSelfHostedRemote(cfg) {
  const remote = String(cfg?.remote || '').trim();
  return Boolean(remote && typeof cfg.selfHostedRemote === 'string' && cfg.selfHostedRemote.trim() === remote);
}

/** The configured remote, parsed the way it was saved. */
export function parseConfiguredRemote(cfg) {
  return cfg?.remote ? parseSyncRemote(cfg.remote, { selfHosted: isSelfHostedRemote(cfg) }) : null;
}
