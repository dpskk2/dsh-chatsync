// Read official npm artifacts only. Does not install packages or load their code.
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const out = path.resolve(process.argv[2] || 'outputs/conflict-experience-20261021/catalog');
fs.mkdirSync(out, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error(url + ': ' + r.status);
  return r.json();
}
function entries(bytes) {
  const tar = gunzipSync(bytes),
    result = [];
  for (let i = 0; i + 512 <= tar.length;) {
    const name = tar
      .subarray(i, i + 100)
      .toString()
      .replace(/\0.*$/s, '');
    if (!name) break;
    const size =
      parseInt(
        tar
          .subarray(i + 124, i + 136)
          .toString()
          .replace(/\0.*$/s, '')
          .trim(),
        8,
      ) || 0;
    if (!Number.isSafeInteger(size) || size < 0 || i + 512 + size > tar.length) throw new Error('Invalid official tar');
    if (/\.(?:js|json|md)$/.test(name) && !name.includes('/types/'))
      result.push([name, tar.subarray(i + 512, i + 512 + size).toString('utf8')]);
    i += 512 + Math.ceil(size / 512) * 512;
  }
  return result;
}
const names = [
  'dsh',
  'dsh-app-boot',
  'dsh-settings',
  'dsh-workspace',
  'dsh-plugin-manager',
  'dsh-storage-json',
  'dsh-session-persistence-jsonl',
];
const metadata = Object.fromEntries(
  await Promise.all(names.map(async n => [n, await json('https://registry.npmjs.org/@deepseek-ai%2f' + n)])),
);
const versions = Object.keys(metadata.dsh.versions);
const tasks = versions.flatMap(version =>
  names.filter(n => metadata[n].versions?.[version]).map(name => ({ name, version })),
);
const packages = [];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (tasks.length) {
      const { name, version } = tasks.shift(),
        dist = metadata[name].versions[version].dist;
      const target = path.join(out, name + '-' + version + '.tgz');
      let bytes;
      if (fs.existsSync(target)) bytes = fs.readFileSync(target);
      else {
        const r = await fetch(dist.tarball, { signal: AbortSignal.timeout(45000) });
        if (!r.ok) throw new Error(dist.tarball);
        bytes = Buffer.from(await r.arrayBuffer());
        fs.writeFileSync(target, bytes);
      }
      if (dist.integrity) {
        const [algorithm, digest] = dist.integrity.split('-');
        if (createHash(algorithm).update(bytes).digest('base64') !== digest)
          throw new Error('Official integrity mismatch');
      }
      const sources = entries(bytes).filter(([file]) => /\/lib\/.+\.js$/.test(file));
      const hits = sources.flatMap(([file, text]) =>
        text
          .split('\n')
          .flatMap((line, i) =>
            /settings\.yaml|workspace\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|cordis\.patch\.yml|package\.json|importLegacyDocument|defineDomain\(|domainTable\(|session\.v|session\.jsonl/.test(
              line,
            )
              ? [{ file, line: i + 1, text: line.trim().slice(0, 500) }]
              : [],
          ),
      );
      const body = sources.map(([, text]) => text).join('\n');
      packages.push({
        name,
        version,
        url: dist.tarball,
        integrity: dist.integrity,
        sha256: hash(bytes),
        files: sources.map(([file, text]) => ({ file, sha256: hash(text) })),
        hits,
        legacySettingsImport: body.includes('importLegacyDocument'),
        workspaceDomain: /defineDomain\(/.test(body),
      });
    }
  }),
);
const catalog = {
  checkedAt: new Date().toISOString(),
  registry: 'https://registry.npmjs.org',
  versions: versions.map(version => {
    const rows = packages.filter(p => p.version === version);
    return {
      version,
      settings: rows.some(p => p.name === 'dsh-settings' && p.legacySettingsImport)
        ? 'profile-patch'
        : rows.some(p => p.name === 'dsh-settings' && p.hits.some(h => h.text.includes('settings.yaml')))
          ? 'settings-yaml'
          : 'unconfirmed',
      workspace: rows.some(p => p.name === 'dsh-workspace' && p.workspaceDomain) ? 'domain' : 'legacy',
      profile: rows.some(p => p.name === 'dsh-app-boot' && p.hits.some(h => h.text.includes('package.json')))
        ? 'manifest'
        : 'unconfirmed',
    };
  }),
  packages: packages.sort((a, b) => a.version.localeCompare(b.version) || a.name.localeCompare(b.name)),
};
fs.writeFileSync(path.join(out, 'official-catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
console.log(JSON.stringify({ versions: versions.length, packages: packages.length, layouts: catalog.versions }));
