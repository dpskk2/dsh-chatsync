import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SyncEngine } from '../lib/sync.js';
import { digest } from '../lib/recovery.js';
import { importRecoverySession, sessionRecoveryOptions, decodeRecoverySession } from '../lib/session-recovery.js';

// Adapter failure tests only. The optional native script validates real host codecs/services.
const sourceId = 'session-11111111-1111-1111-1111-111111111111';
const catalog = { buildForkSeed(events, boundary) { return [...events.slice(0, boundary + 1),
  { type: 'session/end-seed', seq: boundary + 1, time: 1, data: { inherited: true } }]; }, createRestore(header) {
  if (header.version !== 4) throw new Error('unsupported format');
  const events = [];
  return { decodeRow(row) { events.push(row); }, finish() { return { header, events, inheritedEventCount: 0 }; } };
} };
function fixture(t, events = [{ type: 'fixture/event', seq: 0, time: 1, data: {} }], id = sourceId) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-session-recovery-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const engine = new SyncEngine(home, { autoRepo: false });
  const workspace = { id: 'ws-test', path: path.join(home, 'project'), title: 'Test project', sessionIds: [],
    async attachSession(id) { if (!this.sessionIds.includes(id)) this.sessionIds.push(id); } };
  fs.mkdirSync(workspace.path);
  const bytes = Buffer.from([JSON.stringify({ version: 4, id, createdAt: 1, isSeeded: false }), ...events.map(e => JSON.stringify(e))].join('\n') + '\n');
  const record = engine.recovery.save({ kind: 'main', path: 'sessions/test/' + id + '/log.v4.jsonl.zstd', status: 'merged' }, { local: bytes, remote: bytes });
  const storage = new Map(); let failed = false;
  const ctx = {
    sessions: { prepare(id, options) { return { header: { version: 4, id, ...options.meta } }; } },
    workspaceRegistry: { list: () => [workspace] },
    sessionPersistence: { async stat(id) { return storage.get(id); },
      async create(header, options) { storage.set(header.id, { header, events: [], inheritedEventCount: options.inheritedEventCount }); return this.open(header.id); },
      async open(id) {
        const entry = storage.get(id);
        return { header: entry.header, inheritedEventCount: entry.inheritedEventCount, async read() { return { events: [...entry.events] }; },
          async append(batch) {
            if (ctx.failOnce && !failed) { failed = true; entry.events.push(...batch.slice(0, 1)); throw new Error('fixture disk failure'); }
            entry.events.push(...batch);
          }, async flush() {}, async close() {} };
      } },
    sessionQuery: { async readSession(id) { const entry = storage.get(id); return { session: entry.header, events: [...entry.events], inheritedEventCount: entry.inheritedEventCount }; } },
  };
  return { engine, ctx, storage, record, bytes, workspace,
    request: { id: record.id, side: 'remote', expectedHash: digest(bytes), workspaceId: workspace.id } };
}

test('imported conversation conflicts recover as independent forks with their original source identity', async t => {
  const id = 'import-11111111-1111-1111-1111-111111111111';
  const f = fixture(t, undefined, id);
  const imported = await importRecoverySession(f.engine, f.ctx, f.request, async () => catalog);
  assert.notEqual(imported.sessionId, id);
  assert.equal(f.storage.get(imported.sessionId).header.parentSession, id);
  assert.deepEqual(fs.readFileSync(path.join(f.engine.recovery.directory(), f.record.id, 'remote.bin')), f.bytes);
});

test('session import preflight is read-only and unsupported hosts retain originals', async t => {
  const f = fixture(t);
  const before = fs.readFileSync(f.engine.recovery.recordPath(f.record.id));
  assert.equal((await sessionRecoveryOptions(f.engine, {}, f.record.id, async () => catalog)).available, false);
  assert.equal((await sessionRecoveryOptions(f.engine, f.ctx, f.record.id, async () => catalog)).available, true);
  assert.deepEqual(fs.readFileSync(f.engine.recovery.recordPath(f.record.id)), before);
  await assert.rejects(importRecoverySession(f.engine, {}, f.request), /缺少/);
  assert.equal(f.storage.size, 0);
});

test('import creates a distinct ID, verifies readback and membership, and repeats without duplication', async t => {
  const f = fixture(t);
  // Current Cordis requires optional services to be obtained through public ctx.get.
  const result = await importRecoverySession(f.engine, { get: name => f.ctx[name] }, f.request, async () => catalog);
  assert.notEqual(result.sessionId, sourceId);
  assert.equal(result.sourceSessionId, sourceId);
  assert.equal(f.storage.size, 1);
  assert.equal(f.storage.get(result.sessionId).header.parentSession, sourceId);
  assert.equal(f.storage.get(result.sessionId).header.isSeeded, true);
  assert.equal(f.storage.get(result.sessionId).inheritedEventCount, 1);
  assert.deepEqual(f.workspace.sessionIds, [result.sessionId]);
  const again = await importRecoverySession(f.engine, f.ctx, f.request, async () => catalog);
  assert.equal(again.sessionId, result.sessionId);
  assert.equal(f.storage.size, 1);
  assert.equal(f.engine.recovery.read(f.record.id).imports.remote.status, 'verified');
  assert.deepEqual(f.engine.recovery.version(f.record, 'remote'), f.bytes);
});

test('partial writes retry the journalled ID and preserve the verified prefix', async t => {
  const f = fixture(t, [0, 1, 2].map(seq => ({ type: 'fixture/event', seq, time: 1, data: {} })));
  f.ctx.failOnce = true;
  await assert.rejects(importRecoverySession(f.engine, f.ctx, f.request, async () => catalog), /重试会接续同一身份/);
  const id = f.engine.recovery.read(f.record.id).imports.remote.sessionId;
  assert.equal(f.storage.get(id).events.length, 4);
  const result = await importRecoverySession(f.engine, f.ctx, f.request, async () => catalog);
  assert.equal(result.sessionId, id);
  assert.equal(f.storage.get(id).events.length, 4);
  assert.equal(f.storage.size, 1);
});

test('stale preview, mismatched identity and missing attachment fail before session creation', async t => {
  const f = fixture(t, [{ type: 'fixture/event', seq: 0, time: 1, data: { type: 'file', attachment: { attachmentId: 'missing' } } }]);
  await assert.rejects(importRecoverySession(f.engine, f.ctx, { ...f.request, expectedHash: 'f'.repeat(64) }, async () => catalog), /重新预览/);
  await assert.rejects(importRecoverySession(f.engine, f.ctx, f.request, async () => catalog), /校验文件附件/);
  assert.equal(f.storage.size, 0);
  assert.equal(f.engine.recovery.read(f.record.id).imports, undefined);
});

test('changed recovered session is not overwritten by a repeated import', async t => {
  const f = fixture(t);
  const result = await importRecoverySession(f.engine, f.ctx, f.request, async () => catalog);
  f.storage.get(result.sessionId).events.push({ type: 'fixture/new', seq: 1, time: 2, data: {} });
  await assert.rejects(importRecoverySession(f.engine, f.ctx, f.request, async () => catalog), /已修改/);
  assert.equal(f.storage.get(result.sessionId).events.length, 3);
  assert.equal(f.storage.size, 1);
});

test('unknown formats and oversized original logs are refused', () => {
  assert.throws(() => decodeRecoverySession(Buffer.from('{"version":99}\n'), catalog), /unsupported/);
  assert.throws(() => decodeRecoverySession(Buffer.alloc(16 * 1024 * 1024 + 1), catalog, 16 * 1024 * 1024), /16 MiB/);
});

test('immutable fork plan survives an interrupted journal update and refuses tampering', async t => {
  const f = fixture(t);
  const finish = f.engine.recovery.finish.bind(f.engine.recovery);
  f.engine.recovery.finish = () => { throw new Error('fixture journal failure'); };
  await assert.rejects(importRecoverySession(f.engine, f.ctx, f.request, async () => catalog), /journal failure/);
  assert.equal(f.storage.size, 0);
  const file = path.join(path.dirname(f.engine.recovery.recordPath(f.record.id)), 'import-remote.json');
  const plan = JSON.parse(fs.readFileSync(file));
  f.engine.recovery.finish = finish;
  const result = await importRecoverySession(f.engine, f.ctx, f.request, async () => catalog);
  assert.equal(result.sessionId, plan.sessionId);
  fs.appendFileSync(file, ' ');
  await assert.rejects(importRecoverySession(f.engine, f.ctx, f.request, async () => catalog), /计划校验失败/);
  assert.equal(f.storage.size, 1);
});

test('existing replay identities keep their original lineage on retry', async t => {
  const f = fixture(t);
  const id = 'session-22222222-2222-2222-2222-222222222222';
  f.engine.recovery.finish(f.record.id, { imports: { remote: { sessionId: id, createdAt: 2, workspaceId: f.workspace.id,
    sourceHash: f.request.expectedHash, status: 'pending' } } });
  const result = await importRecoverySession(f.engine, f.ctx, f.request, async () => catalog);
  assert.equal(result.sessionId, id);
  assert.equal(f.storage.get(id).header.isSeeded, false);
  assert.equal(f.storage.get(id).header.parentSession, undefined);
  assert.equal(f.storage.get(id).events.length, 1);
});

test('missing public fork capability and empty content never create a target session', async t => {
  const f = fixture(t, []);
  const unsupported = { createRestore: catalog.createRestore };
  assert.equal((await sessionRecoveryOptions(f.engine, f.ctx, f.record.id, async () => unsupported)).available, false);
  await assert.rejects(importRecoverySession(f.engine, f.ctx, f.request, async () => unsupported), /分叉接口/);
  await assert.rejects(importRecoverySession(f.engine, f.ctx, f.request, async () => catalog), /暂无可分叉/);
  assert.equal(f.storage.size, 0);
});

test('unverified imports stop synchronization and exit upload before Git or projection writes', async t => {
  const f = fixture(t);
  f.ctx.sessionPersistence.create = async () => { throw new Error('fixture persistent storage failure'); };
  await assert.rejects(importRecoverySession(f.engine, f.ctx, f.request, async () => catalog), /原件保留/);
  assert.equal(f.engine.hasPendingSessionImport(), true);
  let commands = 0;
  f.engine.git = async () => { commands++; throw new Error('unexpected Git'); };
  f.engine.gitSync = () => { commands++; throw new Error('unexpected exit Git'); };
  const paused = await f.engine.syncOnce('fixture');
  assert.equal(paused.error, 'session-import-pending');
  assert.equal((await f.engine.runWithRetry('push', 'test', ['push', 'origin', 'main'])).code, 1);
  f.engine.flushSync();
  assert.equal(commands, 0);
  assert.equal(fs.existsSync(path.join(f.engine.home, '.git')), false);
  assert.deepEqual(f.engine.recovery.version(f.record, 'remote'), f.bytes);
});

test('invalid host seed preparation does not create a pending journal or block synchronization', async t => {
  const f = fixture(t);
  f.ctx.sessions.prepare = () => { throw new Error('fixture unsupported seed'); };
  await assert.rejects(importRecoverySession(f.engine, f.ctx, f.request, async () => catalog), /unsupported seed/);
  assert.equal(f.engine.hasPendingSessionImport(), false);
  assert.equal(f.storage.size, 0);
});

test('invalid public seed encoding is refused before journalling a new import identity', async t => {
  const f = fixture(t);
  const incompatible = { ...catalog, encodeHeader() { throw new Error('fixture unsupported encoded header'); }, encodeEvent: event => event };
  await assert.rejects(importRecoverySession(f.engine, f.ctx, f.request, async () => incompatible), /unsupported encoded header/);
  assert.equal(f.engine.recovery.read(f.record.id).imports, undefined);
  assert.equal(f.engine.hasPendingSessionImport(), false);
  assert.equal(f.storage.size, 0);
});
