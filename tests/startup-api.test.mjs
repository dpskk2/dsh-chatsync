import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { apply } from '../lib/index.js';
import { SyncEngine } from '../lib/sync.js';

test('startup can approve its exact pending transfer without leaving the modal', async t => {
  const id = 'a'.repeat(64), approvals = [];
  t.mock.method(SyncEngine.prototype, 'syncOnce', async (_reason, options) => {
    approvals.push(options.approval);
    return options.approval === id ? {} : { error: '等待确认预览', needsReview: true,
      review: { id, summary: '准备取回合成测试配置' } };
  });
  const request = host(t, { autoPullOnStart: true });
  await new Promise(resolve => setImmediate(resolve));
  const waiting = await request('status');
  assert.equal(waiting.startup.phase, 'review');
  assert.equal(waiting.startup.review.id, id);
  const stale = await request('startup', { action: 'confirm', approval: 'old-preview' });
  assert.equal(stale.ok, false); assert.match(stale.error, /预览已变化/);
  assert.deepEqual(approvals, [undefined]);
  await request('startup', { action: 'confirm', approval: id });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await request('status')).startup.phase, 'ready');
  assert.deepEqual(approvals, [undefined, id]);
});

test('a saved offline preview is recomputed on startup and can be left offline', async t => {
  let attempts = 0;
  t.mock.method(SyncEngine.prototype, 'syncOnce', async () => {
    attempts++; return { needsReview: true, error: '等待确认', review: { id: 'fresh', summary: '新的预览' } };
  });
  const request = host(t, { autoPullOnStart: true }, home => {
    fs.writeFileSync(path.join(home, '.dsh-sync-status.json'), JSON.stringify({ at: 1, source: 'startup-offline',
      result: { needsReview: true, error: '等待确认', review: { id: 'stale' } } }));
  });
  await new Promise(resolve => setImmediate(resolve));
  const state = (await request('status')).startup;
  assert.equal(attempts, 1); assert.equal(state.phase, 'review'); assert.equal(state.review.id, 'fresh');
  await request('startup', { action: 'offline' });
  assert.equal((await request('status')).startup.phase, 'offline');
});

test('confirmation of an old snapshot displays a new preview instead of reporting success', async t => {
  t.mock.method(SyncEngine.prototype, 'syncOnce', async (_reason, options) => ({ needsReview: true,
    error: '等待确认', review: { id: options.approval ? 'changed' : 'first', summary: '配置变化' } }));
  const request = host(t, { autoPullOnStart: true }); await new Promise(resolve => setImmediate(resolve));
  await request('startup', { action: 'confirm', approval: 'first' });
  await new Promise(resolve => setImmediate(resolve));
  const state = (await request('status')).startup;
  assert.equal(state.phase, 'review'); assert.equal(state.review.id, 'changed');
});

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
  }, { home, patches: false, ...(overrides.autoPullOnStart ? { remote: 'https://github.com/example/lifecycle-fixture.git' } : {}), ...overrides });
  return async (endpoint, body) => {
    const req = new EventEmitter(); req.method = body ? 'POST' : 'GET';
    const result = new Promise(resolve => {
      routes.get('/dsh-sync/api/' + endpoint)(req, { writeHead() {}, end(value) { resolve(JSON.parse(value)); } });
    });
    if (body) { req.emit('data', JSON.stringify(body)); req.emit('end'); }
    return result;
  };
}

test('manual cancellation targets exactly one run, waits for local work and never reports success', async t => {
  t.mock.method(SyncEngine.prototype, 'sessionActivity', () => ({ available: true, activeCount: 0 }));
  let finish;
  t.mock.method(SyncEngine.prototype, '_syncOnce', () => new Promise(resolve => { finish = resolve; }));
  const request = host(t);
  const running = request('run', {}); await new Promise(resolve => setImmediate(resolve));
  const progress = await request('progress'); assert.equal(progress.canCancel, true); assert.ok(progress.runId);
  assert.equal((await request('cancel', {})).ok, false);
  assert.equal((await request('cancel', { runId: 'stale' })).ok, false);
  assert.equal((await request('progress')).cancelling, false);
  const stopping = request('cancel', { runId: progress.runId });
  await new Promise(resolve => setImmediate(resolve));
  const pending = await request('progress'); assert.equal(pending.cancelling, true); assert.equal(pending.canCancel, false);
  assert.match(pending.label, /正在停止/);
  finish({ pushed: true, needsReview: true, review: { id: 'stale-preview' } });
  assert.equal((await stopping).ok, true);
  const result = await running;
  assert.equal(result.ok, false); assert.equal(result.detail.cancelled, true); assert.equal(result.detail.pushed, true);
  assert.equal(result.detail.needsReview, false); assert.equal(result.detail.review, undefined);
  assert.match(result.summary, /已完成的保存或上传保留/);
  assert.equal((await request('progress')).lastOk, false);
  const second = request('run', {}); await new Promise(resolve => setImmediate(resolve));
  const next = await request('progress'); assert.notEqual(next.runId, progress.runId);
  assert.equal((await request('cancel', { runId: progress.runId })).ok, false);
  assert.equal((await request('progress')).cancelling, false);
  finish({}); assert.equal((await second).ok, true);
  assert.equal((await request('cancel', { runId: next.runId })).ok, false);
});

test('manual cancellation cannot bypass the required startup offline choice', async t => {
  t.mock.method(SyncEngine.prototype, 'sessionActivity', () => ({ available: true, activeCount: 0 }));
  let finish;
  t.mock.method(SyncEngine.prototype, '_syncOnce', () => new Promise(resolve => { finish = resolve; }));
  const request = host(t, { autoPullOnStart: true }); await new Promise(resolve => setImmediate(resolve));
  const progress = await request('progress'); assert.equal(progress.canCancel, false);
  const blocked = await request('cancel', { runId: progress.runId }); assert.equal(blocked.ok, false); assert.match(blocked.error, /启动同步弹窗/);
  finish({}); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await request('status')).startup.phase, 'ready');
});

test('startup and exit protection round trip independently of manual mode', async t => {
  const request = host(t);
  const result = await request('config', { mode: 'manual', autoPullOnStart: true, autoPushOnExit: true });
  assert.equal(result.config.mode, 'manual');
  assert.equal(result.config.autoPullOnStart, true); assert.equal(result.config.autoPushOnExit, true);
  assert.equal((await request('status')).startup.required, false, 'new startup preference applies on the next host start');
});

test('required startup failure remains visible until retry or explicit offline choice', async t => {
  t.mock.method(SyncEngine.prototype, 'syncOnce', async () => ({ error: 'network offline' }));
  const request = host(t, { autoPullOnStart: true });
  await new Promise(resolve => setImmediate(resolve));
  const status = await request('status');
  assert.equal(status.startup.required, true); assert.equal(status.startup.phase, 'error');
  assert.match(status.startup.message, /network offline/);
  await request('startup', { action: 'offline' });
  assert.equal((await request('status')).startup.phase, 'offline');
});

test('required startup succeeds through retry without changing the manual preference', async t => {
  let failure = true;
  t.mock.method(SyncEngine.prototype, 'syncOnce', async () => failure ? { error: 'offline' } : { pushed: true });
  const request = host(t, { autoPullOnStart: true }); await new Promise(resolve => setImmediate(resolve));
  failure = false; await request('startup', { action: 'retry' });
  const status = await request('status'); assert.equal(status.startup.phase, 'ready'); assert.equal(status.mode, 'manual');
});

test('running startup can be cancelled and a late result cannot reopen the gate', async t => {
  let finish;
  t.mock.method(SyncEngine.prototype, 'sessionActivity', () => ({ available: true, activeCount: 0 }));
  t.mock.method(SyncEngine.prototype, '_syncOnce', async function () {
    await new Promise(resolve => { finish = resolve; });
    this.throwIfCancelled();
    return { downloadPending: true };
  });
  const request = host(t, { autoPullOnStart: true }); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await request('status')).startup.phase, 'running');
  const cancelling = request('startup', { action: 'offline' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await request('status')).startup.phase, 'cancelling');
  finish(); await cancelling;
  const state = await request('status');
  assert.equal(state.startup.phase, 'offline'); assert.equal(state.lastOk, false);
  assert.match(state.lastMessage, /已取消/);
});

test('a saved lock collision does not permanently fail subsequent startup attempts', async t => {
  let attempts = 0;
  t.mock.method(SyncEngine.prototype, 'syncOnce', async (_reason, options) => { attempts++; assert.equal(options.waitForLock, true); return {}; });
  const request = host(t, { autoPullOnStart: true }, home => {
    fs.writeFileSync(path.join(home, '.dsh-sync-status.json'), JSON.stringify({ at: 1, source: 'startup-offline', result: { error: '另一 DSH 进程正在同步，请稍后再试。' } }));
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 1); assert.equal((await request('status')).startup.phase, 'ready');
});
