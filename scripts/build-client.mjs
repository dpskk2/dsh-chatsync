// Builds lib/client.js, the browser bundle, from the ordered files in src/client/.
// The bundle is one factory registered through the host module loader:
// 00-loader-head.js and 99-loader-tail.js hold that shell verbatim, and every other
// file is a run of statements inside the factory, kept at column 0 so it can be
// parsed and formatted on its own. The build concatenates them in file-name order,
// indenting the statements by four spaces; it has no dependencies.
// --check compares the result with the committed bundle, ignoring line endings.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'src', 'client');
const target = path.join(root, 'lib', 'client.js');
const banner =
  '// 由 scripts/build-client.mjs 从 src/client/ 生成；请修改 src/client/ 后运行 node scripts/build-client.mjs。\n';
const shell = new Set(['00-loader-head.js', '99-loader-tail.js']);
const lf = text => text.replace(/\r\n/g, '\n');

function indent(name, text) {
  return text
    .split('\n')
    .map((line, i) => {
      // The indent would be added inside the string, changing its value.
      if ((line.replace(/\\./g, '').match(/`/g) || []).length % 2)
        throw new Error(`${name}:${i + 1} 含跨行模板字符串，构建会改变其内容；请改为单行或拼接`);
      return line ? '    ' + line : line;
    })
    .join('\n');
}

const parts = fs
  .readdirSync(source)
  .filter(name => name.endsWith('.js'))
  .sort();
for (const name of shell) if (!parts.includes(name)) throw new Error('src/client/ 缺少 ' + name);
if (parts[0] !== '00-loader-head.js' || parts.at(-1) !== '99-loader-tail.js')
  throw new Error('模块外壳必须是第一个和最后一个文件');
const output =
  banner +
  parts
    .map(name => {
      const text = lf(fs.readFileSync(path.join(source, name), 'utf8'));
      return shell.has(name) ? text : indent(name, text);
    })
    .join('');

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
