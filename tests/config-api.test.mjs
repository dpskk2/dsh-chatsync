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
  fs.writeFileSync(path.join(home, 'dsh-sync.json'), JSON.stringify({ mode: 'manual', autoRepo: false, autoPullOnStart: false, autoPushOnExit: false }));
  inspect(home);
  apply({
    webServer: { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path); } },
    on() { return () => {}; },
    effect(fn) { cleanup.push(fn()); },
    logger: { info() {}, warn() {}, debug() {} },
  }, { home, patches: false, ...overrides });
  return async (endpoint, body) => {
    const req = new EventEmitter(); req.method = body ? 'POST' : 'GET';
    const result = new Promise(resolve => {
      routes.get('/dsh-sync/api/' + endpoint)(req, { writeHead() {}, end(value) { resolve(JSON.parse(value)); } });
    });
    if (body) { req.emit('data', JSON.stringify(body)); req.emit('end'); }
    return result;
  };
}

test('real config route enables and disables the running scheduler without restarting host', async t => {
  const request = host(t);
  assert.equal((await request('status')).auto, false);
  assert.equal((await request('config', { mode: 'auto' })).auto, true);
  assert.equal((await request('status')).auto, true);
  assert.equal((await request('config', { mode: 'manual' })).auto, false);
  assert.equal((await request('status')).auto, false);
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
  assert.equal(result.auto, false);
});
