import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { changedFiles, plan, selectTests } from '../scripts/test-changed.mjs';

// A synthetic repository shaped like this one; only its own temp root is removed.
function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-test-changed-'));
  t.after(() => removeFixture(root));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

const project = {
  'lib/a.js': 'export const a = 1;\n',
  'lib/b.js': "import { a } from './a.js';\nexport const b = a;\n",
  'lib/worker.mjs': '',
  'lib/client.js': '',
  'lib/engine/run.js': "import { a } from '../a.js';\n",
  'lib/sync.js': "import './engine/run.js';\nimport './b.js';\n",
  'lib/host.js': "const worker = path.join(here, 'worker.mjs');\n",
  'src/client/10-view.js': '',
  'scripts/tool.mjs': '',
  'tests/helpers/use-b.mjs': "export * from '../../lib/b.js';\n",
  'tests/a.test.mjs': "import '../lib/a.js';\n",
  'tests/b.test.mjs': "import './helpers/use-b.mjs';\n",
  'tests/sync.test.mjs': "import '../lib/sync.js';\n",
  'tests/worker.test.mjs': 'assert.match(xml, /worker\\.mjs/);\n',
  'tests/client.test.mjs': "fs.readFileSync(new URL('../lib/client.js', import.meta.url));\n",
  'tests/copy.test.mjs': "fs.cpSync(new URL('../lib', import.meta.url), target);\n",
  'tests/tool-usage.test.mjs': '',
  'tests/docs.test.mjs': "read('README.md');\n",
};

test('direct mode selects tests that use a changed file, not those reaching it through lib modules', t => {
  const root = fixture(t, project);
  assert.deepEqual(selectTests(root, ['lib/a.js']), { tests: ['tests/a.test.mjs'], uncovered: [] });
  // Through a tests/ helper is still direct.
  assert.deepEqual(selectTests(root, ['lib/b.js']).tests, ['tests/b.test.mjs']);
  // A file name mentioned in a regex, and an edited test itself.
  assert.deepEqual(selectTests(root, ['lib/worker.mjs']).tests, ['tests/worker.test.mjs']);
  assert.deepEqual(selectTests(root, ['tests/a.test.mjs']).tests, ['tests/a.test.mjs']);
  assert.deepEqual(selectTests(root, ['README.md']).tests, ['tests/docs.test.mjs']);
});

test('deep mode follows lib modules and whole-directory references', t => {
  const root = fixture(t, project);
  assert.deepEqual(selectTests(root, ['lib/a.js'], { deep: true }).tests, [
    'tests/a.test.mjs',
    'tests/b.test.mjs',
    'tests/copy.test.mjs',
    'tests/sync.test.mjs',
  ]);
  assert.deepEqual(selectTests(root, ['lib/worker.mjs'], { deep: true }).tests, [
    'tests/copy.test.mjs',
    'tests/worker.test.mjs',
  ]);
});

test('tests named after a module are selected and modules without direct tests are reported', t => {
  const root = fixture(t, project);
  assert.deepEqual(selectTests(root, ['scripts/tool.mjs']), { tests: ['tests/tool-usage.test.mjs'], uncovered: [] });
  assert.deepEqual(selectTests(root, ['lib/engine/run.js', 'lib/host.js']), {
    tests: [],
    uncovered: ['lib/engine/run.js', 'lib/host.js'],
  });
  assert.deepEqual(selectTests(root, ['lib/engine/run.js'], { deep: true }).uncovered, []);
});

test('client source edits select the tests of the generated bundle and the build check', t => {
  const root = fixture(t, project);
  const result = plan(root, ['src/client/10-view.js']);
  assert.deepEqual(result.tests, ['tests/client.test.mjs']);
  assert.deepEqual(result.uncovered, []);
  assert.deepEqual(
    result.steps.map(([label]) => label),
    // ESLint gets the file and applies its own ignore list to src/client/.
    ['界面生成一致性', '相关测试 1 个文件', 'ESLint', 'Prettier 格式'],
  );
});

test('plan runs lint, format and type checks only on what changed', t => {
  const root = fixture(t, project);
  const steps = Object.fromEntries(plan(root, ['lib/a.js', 'lib/gone.js', 'notes.md']).steps.map(([l, , a]) => [l, a]));
  // The deleted file is not handed to ESLint or Prettier.
  assert.deepEqual(steps['ESLint'], ['--no-warn-ignored', 'lib/a.js']);
  assert.deepEqual(steps['Prettier 格式'], ['--check', 'lib/a.js']);
  assert.deepEqual(steps['类型检查'], ['-p', 'tsconfig.json']);
  assert.deepEqual(steps['相关测试 1 个文件'], ['--test', '--test-concurrency=2', 'tests/a.test.mjs']);
  assert.deepEqual(plan(root, ['docs/guide.md']).steps, []);
});

test('changed files include staged, unstaged, deleted and untracked files, including Chinese names', t => {
  const root = fixture(t, { 'lib/a.js': '1\n', 'lib/b.js': '1\n', 'lib/c.js': '1\n', '.gitignore': 'ignored/\n' });
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe', windowsHide: true });
  git(['init']);
  git(['config', 'user.name', 'Changed files fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  git(['config', 'core.autocrlf', 'false']);
  git(['add', '.']);
  git(['commit', '-m', 'fixture']);
  fs.writeFileSync(path.join(root, 'lib/a.js'), '2\n');
  fs.writeFileSync(path.join(root, 'lib/b.js'), '2\n');
  git(['add', 'lib/b.js']);
  fs.rmSync(path.join(root, 'lib/c.js'));
  fs.writeFileSync(path.join(root, '说明.md'), '新\n');
  fs.mkdirSync(path.join(root, 'ignored'));
  fs.writeFileSync(path.join(root, 'ignored/x.js'), '');
  assert.deepEqual(changedFiles(root), ['lib/a.js', 'lib/b.js', 'lib/c.js', '说明.md']);
  git(['add', '-A']);
  git(['commit', '-m', 'second']);
  assert.deepEqual(changedFiles(root), []);
  assert.deepEqual(changedFiles(root, 'HEAD~1'), ['lib/a.js', 'lib/b.js', 'lib/c.js', '说明.md']);
});
