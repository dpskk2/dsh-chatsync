import fs from 'node:fs';

const currentVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const PACKAGE = '@dpskk2/dsh-chatsync';
const RELEASES = 'https://github.com/dpskk2/dsh-chatsync/releases';
const REGISTRY = 'https://registry.npmjs.org/';
const stableVersion = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);

// Stable npm releases only. A local/prerelease build must never be downgraded.
export function isNewerVersion(latest, current) {
  const parse = v => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(v || '');
  const a = parse(latest),
    b = parse(current);
  if (!a || !b || a[4]) return false;
  for (let i = 1; i <= 3; i++) {
    if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]);
  }
  return Boolean(b[4]);
}

export function updateCommand(hostKind, version) {
  if (!stableVersion(version)) throw new Error('An exact stable update version is required');
  // Explicit versions let pnpm apply its per-version release-age exception. A bare
  // update may silently stay on the old version during the release-age window.
  const target = PACKAGE + '@' + version + ' --registry=' + REGISTRY;
  return hostKind === 'desktop'
    ? '& "$env:LOCALAPPDATA\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd" plugin --profile desktop update ' +
        target
    : 'dsh plugin --profile web update ' + target;
}

export function createUpdateChecker({ version = currentVersion, fetchImpl = fetch, now = Date.now } = {}) {
  let cached,
    expires = 0,
    pending;
  async function read(url) {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json', 'User-Agent': 'dsh-chatsync-update-check' },
    });
    if (!response.ok) throw new Error('update check unavailable');
    return response.json();
  }
  return function check(hostKind = 'web') {
    const finish = data => ({
      ...data,
      hostKind,
      ...(data.available ? { command: updateCommand(hostKind, data.latestVersion) } : {}),
    });
    if (cached && now() < expires) return Promise.resolve(finish(cached));
    if (!pending)
      pending = (async () => {
        try {
          const metadata = await read('https://registry.npmjs.org/@dpskk2%2Fdsh-chatsync/latest');
          const latest = metadata.version;
          if (!stableVersion(latest)) throw new Error('invalid version');
          let notes = '';
          if (isNewerVersion(latest, version)) {
            // Do not advertise a partially published version whose install tarball
            // has not become available yet. Never probe a metadata-supplied host.
            const tarball = REGISTRY + PACKAGE + '/-/' + PACKAGE.split('/').at(-1) + '-' + latest + '.tgz';
            if (metadata.name !== PACKAGE || metadata.dist?.tarball !== tarball)
              throw new Error('invalid package identity');
            const ready = await fetchImpl(tarball, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
            if (!ready.ok) throw new Error('update package unavailable');
            try {
              const release = await read('https://api.github.com/repos/dpskk2/dsh-chatsync/releases/tags/v' + latest);
              if (!release.draft && !release.prerelease && release.tag_name === 'v' + latest) {
                notes = typeof release.body === 'string' ? release.body.slice(0, 12000) : '';
              }
            } catch {
              /* npm is authoritative; missing release notes do not hide an update. */
            }
          }
          cached = {
            ok: true,
            currentVersion: version,
            latestVersion: latest,
            available: isNewerVersion(latest, version),
            notes,
            releaseUrl: RELEASES + '/tag/v' + latest,
          };
          expires = now() + 6 * 60 * 60 * 1000;
        } catch {
          cached = { ok: false, currentVersion: version, available: false };
          expires = now() + 10 * 60 * 1000;
        } finally {
          pending = null;
        }
        return cached;
      })();
    return pending.then(finish);
  };
}
