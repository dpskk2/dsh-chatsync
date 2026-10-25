import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mergeCordisEntries, classifyFile } from '../lib/merge.js';
import { parseYaml, emitYaml } from '../lib/yaml.js';
import { SyncEngine } from '../lib/sync.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';

// DSH applies id patches by replacing the supplied fields of the entry with that id
// (dsh-app-boot applyEntryPatches), so distinct ids commute and can merge per entry.
// insert patches and repeated ids depend on order; those lists keep a whole side.
const entry = (id, config) => ({ name: '@deepseek-ai/dsh-' + id, id, config });
const yaml = list => emitYaml(list, { cordis: true });
const parsed = text => parseYaml(text, { cordis: true }).value;

test('cordis patch files merge per entry id', () => {
  assert.equal(classifyFile('cordis.patch.yml'), 'cordis-entries');
  assert.equal(classifyFile('profiles/desktop/cordis.patch.yml'), 'cordis-entries');
  const base = [entry('ui-theme', { theme: 'light' }), entry('default-model', { model: 'a' }), entry('permission', { mode: 'ask' })];
  const ours = [entry('ui-theme', { theme: 'dark' }), entry('default-model', { model: 'a' }), entry('permission', { mode: 'ask' })];
  const theirs = [entry('ui-theme', { theme: 'light' }), entry('default-model', { model: 'b' }), entry('search', { engine: 'x' })];
  const merged = mergeCordisEntries(yaml(base), yaml(ours), yaml(theirs));
  assert.equal(merged.ok, true);
  assert.deepEqual(merged.conflicts, []);
  // Each side's own change survives; the removal on one side wins over the unchanged other side.
  assert.deepEqual(parsed(merged.value), [entry('ui-theme', { theme: 'dark' }), entry('default-model', { model: 'b' }), entry('search', { engine: 'x' })]);
});

test('the same entry changed on both sides keeps this computer and reports the conflict', () => {
  const base = [entry('ui-theme', { theme: 'light' })];
  const merged = mergeCordisEntries(yaml(base), yaml([entry('ui-theme', { theme: 'dark' })]), yaml([entry('ui-theme', { theme: 'blue' })]));
  assert.equal(merged.ok, true);
  assert.deepEqual(merged.conflicts, ['ui-theme']);
  assert.deepEqual(parsed(merged.value), [entry('ui-theme', { theme: 'dark' })]);
});

test('without a common base, entries are united and differing ones keep this computer', () => {
  const merged = mergeCordisEntries(null, yaml([entry('a', { v: 1 }), entry('b', { v: 1 })]), yaml([entry('b', { v: 2 }), entry('c', { v: 1 })]));
  assert.equal(merged.ok, true);
  assert.deepEqual(merged.conflicts, ['b']);
  assert.deepEqual(parsed(merged.value), [entry('a', { v: 1 }), entry('b', { v: 1 }), entry('c', { v: 1 })]);
});

test('dynamic expressions keep their tag and are never evaluated while merging', () => {
  const base = '- id: theme\n  config:\n    preference: !!js "process.env.THEME"\n    fontSize: 19\n';
  const theirs = '- id: theme\n  config:\n    preference: !!js "process.env.THEME"\n    fontSize: 20\n- id: tool\n  config: !!js "(() => { throw new Error(\'must not run\'); })()"\n';
  const merged = mergeCordisEntries(base, base + '- id: llm\n  config:\n    apiKey: !!js "process.env.EXAMPLE_KEY"\n', theirs);
  assert.equal(merged.ok, true);
  assert.match(merged.value, /preference: !!js process\.env\.THEME/);
  assert.match(merged.value, /apiKey: !!js process\.env\.EXAMPLE_KEY/);
  assert.match(merged.value, /config: !!js \(\(\) => \{ throw new Error\('must not run'\); \}\)\(\)/);
  assert.match(merged.value, /fontSize: 20/);
});

test('order-dependent patch lists are not merged per entry', () => {
  const plain = yaml([entry('a', { v: 1 })]);
  assert.equal(mergeCordisEntries(plain, plain, yaml([{ insert: [entry('x', {})] }])).ok, false, 'insert patches');
  assert.equal(mergeCordisEntries(plain, yaml([entry('a', { v: 1 }), entry('a', { v: 2 })]), plain).ok, false, 'repeated ids');
  assert.equal(mergeCordisEntries(plain, plain, yaml([{ name: 'no-id', config: {} }])).ok, false, 'entries without id');
  assert.equal(mergeCordisEntries(plain, plain, 'not: [a list').ok, false, 'unreadable side');
});

test('two computers changing different plugin settings both keep both changes', { timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-cordis-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
  const make = name => {
    const home = path.join(root, name); fs.mkdirSync(home);
    const engine = new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false });
    engine.verifyPrivateRemote = async () => ({ ok: true });
    engine.hostDshVersion = () => '0.2.1-rc.3';
    return acceptFixturePreviews(attachFixturePersistence(engine));
  };
  const file = 'profiles/desktop/cordis.patch.yml';
  const write = (engine, list) => { const target = path.join(engine.home, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, yaml(list)); };
  const read = engine => parsed(fs.readFileSync(path.join(engine.home, file), 'utf8'));
  const sync = async engine => { const result = await engine.syncOnce('test', { forceCommit: true }); assert.equal(result.error, undefined, JSON.stringify(result)); };
  const a = make('a'), b = make('b');
  const start = [entry('ui-theme', { theme: 'light' })];
  write(a, start); await sync(a); await sync(b);
  assert.deepEqual(read(b), start);
  // Each computer configures a different plugin: both append at the end, which a
  // line-based Git merge reports as a conflict.
  write(a, [...start, entry('default-model', { model: 'a' })]);
  write(b, [...start, entry('permission', { mode: 'ask' })]);
  await sync(a); await sync(b); await sync(a);
  const expected = [entry('ui-theme', { theme: 'light' }), entry('permission', { mode: 'ask' }), entry('default-model', { model: 'a' })];
  assert.deepEqual(read(a), expected);
  assert.deepEqual(read(b), expected);
});
