import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { apply } from '../lib/index.js';

function host(t, overrides = {}, inspect = () => {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-config-api-'));
  const routes = new Map(), cleanup = [];
  t.after(() => { cleanup.reverse().forEach(fn => fn()); fs.rmSync(home, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(home, 'dsh-sync.json'), JSON.stringify({ mode: 'manual', autoRepo: false, autoPullOnStart: false, autoPushOnExit: false, enabled: true }));
  inspect(home);
  apply({
    webServer: { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path); } },
    on() { return () => {}; },
    effect(fn) { cleanup.push(fn()); },
    logger: { info() {}, warn() {}, debug() {} },
  }, { home, patches: false, ...overrides });
  const request = async (endpoint, body) => {
    const req = new EventEmitter(); req.method = body ? 'POST' : 'GET';
    const result = new Promise(resolve => {
      routes.get('/dsh-sync/api/' + endpoint)(req, { writeHead() {}, end(value) { resolve(JSON.parse(value)); } });
    });
    if (body) { req.emit('data', JSON.stringify(body)); req.emit('end'); }
    return result;
  };
  request.routes = routes;
  return request;
}

test('legacy mode changes do not control lifecycle automation; master switch does',async t=>{
  const request=host(t);
  assert.equal((await request('status')).auto,true);
  assert.equal((await request('config',{mode:'auto'})).auto,true);
  assert.equal((await request('config',{mode:'manual'})).auto,true);
  assert.equal((await request('config',{enabled:false})).auto,false);
});

test('only GitHub connections are saved; invalid addresses preserve the old config', async t => {
  const request = host(t);
  const saved = await request('config', {remote:'https://github.com/alice/data.git',branch:'main',autoRepo:false});
  assert.equal(saved.ok,true);
  for(const remote of ['https://gitcode.com/alice/data','https://gitee.com/alice/data','https://token@github.com/alice/data','https://github.com.evil/alice/data']) {
    assert.equal((await request('config',{remote})).ok,false);
    assert.equal((await request('config')).config.remote,saved.config.remote);
  }
});

test('one automatic API field saves both legacy flags and reports host overrides', async t => {
  const request=host(t);
  assert.equal((await request('config')).config.automatic,true);
  const on=await request('config',{automatic:true,intervalSeconds:1200});
  assert.equal(on.auto,true); assert.equal(on.config.mode,'auto'); assert.equal(on.config.enabled,true);
  const off=await request('config',{automatic:false});
  assert.equal(off.auto,false); assert.equal(off.config.mode,'manual'); assert.equal(off.config.enabled,false);
  for(const automatic of [null,'yes',1]) assert.equal((await request('config',{automatic})).ok,false);
  assert.equal((await request('config',{automatic:true,mode:'manual'})).ok,false);
  const forced=host(t,{mode:'auto',enabled:false});
  assert.equal((await forced('config',{automatic:true})).config.automatic,false);
});

test('read-only preview and doctor do not initialize data, recovery rejects arbitrary paths', async t => {
  let home;
  const request = host(t, {}, dir => { home = dir; });
  const before = fs.readdirSync(home);
  assert.equal((await request('preview')).initialized, false);
  assert.equal((await request('doctor')).repositoryInitialized, false);
  assert.deepEqual((await request('recovery')).records, []);
  assert.equal((await request('preview', { fetch: true })).ok, false);
  assert.equal((await request('recovery/preview', { id: '../outside' })).ok, false);
  assert.equal((await request('recovery/restore', { id: '../outside', side: 'remote' })).ok, false);
  assert.equal((await request('conflict/preview', { path: '../outside', copy: '../secret' })).ok, false);
  assert.deepEqual(fs.readdirSync(home), before);
});

test('update route reports the running version and rejects mutation requests', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const current = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const newer = (Number(current.split('.')[0]) + 1) + '.0.0';
  globalThis.fetch = async url => ({ ok: true, json: async () => url.includes('registry.npmjs.org')
    ? { version: newer } : { tag_name: 'v' + newer, body: '新版本更新内容' } });
  const request = host(t);
  const result = await request('update');
  assert.equal(result.ok, true);
  assert.equal(result.currentVersion, JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  assert.equal(result.available, true);
  assert.equal(result.notes, '新版本更新内容');
  assert.match(result.command, /plugin --profile (web|desktop) update @dpskk2\/dsh-chatsync/);
  assert.equal((await request('update', { install: true })).ok, false);
});

test('content range API rejects nonboolean fields and persists the effective selection', async t => {
  let home;
  const request = host(t, {}, dir => { home = dir; });
  const before = fs.readFileSync(path.join(home, 'dsh-sync.json'));
  assert.equal((await request('config', { contentScope: { sessions: 'false' } })).ok, false);
  assert.deepEqual(fs.readFileSync(path.join(home, 'dsh-sync.json')), before);
  const selected = { sessions: true, attachments: false, settings: false };
  const saved = await request('config', { contentScope: selected });
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.config.contentScope, selected);
  assert.equal((await request('doctor')).repositoryInitialized, false);
  assert.equal((await request('preview')).initialized, false);
  assert.equal(fs.existsSync(path.join(home, '.chatsync-local')), false);
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
  for (const remote of ['https://github.com/alice/existing.git', 'git@github.com:alice/existing.git', 'ssh://git@github.com/alice/existing.git']) {
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
    { remote: 'https://token@github.com/alice/data' }, { remote: 'https://example.org/a/b' },
    { branch: '../bad' }, { branch: '-bad' }, { branch: '' }, { branch: 'a b' }, { autoRepo: 'false' },
  ]) {
    assert.equal((await request('config', patch)).ok, false, JSON.stringify(patch));
    assert.deepEqual((await request('config')).config, before);
  }
});

test('saving preferences never overwrites malformed existing JSON', async t => {
  let file;
  const request = host(t, {}, home => { file = path.join(home, 'dsh-sync.json'); });
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
  const request = host(t, {}, home => { file = path.join(home, 'dsh-sync.json'); });
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
  const request = host(t, {}, home => { file = path.join(home, 'dsh-sync.json'); });
  const before = fs.readFileSync(file, 'utf8');
  for (const patch of [{ enabled: 'yes' }, { intervalSeconds: 10 }, { intervalSeconds: 90000 }, { intervalSeconds: 'abc' }]) {
    const r = await request('config', patch);
    assert.equal(r.ok, false, JSON.stringify(patch));
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

/* 「正在生成」的会话在界面要显示**会话名**(现在按会话名显示,而不是 session-<uuid>)。 */
test('status reports active sessions with the projection title for the restart guide', async t => {
  const id = 'session-11111111-2222-3333-4444-555555555555';
  const request = host(t, {}, (home) => {
    const dir = path.join(home, 'sessions', 'g1', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.v3.jsonl.zstd'), 'placeholder');
    const cache = path.join(home, 'storages', 'session_projcache', 'sessions');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, id + '.json'), JSON.stringify({
      record: { identity: { createdAt: 1, cwd: 'C:\\work' }, rows: { title: { ver: 1, seq: 2, val: '0.20.1文本修正' } } },
    }), 'utf8');
  });
  const status = await request('status');
  assert.ok(status.activeSessionCount >= 1, JSON.stringify(status));
  assert.ok(status.activeSessionIds.includes(id));
  const entry = (status.activeSessions || []).find((s) => s.id === id);
  assert.ok(entry, 'status 应带上 activeSessions: ' + JSON.stringify(status.activeSessions));
  assert.equal(entry.name, '0.20.1文本修正');
});

test('removed independent backup routes are not registered', t => { const request=host(t);assert.equal([...request.routes.keys()].some(route=>route.includes('webdav')),false); });
