import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { scopeMirrorPath, settingsProjection, restoreLocalSettings, transportable } from '../lib/scope.js';
import { classifyFile } from '../lib/merge.js';
import { parseYaml, emitYaml } from '../lib/yaml.js';
import { removeFixture } from './helpers/fixture-cleanup.mjs';
import { hostSessionCatalog, decodeRecoverySession } from '../lib/session-recovery.js';

const profile = 'profiles/desktop/cordis.patch.yml';
const encode = value => Buffer.from(emitYaml(value));
const decode = value => { const parsed = parseYaml(value.toString()); assert.equal(parsed.ok, true); return parsed.value; };
const config = (doc, id) => doc.find(row => row.id === id).config;
function preferences(machine, fontSize = 18) {
  return [
    { id: 'ui-theme', config: { preference: 'dark', fontSize, codeFontSize: 15, terminalFontSize: 16,
      textFontFamily: 'Example Sans', codeFontFamily: 'monospace', terminalFontFamily: 'monospace' } },
    { id: 'ui-chat', config: { collapseTiming: 'next-input', transcriptView: 'detailed' } },
    { id: 'web', config: { searchProvider: 'deepseek-search-api', fetchProvider: 'deepseek-fetch-api' } },
    { id: 'web-deepseek-api', config: { apiKeyEnv: 'DEEPSEEK_API_KEY', apiKey: 'local-key-' + machine, count: 20 } },
    { id: 'llm-pi-ai', config: { providers: { example: { apiKeyEnv: 'EXAMPLE_API_KEY', baseURL: 'https://example.com/v1', models: [{ id: 'example-model', reasoningEfforts: { high: 'high' } }] } } } },
    { id: 'local-tools', config: { proxy: 'http://localhost:1234/' + machine, cwd: 'C:/' + machine,
      env: { HTTP_PROXY: machine, PRIVATE_TOKEN: 'local-env-' + machine }, headers: { Authorization: 'local-auth-' + machine },
      deviceId: machine, modelDirectory: 'C:/' + machine + '/models' } },
    { id: 'dsh-chatsync', config: { enabled: machine === 'a', remote: machine + '-repo', proxy: machine } },
  ];
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-rc3-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--bare', '-b', 'main', remote]);
  const put = (home, file, value) => { const target = path.join(home, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value); };
  const make = machine => {
    const home = path.join(root, machine); fs.mkdirSync(home);
    const engine = new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false });
    engine.verifyPrivateRemote = async () => ({ ok: true });
    return { home, engine, put: (file, value) => put(home, file, value), read: file => fs.readFileSync(path.join(home, file)) };
  };
  const sync = async (host, opts = {}) => {
    const result = await host.engine.syncOnce('rc3-fixture', { forceCommit: true, ...opts });
    assert.equal(result.error, undefined, JSON.stringify(result)); return result;
  };
  const remoteText = file => git(['--git-dir', remote, 'show', 'main:' + file]);
  return { root, remote, git, make, sync, remoteText };
}

test('official rc.3 codec retains plugin records and validates a local cwd transition after the fork boundary', async () => {
  const catalog = await hostSessionCatalog();
  const id = 'session-33333333-3333-3333-3333-333333333333';
  const header = { id, version: 4, createdAt: 1, isSeeded: false, delegationDepth: 0, cwd: 'C:/old/project' };
  const events = [
    { type: 'working-directory/change', seq: 0, time: 2, data: { cwd: 'C:/old/project/subdir' } },
    { type: 'plugin:fixture/state', seq: 1, time: 3, ignorable: true, data: { feature: 'example', value: 7 } },
  ];
  const seed = catalog.buildForkSeed(events, events.length - 1);
  seed.push({ type: 'working-directory/change', seq: seed.length, time: 4, data: { cwd: '/tmp/local-project' } });
  const forkHeader = { ...header, id: 'session-44444444-4444-4444-4444-444444444444',
    isSeeded: true, parentSession: id, cwd: '/tmp/local-project' };
  const bytes = Buffer.from([catalog.encodeHeader(forkHeader, events.length), ...seed.map(event => catalog.encodeEvent(event))].map(JSON.stringify).join('\n') + '\n');
  const restored = decodeRecoverySession(bytes, catalog);
  assert.deepEqual(restored.events, seed);
  assert.deepEqual(restored.events.slice(0, events.length), events);
  assert.equal(restored.inheritedEventCount, events.length);
});

test('rc.3 patch settings keep UI/model/search preferences and restore local fields after reorder', () => {
  const source = preferences('a'), local = preferences('b');
  const shared = settingsProjection(encode(source), profile).value;
  assert.doesNotMatch(shared.toString(), /local-key|local-env|local-auth|a-repo|C:\/a|localhost/);
  const restored = decode(restoreLocalSettings(encode(decode(shared).reverse()), encode(local), profile));
  assert.equal(config(restored, 'ui-theme').codeFontSize, 15);
  assert.equal(config(restored, 'web').searchProvider, 'deepseek-search-api');
  assert.equal(config(restored, 'web-deepseek-api').apiKeyEnv, 'DEEPSEEK_API_KEY');
  assert.equal(config(restored, 'web-deepseek-api').apiKey, 'local-key-b');
  assert.deepEqual(config(restored, 'local-tools'), config(local, 'local-tools'));
  assert.deepEqual(config(restored, 'dsh-chatsync'), config(local, 'dsh-chatsync'));
  assert.deepEqual(config(restored, 'llm-pi-ai'), config(source, 'llm-pi-ai'));
  const removed = decode(restoreLocalSettings(encode([{ id: 'llm', config: { providers: {} } }]),
    encode([{ id: 'llm', config: { providers: { removed: { apiKey: 'local-only' } } } }]), profile));
  assert.deepEqual(config(removed, 'llm').providers, {});
  assert.equal(classifyFile(profile), 'opaque');
  assert.equal(classifyFile('cordis.patch.yml'), 'opaque');
});

test('insert blocks use stable anchors; missing or duplicate identities cannot misplace secrets', () => {
  const local = encode([{ insert: [{ id: 'provider', config: { apiKey: 'local-only', model: 'old' } }] }]);
  const remote = encode([{ id: 'theme', config: { preference: 'dark' } }, { insert: [{ id: 'provider', config: { model: 'new' } }] }]);
  const restored = decode(restoreLocalSettings(remote, local, profile));
  assert.equal(restored[1].insert[0].config.apiKey, 'local-only');
  assert.equal(restored[1].insert[0].config.model, 'new');
  for (const doc of [
    [{ config: { apiKey: 'local-only' } }],
    [{ name: 'C:/local-plugin.mjs', config: {} }],
    [{ id: 'duplicate', config: { apiKey: 'local-only' } }, { id: 'duplicate' }],
    [{ insert: [{ id: 'provider', config: { apiKey: 'local-only' } }] }, { insert: [] }],
  ]) assert.throws(() => settingsProjection(encode(doc), profile), /唯一稳定标识/);
  for (const text of ['- id: a\n  config: !!js process.exit()\n', '- id: a\n  config: &a {}\n', '{}\n']) {
    assert.throws(() => settingsProjection(Buffer.from(text), profile), /不支持/);
  }
});

test('two isolated stores exchange current patches, preserve local automation, and keep imported backups and env off the remote', async t => {
  const h = fixture(t), a = h.make('a'), b = h.make('b');
  for (const host of [a, b]) {
    const name = path.basename(host.home);
    host.put(profile, encode(preferences(name)));
    host.put('cordis.patch.yml', encode([{ id: 'home-tools', config: { proxy: name, limit: 8 } }]));
    host.put('settings.yaml.imported', 'old-key: local-original-' + name);
    host.put('.env', 'HTTP_PROXY=local-proxy-' + name);
  }
  await h.sync(a); await h.sync(b);
  assert.equal(config(decode(b.read(profile)), 'web-deepseek-api').apiKey, 'local-key-b');
  assert.equal(config(decode(b.read(profile)), 'dsh-chatsync').enabled, false);
  assert.equal(config(decode(b.read('cordis.patch.yml')), 'home-tools').proxy, 'b');
  assert.equal(b.read('settings.yaml.imported').toString(), 'old-key: local-original-b');
  for (const name of [profile, 'cordis.patch.yml']) assert.doesNotMatch(h.remoteText(name), /local-key|local-env|local-auth|a-repo|b-repo|proxy:|C:\/a|C:\/b/);
  const files = h.git(['--git-dir', h.remote, 'ls-tree', '-r', '--name-only', 'main']).split('\n');
  assert.equal(files.includes('.env'), false); assert.equal(files.includes('settings.yaml.imported'), false);
  const changed = decode(b.read(profile)); config(changed, 'ui-theme').fontSize = 23;
  b.put(profile, encode(changed)); await h.sync(b); await h.sync(a);
  assert.equal(config(decode(a.read(profile)), 'ui-theme').fontSize, 23);
  assert.equal(config(decode(a.read(profile)), 'web-deepseek-api').apiKey, 'local-key-a');
  assert.equal(config(decode(a.read(profile)), 'dsh-chatsync').enabled, true);
  // The exit path uses exactly the same field projection.
  config(changed, 'ui-theme').fontSize = 24; b.put(profile, encode(changed));
  await h.sync(b, { uploadOnly: true }); await h.sync(a);
  assert.equal(config(decode(a.read(profile)), 'ui-theme').fontSize, 24);
});

test('old mirror hashes do not bypass new projection; legacy tracked backups are removed from new snapshots only', async t => {
  const h = fixture(t), a = h.make('a');
  a.put(profile, encode(preferences('a'))); await h.sync(a);
  const mirror = scopeMirrorPath(a.home, a.engine.loadConfig());
  // Simulate a pre-adaptation transfer tree and its unchanged source hash.
  fs.writeFileSync(path.join(mirror, profile), encode(preferences('a')));
  fs.writeFileSync(path.join(mirror, 'settings.yaml.imported'), 'old backup');
  h.git(['add', '-A'], mirror); h.git(['commit', '-m', 'legacy mirror fixture'], mirror);
  await h.sync(a);
  assert.doesNotMatch(h.remoteText(profile), /local-key-a|a-repo/);
  assert.equal(h.git(['--git-dir', h.remote, 'ls-tree', '-r', '--name-only', 'main']).includes('settings.yaml.imported'), false);
  assert.equal(transportable('settings.yaml.imported'), false);
});

test('a migrated store never recreates legacy settings.yaml from an old peer', async t => {
  const h = fixture(t), a = h.make('old'), b = h.make('migrated');
  a.put('settings.yaml', 'theme: old\n'); await h.sync(a);
  b.put('settings.yaml.imported', 'theme: saved-migration-original\n');
  b.put(profile, encode(preferences('b'))); await h.sync(b);
  assert.equal(fs.existsSync(path.join(b.home, 'settings.yaml')), false);
  assert.equal(h.remoteText('settings.yaml'), 'theme: old');
  assert.equal(b.read('settings.yaml.imported').toString(), 'theme: saved-migration-original\n');
});

test('settings off bypasses unsupported patches, preserves local bytes, and enabling fails before upload', async t => {
  const h = fixture(t), a = h.make('a');
  const raw = Buffer.from('- id: custom\n  config: !!js process.env.EXAMPLE\n');
  a.put(profile, raw); a.put('attachments/fixture.txt', 'attachment');
  a.engine.overrides.contentScope = { sessions: false, attachments: true, settings: false };
  await h.sync(a); assert.deepEqual(a.read(profile), raw);
  const head = h.git(['--git-dir', h.remote, 'rev-parse', 'main']);
  a.engine.overrides.contentScope.settings = true;
  const result = await a.engine.syncOnce('enable-settings', { forceCommit: true });
  assert.match(result.error, /不支持安全字段投影/);
  assert.equal(h.git(['--git-dir', h.remote, 'rev-parse', 'main']), head);
  assert.deepEqual(a.read(profile), raw);
});
