// Inspect npm's actual selection, including automatically included files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const candidates = [process.env.npm_execpath,
  path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
const npm = candidates.find(file => fs.existsSync(file));
assert.ok(npm, 'Cannot find npm CLI');
const pack = JSON.parse(execFileSync(process.execPath,
  [npm, 'pack', '--dry-run', '--ignore-scripts', '--json'],
  { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 }))[0];
const files = new Set(pack.files.map(file => file.path));
const userDocs = new Set(['docs/README.md', 'docs/getting-started.md', 'docs/configuration.md',
  'docs/dsh-file-catalog.md', 'docs/dsh-0.2.1-rc.3-adaptation.md', 'docs/sync-content.md', 'docs/data-repair-0.20.1.md',
  'docs/release-0.20.0-validation.md', 'docs/release-0.20.1-validation.md', 'docs/release-0.20.2-validation.md', 'docs/release-0.20.3-validation.md', 'docs/release-0.20.4-validation.md', 'docs/local-0.20.3-validation.md', 'docs/local-storage.md']);
const metadata = new Set(['package.json', 'README.md', 'README.en.md', 'CHANGELOG.md',
  'LICENSE', 'icon.png', 'cordis.patch.yml', 'scripts/restart-dsh-desktop.ps1']);
for (const file of files) {
  assert.ok(!/(?:work-laptop|MOLE-LAPTOP)/i.test(file), `Conflict copy in package: ${file}`);
  assert.ok(metadata.has(file) || userDocs.has(file) || file.startsWith('lib/') ||
    file.startsWith('docs/assets/'), `Development or historical file in package: ${file}`);
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const runtime = fs.readdirSync(path.join(root, 'lib'), { recursive: true })
  .map(name => 'lib/' + name.replaceAll('\\', '/'))
  .filter(file => fs.statSync(path.join(root, file)).isFile());
const required = [...metadata, ...userDocs, ...runtime, pkg.main, pkg.icon,
  pkg.dsh.bundle.patch, ...Object.values(pkg.exports)].map(file => file.replace(/^\.\//, ''));
for (const file of required) assert.ok(files.has(file), `Required file missing: ${file}`);
assert.ok(fs.readFileSync(path.join(root, pkg.dsh.bundle.patch), 'utf8').includes(pkg.name),
  'Bundle patch must register the package');
let links = 0;
for (const file of files) {
  if (!file.endsWith('.md')) continue;
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (/^(?:[a-z][\w+.-]*:|#|\/\/)/i.test(target)) continue;
    const local = decodeURIComponent(target.split(/[?#]/)[0]);
    if (!local) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), local));
    assert.ok(files.has(resolved), `Broken package link: ${file} -> ${target}`);
    links++;
  }
}
console.log(JSON.stringify({ ok: true, files: files.size, unpackedSize: pack.unpackedSize,
  requiredFiles: new Set(required).size, checkedLocalLinks: links }, null, 2));
