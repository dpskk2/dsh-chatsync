// Fast check for the edit loop: runs only the tests and checks affected by the
// files changed since a Git ref (default HEAD, i.e. uncommitted, staged and
// untracked files). It does not replace `npm test`, which still runs before a
// commit batch, nor the release regression.
//
// Module A depends on file B when A contains a quoted relative path that
// resolves to B or to a directory holding B (imports, dynamic imports,
// `new URL('./x', import.meta.url)`, copied directories), or when A mentions B's
// file name after a quote, slash or space (workers and scripts started by path,
// docs read by tests). Editing src/client/ counts as editing lib/client.js.
//
// By default a test is selected when it, or a helper or fixture under tests/ it
// uses, depends on a changed file, or when its name starts with the changed
// module's name (lib/scope.js -> tests/scope.test.mjs). Dependencies through
// other lib/ modules are not followed: lib/sync.js imports nearly every module,
// so following them selects almost the whole suite. A reference to a whole
// directory (tests/audit-0.20.2.test.mjs copies lib/) counts only with --deep,
// which also follows lib/ modules.
//
// Usage: node scripts/test-changed.mjs [--base <ref>] [--deep] [--list] [--concurrency <n>]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const graphDirs = ['lib', 'tests', 'scripts'];
const moduleFile = name => /\.(?:js|mjs)$/.test(name);
const testFile = file => /^tests\/[^/]+\.test\.mjs$/.test(file);
// Same globs as the format scripts in package.json.
const formatted = file =>
  /^(?:lib\/.+|tests\/.+)\.(?:js|mjs)$/.test(file) ||
  /^src\/client\/[^/]+\.js$/.test(file) ||
  /^scripts\/[^/]+\.mjs$/.test(file) ||
  file === 'eslint.config.js';
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Repository-relative paths changed since `base`, plus untracked files; deleted files included. */
export function changedFiles(root, base = 'HEAD') {
  // Line-ending warnings are noise here; a failing command still throws with its stderr.
  const git = args =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      .split('\0')
      .filter(Boolean);
  const files = new Set([
    ...git(['diff', '--name-only', '--no-renames', '-z', base, '--']),
    ...git(['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  return [...files].sort();
}

function listModules(root) {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir + '/' + entry.name;
      if (entry.isDirectory()) {
        if (rel !== 'lib/vendor') walk(rel);
      } else if (moduleFile(entry.name)) out.push(rel);
    }
  };
  for (const dir of graphDirs) if (fs.existsSync(path.join(root, dir))) walk(dir);
  return out;
}

function readModule(root, file) {
  // Regex sources such as /cli\.mjs/ name files with an escaped dot.
  const text = fs.readFileSync(path.join(root, file), 'utf8').replace(/\\\./g, '.');
  const targets = [];
  for (const [, spec] of text.matchAll(/['"`](\.{1,2}\/[^'"`\s]*)['"`]/g)) {
    targets.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)).replace(/\/$/, ''));
  }
  return { file, text, targets };
}

function dependsOn(module, file, deep) {
  if (module.targets.some(target => file === target || (deep && file.startsWith(target + '/')))) return true;
  return new RegExp(`['"\`/\\\\\\s]${escape(path.posix.basename(file))}(?![\\w.-])`).test(module.text);
}

const stem = file => path.posix.basename(file).replace(/\.[^.]+$/, '');

/**
 * Tests affected by `changed` (see the header), and the changed lib/ and
 * scripts/ modules that no selected test covers directly.
 */
export function selectTests(root, changed, { deep = false } = {}) {
  const affected = new Set(changed);
  if (changed.some(file => file.startsWith('src/client/'))) affected.add('lib/client.js');
  const modules = listModules(root)
    .filter(file => deep || file.startsWith('tests/'))
    .map(file => readModule(root, file));
  const reachedBy = new Map([...affected].map(file => [file, new Set([file])]));
  let frontier = [...affected];
  while (frontier.length) {
    const next = [];
    for (const module of modules) {
      if (affected.has(module.file)) continue;
      const sources = frontier.filter(file => dependsOn(module, file, deep));
      if (!sources.length) continue;
      affected.add(module.file);
      reachedBy.set(module.file, new Set(sources.flatMap(file => [...reachedBy.get(file)])));
      next.push(module.file);
    }
    frontier = next;
  }
  const tests = new Set([...affected].filter(testFile));
  const testNames = fs.existsSync(path.join(root, 'tests')) ? fs.readdirSync(path.join(root, 'tests')) : [];
  const covered = new Set([...tests].flatMap(test => [...reachedBy.get(test)]));
  for (const file of changed.filter(file => /^(?:lib|scripts)\/.+\.(?:js|mjs)$/.test(file))) {
    for (const name of testNames)
      if (name.startsWith(stem(file)) && testFile('tests/' + name)) {
        tests.add('tests/' + name);
        covered.add(file);
      }
  }
  if (covered.has('lib/client.js')) for (const file of changed) if (file.startsWith('src/client/')) covered.add(file);
  const uncovered = changed.filter(
    file => /^(?:lib\/(?!vendor\/)|scripts\/|src\/client\/).+\.(?:js|mjs)$/.test(file) && !covered.has(file),
  );
  return { tests: [...tests].sort(), uncovered };
}

/** The checks to run for `changed`: [label, entry script, args] for each. */
export function plan(root, changed, { concurrency = 2, deep = false } = {}) {
  const existing = changed.filter(file => fs.existsSync(path.join(root, file)));
  const steps = [];
  if (changed.some(file => file.startsWith('src/client/') || file === 'lib/client.js'))
    steps.push(['界面生成一致性', 'scripts/build-client.mjs', ['--check']]);
  const { tests, uncovered } = selectTests(root, changed, { deep });
  if (tests.length)
    steps.push([`相关测试 ${tests.length} 个文件`, '', ['--test', `--test-concurrency=${concurrency}`, ...tests]]);
  const lint = changed.includes('eslint.config.js')
    ? ['.']
    : existing.filter(file => moduleFile(file) && !file.startsWith('outputs/'));
  if (lint.length) steps.push(['ESLint', 'node_modules/eslint/bin/eslint.js', ['--no-warn-ignored', ...lint]]);
  const format = changed.some(file => file.startsWith('.prettier')) ? null : existing.filter(formatted);
  if (format === null) steps.push(['Prettier 格式', 'node_modules/prettier/bin/prettier.cjs', ['--check', '.']]);
  else if (format.length)
    steps.push(['Prettier 格式', 'node_modules/prettier/bin/prettier.cjs', ['--check', ...format]]);
  if (changed.some(file => /^(?:lib|types)\//.test(file) || file === 'tsconfig.json'))
    steps.push(['类型检查', 'node_modules/typescript/bin/tsc', ['-p', 'tsconfig.json']]);
  return { tests, uncovered, steps };
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const args = process.argv.slice(2);
  const option = name => {
    const at = args.indexOf(name);
    if (at < 0) return undefined;
    if (!args[at + 1] || args[at + 1].startsWith('--')) throw new Error(`${name} 需要一个值`);
    return args.splice(at, 2)[1];
  };
  const base = option('--base') ?? 'HEAD';
  const concurrency = Number(option('--concurrency') ?? 2);
  const flags = ['--list', '--deep'];
  const list = args.includes('--list');
  const deep = args.includes('--deep');
  if (args.some(arg => !flags.includes(arg)) || !(concurrency >= 1))
    throw new Error('用法：node scripts/test-changed.mjs [--base <ref>] [--deep] [--list] [--concurrency <n>]');

  const changed = changedFiles(root, base);
  console.log(`相对 ${base} 改动 ${changed.length} 个文件`);
  if (!changed.length) return;
  const { tests, uncovered, steps } = plan(root, changed, { concurrency, deep });
  for (const test of tests) console.log('  ' + test);
  if (uncovered.length)
    console.log(
      '以下改动没有直接对应的测试，只有 --deep 或完整的 npm test 会经由其他模块覆盖：\n' +
        uncovered.map(file => '  ' + file).join('\n'),
    );
  if (!steps.length) {
    console.log('没有受影响的测试或检查。');
    return;
  }
  if (list) {
    for (const [label] of steps) console.log('将运行：' + label);
    return;
  }
  const results = [];
  for (const [label, entry, stepArgs] of steps) {
    console.log(`\n== ${label} ==`);
    const command = entry ? [path.join(root, entry), ...stepArgs] : stepArgs;
    const result = spawnSync(process.execPath, command, { cwd: root, stdio: 'inherit' });
    results.push([label, result.status === 0]);
  }
  console.log('');
  for (const [label, ok] of results) console.log(`${ok ? '通过' : '失败'}：${label}`);
  console.log('这只是改动相关的快速检查；提交一批改动前仍要运行完整的 npm test。');
  if (results.some(([, ok]) => !ok)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
