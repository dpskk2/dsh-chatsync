import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { parseYaml } from '../lib/yaml.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';

// Characterization of the transport repository's merge paths (_mainSync), fixed
// before the engine is split into modules. Each case diverges two transport
// copies on purpose so Git reports a conflict for the file type under test.
function pair(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-main-merge-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
  const make = name => {
    const home = path.join(root, name);
    fs.mkdirSync(home);
    const engine = acceptFixturePreviews(new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false }));
    engine._isolatedTransport = true;
    engine.verifyPrivateRemote = async () => ({ ok: true });
    return engine;
  };
  const put = (engine, file, value) => {
    const target = path.join(engine.home, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  };
  const read = (engine, file) => fs.readFileSync(path.join(engine.home, file), 'utf8');
  const shown = file => execFileSync('git', ['--git-dir', remote, 'show', 'main:' + file], { encoding: 'utf8' });
  const sync = async engine => {
    const result = await engine.syncOnce('characterize', { forceCommit: true });
    assert.equal(result.error, undefined, JSON.stringify(result));
    return result;
  };
  return { make, put, read, shown, sync };
}
const registry = workspaces =>
  JSON.stringify(
    {
      unit: { name: 'workspace', version: 2 },
      global: { initialized: true, workspaceIds: Object.keys(workspaces) },
      tables: { workspaces },
    },
    null,
    2,
  ) + '\n';
const workspace = (title, sessionIds = []) => ({ path: 'C:/projects/' + title, title, sessionIds });

test('a project registry changed on both computers keeps both projects', { timeout: 120000 }, async t => {
  const { make, put, read, shown, sync } = pair(t);
  const a = make('a'),
    b = make('b');
  put(a, 'storages/workspace.json', registry({ base: workspace('base') }));
  await sync(a);
  await sync(b);
  put(a, 'storages/workspace.json', registry({ base: workspace('base'), fromA: workspace('fromA') }));
  put(b, 'storages/workspace.json', registry({ base: workspace('base'), fromB: workspace('fromB') }));
  await sync(a);
  const merged = await sync(b);
  assert.equal(merged.pulled, 'merge');
  const result = JSON.parse(read(b, 'storages/workspace.json'));
  assert.deepEqual(Object.keys(result.tables.workspaces).sort(), ['base', 'fromA', 'fromB']);
  assert.deepEqual(JSON.parse(shown('storages/workspace.json')), result, 'the merged registry is what was uploaded');
});

test('a YAML settings file changed on both computers keeps both fields', { timeout: 120000 }, async t => {
  const { make, put, read, sync } = pair(t);
  const a = make('a'),
    b = make('b');
  put(a, 'settings.yaml', 'theme: light\nfontSize: 14\n');
  await sync(a);
  await sync(b);
  put(a, 'settings.yaml', 'theme: dark\nfontSize: 14\n');
  put(b, 'settings.yaml', 'theme: light\nfontSize: 18\n');
  await sync(a);
  await sync(b);
  const value = parseYaml(read(b, 'settings.yaml')).value;
  assert.equal(value.theme, 'dark');
  assert.equal(value.fontSize, 18);
});

test(
  'different files edited in the same project on two computers both arrive everywhere',
  { timeout: 120000 },
  async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-project-merge-'));
    t.after(() => removeFixture(root));
    const remote = path.join(root, 'remote.git');
    execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
    const make = name => {
      const home = path.join(root, name),
        project = path.join(root, name + '-project');
      fs.mkdirSync(home);
      fs.mkdirSync(project);
      const engine = new SyncEngine(home, { remote, autoRepo: false, workspaceSync: true });
      engine.verifyPrivateRemote = async () => ({ ok: true });
      const ws = { id: 'merge-workspace', title: 'Merge', path: project };
      engine.workspaces = () => [ws];
      return {
        engine,
        project,
        sync: async () => {
          const r = await engine.syncOnce('characterize', { forceCommit: true });
          assert.deepEqual(r.workspaces?.errors || [], [], JSON.stringify(r.workspaces));
          return r;
        },
      };
    };
    const write = (d, file, text) => fs.writeFileSync(path.join(d.project, file), text);
    const read = (d, file) => fs.readFileSync(path.join(d.project, file), 'utf8');
    const a = make('a'),
      b = make('b');
    write(a, 'shared.md', 'base\n');
    await a.sync();
    await b.sync();
    write(a, 'from-a.md', 'written on a\n');
    write(b, 'from-b.md', 'written on b\n');
    await a.sync();
    const merged = await b.sync();
    assert.equal(merged.workspaces.pulled, 1, JSON.stringify(merged.workspaces));
    await a.sync();
    for (const d of [a, b]) {
      assert.equal(read(d, 'shared.md'), 'base\n');
      assert.equal(read(d, 'from-a.md'), 'written on a\n');
      assert.equal(read(d, 'from-b.md'), 'written on b\n');
    }
    assert.equal(
      execFileSync('git', ['--git-dir', remote, 'show', 'ws/merge-workspace:from-b.md'], { encoding: 'utf8' }),
      'written on b\n',
    );
  },
);

test(
  'a new computer with its own history joins the remote, and same-name files take the remote version',
  { timeout: 120000 },
  async t => {
    const { make, put, read, sync } = pair(t);
    const a = make('a'),
      b = make('b');
    put(a, 'attachments/shared.txt', 'from the first computer\n');
    put(a, 'attachments/only-a.txt', 'a\n');
    await sync(a);
    // b builds an unrelated history before it ever contacts the remote.
    put(b, 'attachments/shared.txt', 'from the new computer\n');
    put(b, 'attachments/only-b.txt', 'b\n');
    execFileSync('git', ['init', '--initial-branch=main'], { cwd: b.home, stdio: 'ignore' });
    execFileSync('git', ['-c', 'user.name=b', '-c', 'user.email=b@invalid', 'add', '.'], {
      cwd: b.home,
      stdio: 'ignore',
    });
    execFileSync('git', ['-c', 'user.name=b', '-c', 'user.email=b@invalid', 'commit', '-m', 'unrelated start'], {
      cwd: b.home,
      stdio: 'ignore',
    });
    const joined = await sync(b);
    assert.equal(joined.pulled, 'merge');
    assert.deepEqual(joined.conflicts, ['attachments/shared.txt']);
    assert.equal(read(b, 'attachments/shared.txt'), 'from the first computer\n');
    assert.equal(read(b, 'attachments/only-a.txt'), 'a\n');
    assert.equal(read(b, 'attachments/only-b.txt'), 'b\n');
  },
);
