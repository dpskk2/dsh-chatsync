import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine, resolveSyncConfig } from '../lib/sync.js';
import { scopeMirrorPath, settingsProjection, restoreLocalSettings } from '../lib/scope.js';
import { parseYaml, emitYaml, CordisExpression } from '../lib/yaml.js';
import { classifyFile } from '../lib/merge.js';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

const profile = 'profiles/desktop/cordis.patch.yml';
const encode = value => Buffer.from(emitYaml(value, { cordis: true }));
const decode = value => {
  const result = parseYaml(value.toString(), { cordis: true });
  assert.equal(result.ok, true, result.reason);
  return result.value;
};
const config = (doc, id) => doc.find(row => row.id === id).config;
function preferences(machine, fontSize = 18) {
  return [
    { id: 'ui-theme', config: { preference: 'dark', fontSize, codeFontSize: 15, textFontFamily: 'Example Sans' } },
    { id: 'web', config: { searchProvider: 'deepseek-search-api', count: 20 } },
    {
      id: 'llm',
      config: {
        providers: [
          {
            id: 'example',
            apiKeyEnv: 'EXAMPLE_KEY',
            apiKey: 'local-key-' + machine,
            baseURL: 'https://example.invalid/v1',
          },
        ],
      },
    },
    {
      id: 'local-tools',
      config: {
        proxy: 'local-proxy-' + machine,
        workspaceBase: 'C:/' + machine,
        cwd: 'shared-directory',
        deviceId: 'shared-device',
        command: 'example-command',
      },
    },
    {
      id: 'dsh-chatsync',
      config: { enabled: true, autoPullOnStart: true, autoPushOnExit: false, proxy: 'proxy-' + machine },
    },
  ];
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-rc3-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  git(['init', '--bare', '-b', 'main', remote]);
  const make = machine => {
    const home = path.join(root, machine);
    fs.mkdirSync(home);
    const engine = new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false, enabled: false });
    engine.verifyPrivateRemote = async () => ({ ok: true });
    return {
      home,
      engine,
      put(file, value) {
        const target = path.join(home, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, value);
      },
      read: file => fs.readFileSync(path.join(home, file)),
    };
  };
  const sync = async (host, opts = {}) => {
    const result = await host.engine.syncOnce('rc3-fixture', { forceCommit: true, ...opts });
    assert.equal(result.error, undefined, JSON.stringify(result));
    return result;
  };
  return { make, sync, remoteText: file => git(['--git-dir', remote, 'show', 'main:' + file]), git, remote };
}

test('rc.3 profile and global settings share preferences with the original local-field rules', () => {
  for (const file of [profile, 'cordis.patch.yml']) {
    const shared = settingsProjection(encode(preferences('a')), file).value;
    assert.doesNotMatch(shared.toString(), /local-key|local-proxy|proxy-a|C:\/a/);
    const source = decode(shared).reverse(),
      restored = decode(restoreLocalSettings(encode(source), encode(preferences('b')), file));
    assert.equal(config(restored, 'ui-theme').fontSize, 18);
    assert.equal(config(restored, 'web').searchProvider, 'deepseek-search-api');
    assert.equal(config(restored, 'llm').providers[0].apiKey, 'local-key-b');
    assert.equal(config(restored, 'local-tools').workspaceBase, 'C:/b');
    assert.equal(config(restored, 'local-tools').cwd, 'shared-directory');
    assert.equal(config(restored, 'local-tools').deviceId, 'shared-device');
    assert.equal(config(restored, 'dsh-chatsync').enabled, true);
    assert.equal(config(restored, 'dsh-chatsync').autoPushOnExit, false);
    assert.equal(config(restored, 'dsh-chatsync').proxy, 'proxy-b');
    assert.equal(classifyFile(file), 'cordis-entries');
  }
});
test('legal Cordis expressions and aliases roundtrip without evaluation or conversion to ordinary strings', () => {
  const raw = Buffer.from(
    '- id: theme\n  config:\n    preference: !!js "process.env.THEME"\n    fontSize: 19\n- id: llm\n  config:\n    apiKey: !!js "process.env.EXAMPLE_KEY"\n- id: tool\n  config: !!js "(() => { throw new Error(\'must not run\'); })()"\n',
  );
  const projected = settingsProjection(raw, profile).value,
    value = decode(projected);
  assert.ok(config(value, 'theme').preference instanceof CordisExpression);
  assert.equal(config(value, 'theme').preference.source, 'process.env.THEME');
  assert.doesNotMatch(projected.toString(), /EXAMPLE_KEY/);
  assert.match(projected.toString(), /!!js/);
  assert.ok(config(decode(restoreLocalSettings(projected, raw, profile)), 'llm').apiKey instanceof CordisExpression);
  const anchors = Buffer.from('- id: a\n  config: &defaults {fontSize: 20}\n- id: b\n  config: *defaults\n');
  assert.deepEqual(
    decode(settingsProjection(anchors, profile).value).map(v => v.config.fontSize),
    [20, 20],
  );
  assert.throws(() => settingsProjection(Buffer.from('- id: a\n  config: &a {loop: *a}\n'), profile), /不支持/);
});
test('insert blocks restore keys by identity and duplicate or missing identities cannot attach them elsewhere', () => {
  const local = encode([{ insert: [{ id: 'provider', config: { apiKey: 'local-key', model: 'old' } }] }]);
  const remote = encode([
    { id: 'theme', config: { preference: 'dark' } },
    { insert: [{ id: 'provider', config: { model: 'new' } }] },
  ]);
  assert.equal(decode(restoreLocalSettings(remote, local, profile))[1].insert[0].config.apiKey, 'local-key');
  for (const doc of [[{ config: { apiKey: 'x' } }], [{ id: 'dup', config: { apiKey: 'x' } }, { id: 'dup' }]])
    assert.throws(() => settingsProjection(encode(doc), profile), /唯一稳定标识/);
});
test('sync page lifecycle preferences are projected separately from connection credentials and local paths', () => {
  const remote = Buffer.from(
    JSON.stringify({
      remote: 'https://example.invalid/a',
      branch: 'a',
      enabled: false,
      lifecycleAutomation: 1,
      autoPullOnStart: false,
      proxy: 'proxy-a',
      workspaceBase: 'C:/a',
    }),
  );
  const local = Buffer.from(
    JSON.stringify({
      remote: 'https://example.invalid/b',
      branch: 'b',
      enabled: true,
      proxy: 'proxy-b',
      workspaceBase: 'C:/b',
    }),
  );
  const shared = settingsProjection(remote, 'dsh-sync.json').value;
  assert.doesNotMatch(shared.toString(), /example|proxy|C:\//);
  const restored = JSON.parse(restoreLocalSettings(shared, local, 'dsh-sync.json'));
  assert.equal(restored.enabled, false);
  assert.equal(restored.autoPullOnStart, false);
  assert.equal(restored.remote, 'https://example.invalid/b');
  assert.equal(restored.proxy, 'proxy-b');
  assert.equal(restored.workspaceBase, 'C:/b');
  const legacy = Buffer.from('{"mode":"manual","enabled":true}');
  const legacyShared = settingsProjection(legacy, 'dsh-sync.json').value;
  const appliedLegacy = JSON.parse(
    restoreLocalSettings(legacyShared, Buffer.from('{"enabled":true,"lifecycleAutomation":1}'), 'dsh-sync.json'),
  );
  assert.equal(resolveSyncConfig(appliedLegacy).enabled, false);
  assert.equal(legacy.toString(), '{"mode":"manual","enabled":true}');
});
test('two real Git stores exchange settings, expressions and automation preferences, including exit uploads', async t => {
  const h = fixture(t),
    a = h.make('a'),
    b = h.make('b');
  for (const [host, machine] of [
    [a, 'a'],
    [b, 'b'],
  ]) {
    host.put(profile, encode(preferences(machine)));
    host.put(
      'cordis.patch.yml',
      Buffer.from('- id: dynamic-theme\n  config:\n    preference: !!js "process.env.THEME"\n'),
    );
    host.put(
      'dsh-sync.json',
      JSON.stringify({
        enabled: true,
        lifecycleAutomation: 1,
        autoPullOnStart: true,
        proxy: 'local-' + machine,
        remote: 'https://example.invalid/' + machine,
      }),
    );
  }
  await h.sync(a);
  await h.sync(b);
  assert.equal(config(decode(b.read(profile)), 'llm').providers[0].apiKey, 'local-key-b');
  assert.ok(config(decode(b.read('cordis.patch.yml')), 'dynamic-theme').preference instanceof CordisExpression);
  assert.equal(JSON.parse(b.read('dsh-sync.json')).enabled, true);
  assert.equal(JSON.parse(b.read('dsh-sync.json')).proxy, 'local-b');
  assert.doesNotMatch(h.remoteText(profile), /local-key/);
  assert.doesNotMatch(h.remoteText('dsh-sync.json'), /proxy|example.invalid/);
  const changed = decode(b.read(profile));
  config(changed, 'ui-theme').fontSize = 23;
  config(changed, 'dsh-chatsync').enabled = false;
  b.put(profile, encode(changed));
  b.put('dsh-sync.json', JSON.stringify({ ...JSON.parse(b.read('dsh-sync.json')), enabled: false }));
  await h.sync(b, { uploadOnly: true });
  await h.sync(a);
  assert.equal(config(decode(a.read(profile)), 'ui-theme').fontSize, 23);
  assert.equal(config(decode(a.read(profile)), 'dsh-chatsync').enabled, false);
  assert.equal(JSON.parse(a.read('dsh-sync.json')).enabled, false);
  assert.equal(JSON.parse(a.read('dsh-sync.json')).proxy, 'local-a');
});
test('existing mirror hashes cannot bypass projection of old stored settings', async t => {
  const h = fixture(t),
    a = h.make('a');
  a.put(profile, encode(preferences('a')));
  await h.sync(a);
  const mirror = scopeMirrorPath(a.home, a.engine.loadConfig());
  fs.writeFileSync(path.join(mirror, profile), encode(preferences('a')));
  h.git(['add', '-A'], mirror);
  h.git(['commit', '-m', 'old mirror'], mirror);
  await h.sync(a);
  assert.doesNotMatch(h.remoteText(profile), /local-key-a|local-proxy-a/);
});
