// Publish the same implementation under the requested install name, chatsync.
// The existing scoped package remains available for existing installations.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(process.argv[2] || path.join(root, 'work/short-package'));
const verify = process.argv[3] === '--verify';
if (process.argv.length > 4 || (process.argv[3] && !verify))
  throw Error('Usage: node scripts/pack-short-name.mjs <new output directory> [--verify]');
if (!['work', 'outputs'].some(dir => output.startsWith(path.join(root, dir) + path.sep)))
  throw Error('Output must stay under work/ or outputs/');
const stage = path.join(output, 'source');
if (fs.existsSync(stage)) throw Error('Use a new output directory');
fs.mkdirSync(stage, { recursive: true });
const pkg = JSON.parse(execFileSync('git', ['show', 'HEAD:package.json'], { cwd: root, encoding: 'utf8' }));
if (pkg.name !== '@dpskk2/dsh-chatsync') throw Error('Unexpected source identity');
const names = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
// `files` entries are paths, directories or single-segment globs such as locale/*.json.
const included = item =>
  item.includes('*')
    ? name =>
        new RegExp(
          '^' +
            item
              .split('*')
              .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
              .join('[^/]*') +
            '$',
        ).test(name)
    : name => name === item || name.startsWith(item + '/');
const selected = names.filter(
  name => pkg.files.some(item => included(item)(name)) || ['package.json', 'LICENSE'].includes(name),
);
for (const name of selected) {
  let bytes = execFileSync('git', ['show', 'HEAD:' + name], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  if (['lib/client.js', 'lib/updates.js', 'cordis.patch.yml'].includes(name))
    bytes = Buffer.from(
      bytes.toString().replaceAll('@dpskk2/dsh-chatsync', 'chatsync').replaceAll('@dpskk2%2Fdsh-chatsync', 'chatsync'),
    );
  const target = path.join(stage, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}
pkg.name = 'chatsync';
pkg.keywords = [...new Set(['chatsync', ...pkg.keywords])];
pkg.publishConfig = { access: 'public' };
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
const candidates = [
  process.env.npm_execpath,
  path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
].filter(Boolean);
const npm = candidates.find(file => fs.existsSync(file));
if (!npm) throw Error('Cannot find npm CLI');
const pack = JSON.parse(
  execFileSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', output], {
    cwd: stage,
    encoding: 'utf8',
  }),
)[0];
// Both names must ship the same files; only the identity changes above differ.
const scoped = JSON.parse(
  execFileSync(process.execPath, [npm, 'pack', '--dry-run', '--ignore-scripts', '--json'], {
    cwd: root,
    encoding: 'utf8',
  }),
)[0];
const listOf = p => JSON.stringify(p.files.map(f => f.path).sort());
if (listOf(pack) !== listOf(scoped)) throw Error('Short-name package files differ from the scoped package');
const file = path.join(output, pack.filename),
  sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.writeFileSync(path.join(output, 'pack.json'), JSON.stringify(pack, null, 2) + '\n');
const result = {
  name: pkg.name,
  version: pkg.version,
  file,
  sha256,
  identityChanges: ['package.json', 'cordis.patch.yml', 'lib/client.js', 'lib/updates.js'],
};
if (verify) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release-evidence', pkg.version, 'manifest.json')));
  if (manifest.shortPackageSha256 !== sha256) throw Error('Short-name package hash differs from release evidence');
}
console.log(JSON.stringify(result));
