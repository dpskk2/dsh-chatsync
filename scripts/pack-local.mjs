// Packs a local candidate from the registered sources into a new directory under
// outputs/. --short-name produces the `chatsync` package from the same files.
// Usage: node scripts/pack-local.mjs <outputs 下的新目录> [--short-name]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const shortName = args.includes('--short-name');
const positional = args.filter(arg => arg !== '--short-name');
if (positional.length !== 1 || args.length - positional.length > 1)
  throw new Error('用法：node scripts/pack-local.mjs <outputs 下的新目录> [--short-name]');
const outputs = path.join(root, 'outputs');
const outputRoot = path.resolve(positional[0]);
if (!outputRoot.toLowerCase().startsWith(outputs.toLowerCase() + path.sep))
  throw new Error('安装包与打包材料必须保存在维护目录的 outputs 内。');
const stage = path.join(outputRoot, 'pack-source');
if (fs.existsSync(stage)) throw new Error('打包目录已存在，请使用新的输出目录，避免覆盖旧材料。');

const listing = execFileSync(
  'git',
  ['-c', 'core.quotepath=false', '-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
);
const names = [...new Set(listing.split('\0'))]
  .filter(name => name && !/work-laptop|MOLE-LAPTOP/i.test(name) && !/^(?:outputs|node_modules|\.git)\//.test(name))
  .sort();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const required of ['package.json', pkg.main, 'lib/client.js'])
  if (!names.includes(required)) throw new Error('必需源码未纳入打包：' + required);

for (const name of names) {
  const source = path.resolve(root, name);
  if (!source.startsWith(root)) throw new Error('源码路径越界：' + name);
  if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) throw new Error('登记的源码不存在：' + name);
  const destination = path.join(stage, name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

if (shortName) {
  // Same identity change as scripts/pack-short-name.mjs, applied to the staged copy.
  const manifest = path.join(stage, 'package.json');
  const staged = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  if (staged.name !== '@dpskk2/dsh-chatsync') throw new Error('Unexpected source package identity');
  for (const file of ['lib/client.js', 'lib/updates.js', 'cordis.patch.yml']) {
    const target = path.join(stage, file);
    fs.writeFileSync(
      target,
      fs
        .readFileSync(target, 'utf8')
        .replaceAll('@dpskk2/dsh-chatsync', 'chatsync')
        .replaceAll('@dpskk2%2Fdsh-chatsync', 'chatsync'),
    );
  }
  staged.name = 'chatsync';
  staged.keywords = [...new Set(['chatsync', ...staged.keywords])];
  fs.writeFileSync(manifest, JSON.stringify(staged, null, 2) + '\n');
}

// Run npm's own CLI with this Node, as scripts/check-package-contents.mjs does.
const npm = [
  process.env.npm_execpath,
  path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
]
  .filter(Boolean)
  .find(file => fs.existsSync(file));
if (!npm) throw new Error('找不到 npm');
const packed = execFileSync(
  process.execPath,
  [npm, 'pack', '--ignore-scripts', '--pack-destination', outputRoot, '--json'],
  { cwd: stage, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
);
fs.writeFileSync(path.join(outputRoot, 'pack.json'), packed);
const [result] = JSON.parse(packed);
console.log(`已打包 ${result.name}@${result.version}：${path.join(outputRoot, result.filename)}`);
