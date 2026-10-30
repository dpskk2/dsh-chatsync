import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { apply } from '../lib/index.js';
import { SyncEngine } from '../lib/sync.js';
import { RecoveryStore } from '../lib/recovery.js';

test('recovery API explains saved records and identifies the actual build', async t => {
  const request = host(t, {}, home => {
    const store = new RecoveryStore(home);
    const saved = store.save(
      { kind: 'main', path: 'storages/sync-meta/profiles/web/package.json.vmap.json' },
      { local: Buffer.from('a'), remote: Buffer.from('b') },
    );
    store.finish(saved.id, { status: 'merged', kept: 'remote' });
  });
  const result = await request('recovery');
  assert.equal(result.ok, true);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].guide.decision, 'none');
  assert.equal(result.records[0].kept, 'remote');
  assert.equal(
    (await request('status')).buildRevision,
    JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).chatsyncBuild,
  );
});

test('recovery archiving is reversible and corrupt or incomplete records remain visible', async t => {
  let saved;
  const request = host(t, {}, home => {
    const store = new RecoveryStore(home);
    saved = store.save(
      { kind: 'main', path: 'settings.yaml', status: 'merged' },
      { local: Buffer.from('a'), remote: Buffer.from('b') },
    );
  });
  const body = {
    id: saved.id,
    expectedVersions: Object.fromEntries(['local', 'remote'].map(s => [s, saved.versions[s].sha256])),
  };
  assert.equal((await request('recovery/archive', { ...body, expectedVersions: { local: 'stale' } })).ok, false);
  assert.equal((await request('recovery/archive', body)).ok, true);
  assert.equal((await request('recovery')).records[0].category, 'history');
  assert.equal((await request('recovery/archive', { id: saved.id, archived: false })).ok, true);
  assert.equal((await request('recovery')).records[0].category, 'attention');
});

test('status exposes current repair verification even with no prior sync and clears after acknowledgment', async t => {
  const request = host(t, {}, home => {
    const folder = path.join(home, '.chatsync-local/data-repair');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'verification.json'), '["completed-plan"]');
  });
  assert.equal((await request('status')).dataVerificationPending, true);
  const blocked = await request('run', {});
  assert.equal(blocked.ok, false);
  assert.equal(blocked.detail.dataVerificationPending, true);
  assert.equal((await request('status')).lastDetail.dataVerificationPending, true);
  assert.equal((await request('data-health/verify', {})).ok, true);
  assert.equal((await request('status')).dataVerificationPending, false);
});

test('the manual restart endpoint is removed while data repair remains available', t => {
  const request = host(t);
  assert.equal(request.routes.has('/dsh-sync/api/restart'), false);
  assert.equal(request.routes.has('/dsh-sync/api/data-health/scan'), true);
});

test('local grouping diagnosis is available without a configured sync remote', async t => {
  const request = host(t, { autoRestartAfterRepair: true });
  const result = await request('grouping');
  assert.equal(result.ok, true);
  assert.equal(result.enabled, true);
  assert.equal(result.count, 0);
  assert.equal(result.busy, false);
  assert.equal(result.issueKey, null);
});

function host(t, overrides = {}, inspect = () => {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-config-api-'));
  const routes = new Map(),
    cleanup = [];
  t.after(() => {
    cleanup.reverse().forEach(fn => fn());
    fs.rmSync(home, { recursive: true, force: true });
  });
  fs.writeFileSync(
    path.join(home, 'dsh-sync.json'),
    JSON.stringify({ mode: 'manual', autoRepo: false, autoPullOnStart: false, autoPushOnExit: false, enabled: true }),
  );
  inspect(home);
  apply(
    {
      webServer: {
        register(route) {
          routes.set(route.path, route.handler);
          return () => routes.delete(route.path);
        },
      },
      on() {
        return () => {};
      },
      effect(fn) {
        cleanup.push(fn());
      },
      logger: { info() {}, warn() {}, debug() {} },
    },
    { home, patches: false, ...overrides },
  );
  const request = async (endpoint, body) => {
    const req = new EventEmitter();
    req.method = body ? 'POST' : 'GET';
    const result = new Promise(resolve => {
      routes.get('/dsh-sync/api/' + endpoint)(req, {
        writeHead() {},
        end(value) {
          resolve(JSON.parse(value));
        },
      });
    });
    if (body) {
      req.emit('data', JSON.stringify(body));
      req.emit('end');
    }
    return result;
  };
  request.routes = routes;
  return request;
}

test('legacy mode changes do not control lifecycle automation; master switch does', async t => {
  const request = host(t);
  assert.equal((await request('status')).auto, true);
  assert.equal((await request('config', { mode: 'auto' })).auto, true);
  assert.equal((await request('config', { mode: 'manual' })).auto, true);
  assert.equal((await request('config', { enabled: false })).auto, false);
});

test('credential-free Git connections on any host are saved; invalid addresses preserve the old config', async t => {
  const request = host(t);
  const saved = await request('config', {
    remote: 'https://github.com/alice/data.git',
    branch: 'main',
    autoRepo: false,
  });
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.config.remoteWeb, { url: 'https://github.com/alice/data', label: 'GitHub' });
  for (const remote of [
    'https://token@github.com/alice/data',
    'https://user:secret@gitee.com/alice/data',
    'http://gitee.com/alice/data',
    'https://github.com/alice/data/extra',
    'git@gitee.com:/alice/data',
  ]) {
    assert.equal((await request('config', { remote })).ok, false, remote);
    assert.equal((await request('config')).config.remote, saved.config.remote);
  }
  const gitee = await request('config', { remote: 'git@gitee.com:alice/data.git' });
  assert.equal(gitee.ok, true);
  assert.deepEqual(gitee.config.remoteWeb, { url: 'https://gitee.com/alice/data', label: 'Gitee' });
});

test('one automatic API field saves both legacy flags and reports host overrides', async t => {
  const request = host(t);
  assert.equal((await request('config')).config.automatic, true);
  const on = await request('config', { automatic: true, intervalSeconds: 1200 });
  assert.equal(on.auto, true);
  assert.equal(on.config.mode, 'auto');
  assert.equal(on.config.enabled, true);
  const off = await request('config', { automatic: false });
  assert.equal(off.auto, false);
  assert.equal(off.config.mode, 'manual');
  assert.equal(off.config.enabled, false);
  for (const automatic of [null, 'yes', 1]) assert.equal((await request('config', { automatic })).ok, false);
  assert.equal((await request('config', { automatic: true, mode: 'manual' })).ok, false);
  const forced = host(t, { mode: 'auto', enabled: false });
  assert.equal(
    (await forced('config', { automatic: true })).config.automatic,
    true,
    'an explicit saved lifecycle choice takes precedence over host defaults',
  );
});

test('read-only preview and doctor do not initialize data, recovery rejects arbitrary paths', async t => {
  let home;
  const request = host(t, {}, dir => {
    home = dir;
  });
  const before = fs.readdirSync(home);
  assert.equal((await request('preview')).initialized, false);
  assert.equal((await request('doctor')).repositoryInitialized, false);
  assert.deepEqual((await request('recovery')).records, []);
  assert.equal((await request('preview', { fetch: true })).ok, false);
  assert.equal((await request('recovery/preview', { id: '../outside' })).ok, false);
  assert.equal((await request('recovery/restore', { id: '../outside', side: 'remote' })).ok, false);
  assert.deepEqual(fs.readdirSync(home), before);
});

test('update route reports the running version and rejects mutation requests', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const current = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const newer = Number(current.split('.')[0]) + 1 + '.0.0';
  let packageProbed = false;
  const tarball = 'https://registry.npmjs.org/@dpskk2/dsh-chatsync/-/dsh-chatsync-' + newer + '.tgz';
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'HEAD') {
      assert.equal(url, tarball);
      packageProbed = true;
      return { ok: true };
    }
    return {
      ok: true,
      json: async () =>
        url.includes('registry.npmjs.org')
          ? { name: '@dpskk2/dsh-chatsync', version: newer, dist: { tarball } }
          : { tag_name: 'v' + newer, body: '新版本更新内容' },
    };
  };
  const request = host(t);
  const result = await request('update');
  assert.equal(result.ok, true);
  assert.equal(
    result.currentVersion,
    JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
  );
  assert.equal(result.available, true);
  assert.equal(result.notes, '新版本更新内容');
  assert.equal(packageProbed, true);
  assert.ok(
    result.command.endsWith('update @dpskk2/dsh-chatsync@' + newer + ' --registry=https://registry.npmjs.org/'),
  );
  assert.match(result.command, /plugin --profile (web|desktop) update @dpskk2\/dsh-chatsync/);
  assert.equal((await request('update', { install: true })).ok, false);
});

test('content range API rejects nonboolean fields and persists the effective selection', async t => {
  let home;
  const request = host(t, {}, dir => {
    home = dir;
  });
  const before = fs.readFileSync(path.join(home, 'dsh-sync.json'));
  assert.equal((await request('config', { contentScope: { sessions: 'false' } })).ok, false);
  assert.deepEqual(fs.readFileSync(path.join(home, 'dsh-sync.json')), before);
  const selected = { sessions: true, attachments: false, settings: false };
  const saved = await request('config', { contentScope: selected });
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.config.contentScope, selected);
  const localDir = path.join(home, '.chatsync-local');
  const beforeDiagnostics = fs.readdirSync(localDir, { recursive: true }).sort();
  assert.ok(beforeDiagnostics.some(name => String(name).includes('config-history')));
  assert.equal((await request('doctor')).repositoryInitialized, false);
  assert.equal((await request('preview')).initialized, false);
  assert.deepEqual(
    fs.readdirSync(localDir, { recursive: true }).sort(),
    beforeDiagnostics,
    'read-only diagnostics do not create transport state',
  );
});

test('restart repair is enabled by default and preserves an explicit opt-out', async t => {
  const request = host(t);
  assert.equal((await request('config')).config.autoRestartAfterRepair, true);
  assert.equal((await request('config', { autoRestartAfterRepair: false })).config.autoRestartAfterRepair, false);
  assert.equal((await request('config')).config.autoRestartAfterRepair, false);
  assert.equal((await request('config', { autoRestartAfterRepair: true })).config.autoRestartAfterRepair, true);
});

test('connection API round trips HTTPS and SSH and preserves unrelated settings', async t => {
  const request = host(t);
  for (const remote of [
    'https://github.com/alice/existing.git',
    'git@github.com:alice/existing.git',
    'ssh://git@github.com/alice/existing.git',
  ]) {
    const result = await request('config', { remote, branch: 'sync/data', autoRepo: false });
    assert.equal(result.ok, true, result.error);
    const read = (await request('config')).config;
    assert.equal(read.remote, remote);
    assert.equal(read.branch, 'sync/data');
    assert.equal(read.autoPullOnStart, false);
  }
  const local = await request('config', { remote: '', autoRepo: false });
  assert.equal(local.config.remote, '');
  assert.equal(local.config.autoRepo, false);
});

test('invalid connections are rejected without changing existing configuration', async t => {
  const request = host(t);
  const before = (await request('config')).config;
  for (const patch of [
    { remote: 'https://token@github.com/alice/data' },
    { remote: 'http://example.org/a/b' },
    { remote: 'https://user:secret@example.org/a/b' },
    { branch: '../bad' },
    { branch: '-bad' },
    { branch: '' },
    { branch: 'a b' },
    { autoRepo: 'false' },
  ]) {
    assert.equal((await request('config', patch)).ok, false, JSON.stringify(patch));
    assert.deepEqual((await request('config')).config, before);
  }
});

test('saving preferences never overwrites malformed existing JSON', async t => {
  let file;
  const request = host(t, {}, home => {
    file = path.join(home, 'dsh-sync.json');
  });
  fs.writeFileSync(file, '{ broken');
  assert.equal((await request('config', { mode: 'auto' })).ok, false);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ broken');
});

test('overlapping connection and preference saves retain both changes', async t => {
  const request = host(t);
  const results = await Promise.all([
    request('config', { branch: 'sync/new' }),
    request('config', { workspaceSync: false }),
  ]);
  assert.ok(results.every(r => r.ok));
  const config = (await request('config')).config;
  assert.equal(config.branch, 'sync/new');
  assert.equal(config.workspaceSync, false);
});

test('config response reports effective host overrides, not just saved preferences', async t => {
  const request = host(t, { mode: 'manual' });
  const result = await request('config', { mode: 'auto' });
  assert.equal(result.saved.mode, 'auto');
  assert.equal(result.config.mode, 'manual');
  assert.equal(result.auto, true, 'legacy mode does not disable lifecycle automation');
});

/* 「自动调度是什么意思」的另一半:界面必须能改它的开关与周期(原先只能手改 dsh-sync.json)。 */
test('auto scheduling can be toggled and its interval changed from the API', async t => {
  let file;
  const request = host(t, {}, home => {
    file = path.join(home, 'dsh-sync.json');
  });
  const off = await request('config', { enabled: false });
  assert.equal(off.ok, true, off.error);
  assert.equal(off.config.enabled, false);
  assert.equal(off.autoConfigured, false);
  assert.equal((await request('config')).config.enabled, false);

  const on = await request('config', { enabled: true, mode: 'auto', intervalSeconds: 600 });
  assert.equal(on.ok, true, on.error);
  assert.equal(on.config.enabled, true);
  assert.equal(on.config.intervalSeconds, 600);
  assert.equal(on.auto, true, '打开自动同步后调度器应真正运行');
  assert.equal(on.autoConfigured, true);

  const read = (await request('config')).config;
  assert.equal(read.intervalSeconds, 600);
  assert.equal(read.mode, 'auto');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).intervalSeconds, 600);
});

test('invalid scheduling values are rejected without changing the file', async t => {
  let file;
  const request = host(t, {}, home => {
    file = path.join(home, 'dsh-sync.json');
  });
  const before = fs.readFileSync(file, 'utf8');
  for (const patch of [
    { enabled: 'yes' },
    { intervalSeconds: 10 },
    { intervalSeconds: 90000 },
    { intervalSeconds: 'abc' },
  ]) {
    const r = await request('config', patch);
    assert.equal(r.ok, false, JSON.stringify(patch));
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

/* 「正在生成」的会话在界面要显示**会话名**(现在按会话名显示,而不是 session-<uuid>)。 */
test('status reports active sessions with the projection title for the restart guide', async t => {
  const id = 'session-11111111-2222-3333-4444-555555555555';
  const request = host(t, {}, home => {
    const dir = path.join(home, 'sessions', 'g1', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.v3.jsonl.zstd'), 'placeholder');
    const cache = path.join(home, 'storages', 'session_projcache', 'sessions');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(
      path.join(cache, id + '.json'),
      JSON.stringify({
        record: {
          identity: { createdAt: 1, cwd: 'C:\\work' },
          rows: { title: { ver: 1, seq: 2, val: '0.20.1文本修正' } },
        },
      }),
      'utf8',
    );
  });
  const status = await request('status');
  assert.ok(status.activeSessionCount >= 1, JSON.stringify(status));
  assert.ok(status.activeSessionIds.includes(id));
  const entry = (status.activeSessions || []).find(s => s.id === id);
  assert.ok(entry, 'status 应带上 activeSessions: ' + JSON.stringify(status.activeSessions));
  assert.equal(entry.name, '0.20.1文本修正');
});

test('removed independent backup routes are not registered', t => {
  const request = host(t);
  assert.equal(
    [...request.routes.keys()].some(route => route.includes('webdav')),
    false,
  );
});

test('connection API verifies a custom private destination while default setup stays offline', async t => {
  const calls = [];
  t.mock.method(SyncEngine.prototype, 'gh', async args => {
    calls.push(args);
    return { code: 0, out: '{"visibility":"PRIVATE","viewerPermission":"WRITE"}' };
  });
  const request = host(t);
  const custom = await request('connection', { remote: 'https://github.com/team/dsh-sync2.git', expectedRemote: '' });
  assert.equal(custom.ok, true);
  assert.equal(custom.config.autoRepo, false);
  assert.equal((await request('config')).config.remote, custom.config.remote);
  assert.deepEqual(calls, [['repo', 'view', 'team/dsh-sync2', '--json', 'visibility,viewerPermission']]);
  const defaults = await request('connection', { remote: '', expectedRemote: custom.config.remote });
  assert.equal(defaults.ok, true);
  assert.equal(defaults.config.remote, '');
  assert.equal(defaults.config.autoRepo, true);
  assert.equal(calls.length, 1);
  assert.equal((await request('connection', { remote: 'https://gitee.com/alice/data', expectedRemote: '' })).ok, false);
});

test('sidebar visibility defaults on, persists separately and validates boolean values', async t => {
  const request = host(t);
  const before = (await request('config')).config;
  assert.equal(before.showSidebarSync, true);
  const off = await request('config', { showSidebarSync: false });
  assert.equal(off.ok, true);
  assert.equal(off.config.showSidebarSync, false);
  const current = (await request('config')).config;
  assert.equal(current.showSidebarSync, false);
  for (const key of ['remote', 'branch', 'automatic', 'workspaceSync', 'autoPullOnStart', 'autoPushOnExit'])
    assert.equal(current[key], before[key]);
  for (const invalid of ['false', null, 0])
    assert.equal((await request('config', { showSidebarSync: invalid })).ok, false);
  assert.equal((await request('config')).config.showSidebarSync, false);
  assert.equal((await request('config', { showSidebarSync: true })).config.showSidebarSync, true);
});

test('sidebar-only writes remain available during synchronization without allowing transfer configuration changes', async t => {
  let engine;
  const original = SyncEngine.prototype.loadConfig;
  t.mock.method(SyncEngine.prototype, 'loadConfig', function () {
    engine = this;
    return original.call(this);
  });
  const request = host(t);
  engine.progress = { running: true };
  engine.inFlight = Promise.resolve();
  try {
    assert.equal((await request('config', { showSidebarSync: false })).ok, true);
    assert.equal((await request('config', { automatic: false })).ok, false);
    assert.equal(
      (await request('config', { showSidebarSync: true, remote: 'https://github.com/alice/data.git' })).ok,
      false,
    );
    const config = (await request('config')).config;
    assert.equal(config.showSidebarSync, false);
    assert.equal(config.remote, '');
  } finally {
    engine.inFlight = null;
    engine.progress = null;
  }
});

test('workspace history repair API requires an explicit POST preview and rejects arbitrary confirmation IDs', async t => {
  const request = host(t);
  assert.equal((await request('workspace-history/preview')).ok, false);
  assert.equal((await request('workspace-history/apply', { previewId: '../../arbitrary' })).ok, false);
  const result = await request('workspace-history/preview', { workspaceId: 'missing' });
  assert.equal(result.ok, false);
  assert.match(result.error, /连接仓库|项目/);
});

test('local storage API scans, saves retention and requires a concrete confirmed preview', async t => {
  let file;
  const request = host(t, {}, home => {
    file = path.join(home, '.chatsync-local/config-history/fixture.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'backup');
  });
  assert.equal((await request('local-storage/policy', { retentionDays: 0 })).ok, true);
  const scan = await request('local-storage/scan');
  assert.equal(scan.ok, true);
  const row = scan.items.find(item => item.path === file);
  assert.equal(row.protected, false);
  assert.equal((await request('local-storage/scan', { mutation: true })).ok, false);
  const preview = await request('local-storage/preview', { ids: [row.id] });
  assert.equal(preview.ok, true);
  assert.equal((await request('local-storage/apply', { token: preview.token })).ok, false);
  assert.equal(fs.existsSync(file), true);
  assert.equal((await request('local-storage/apply', { token: preview.token, confirm: true })).ok, true);
  assert.equal(fs.existsSync(file), false);
  assert.equal((await request('local-storage/policy', { retentionDays: -1 })).ok, false);
});
