// Builds lib/client.js, the browser bundle, from the ordered fragments in src/client/.
// The fragments share one factory scope registered through the host module loader,
// so the build only concatenates them in file-name order; it has no dependencies.
// --check compares the result with the committed bundle, ignoring line endings.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'src', 'client');
const target = path.join(root, 'lib', 'client.js');
const banner = '// 由 scripts/build-client.mjs 从 src/client/ 生成；请修改 src/client/ 后运行 node scripts/build-client.mjs。\n';
const lf = text => text.replace(/\r\n/g, '\n');

const parts = fs.readdirSync(source).filter(name => name.endsWith('.js')).sort();
if (!parts.length) throw new Error('src/client/ 中没有界面源文件');
const output = banner + parts.map(name => lf(fs.readFileSync(path.join(source, name), 'utf8'))).join('');

if (process.argv.includes('--check')) {
  const current = fs.existsSync(target) ? lf(fs.readFileSync(target, 'utf8')) : null;
  if (current !== output) {
    console.error('lib/client.js 与 src/client/ 不一致：请运行 node scripts/build-client.mjs 重新生成后一并提交。');
    process.exit(1);
  }
  console.log(`lib/client.js 与 src/client/ 一致（${parts.length} 个源文件）`);
} else {
  fs.writeFileSync(target, output);
  console.log(`已由 ${parts.length} 个源文件生成 lib/client.js`);
}
