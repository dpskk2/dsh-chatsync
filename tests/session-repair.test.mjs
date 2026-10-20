import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { zstdCompressSync } from 'node:zlib';
import { SyncEngine } from '../lib/sync.js';
import { digest, atomicJson } from '../lib/recovery.js';
import { decodeZstdFrames } from '../lib/merge.js';
import { prepareImportRescue, previewSessionRepair, repairSessionImport, rollbackSessionRepair } from '../lib/session-repair.js';

function fixture(t, compressed = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-session-repair-'));
  t.after(() => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  const home = path.join(root, 'home'), cwd = path.join(root, 'project'); fs.mkdirSync(home); fs.mkdirSync(cwd);
  const engine = new SyncEngine(home, { autoRepo: false, workspaceSync: false });
  let running = 0;
  engine._spawn = async () => ({ code: 0, out: process.platform === 'win32' ? String(running) + '\n'
    : running ? '/fixture/@deepseek-ai/dsh/lib/bin.js web\n' : '', err: '' });
  const sourceId = 'session-' + randomUUID(), sessionId = 'session-' + randomUUID();
  const original = Buffer.from('original conflict content\n');
  const sourcePath = 'sessions/source/' + sourceId + '/log.v4.jsonl';
  const sourceFile = path.join(home, sourcePath); fs.mkdirSync(path.dirname(sourceFile), { recursive: true }); fs.writeFileSync(sourceFile, original);
  const record = engine.recovery.save({ kind: 'main', status: 'merged', path: sourcePath }, { local: original, remote: original });
  const plan = { format: 1, sessionId, sourceSessionId: sourceId, workspaceId: 'fixture-project', sourceHash: digest(original),
    inheritedEventCount: 1, meta: { createdAt: 1, cwd, parentSession: sourceId, isSeeded: true }, events: [] };
  const planFile = path.join(engine.recovery.directory(), record.id, 'import-remote.json'); atomicJson(planFile, plan);
  const target = { sessionId, createdAt: 1, workspaceId: plan.workspaceId, sourceHash: plan.sourceHash, planHash: digest(fs.readFileSync(planFile)), status: 'pending' };
  engine.recovery.finish(record.id, { imports: { remote: target } });
  const encode = values => Buffer.from(values.map(row => JSON.stringify(row)).join('\n') + '\n');
  const rows = [{ type: 'session', version: 4, id: sessionId, createdAt: 1, cwd, parentSession: sourceId, isSeeded: true },
    { type: 'event', seq: 0, data: 'inherited' }, { type: 'session/end-seed', seq: 1 }];
  const payload = encode(rows), prefix = encode(rows.slice(0, 2));
  prepareImportRescue(engine, record.id, 'remote', target, payload, 4);
  const relative = 'sessions/project/' + sessionId + '/log.v4.jsonl' + (compressed ? '.zstd' : '');
  const file = path.join(home, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
  const before = compressed ? zstdCompressSync(prefix) : prefix; fs.writeFileSync(file, before);
  return { root, home, engine, record, target, file, relative, before, payload, sourceFile, original,
    running(value) { running = value; } };
}

test('offline repair backs up plain and compressed prefixes and leaves public readback pending', async t => {
  for (const compressed of [false, true]) {
    const f = fixture(t, compressed), preview = previewSessionRepair(f.engine, f.record.id, 'remote');
    const result = await repairSessionImport(f.engine, preview.planId, { offline: true });
    assert.equal(result.requiresHostReadback, true); assert.equal(f.engine.hasPendingSessionImport(), true);
    const stored = fs.readFileSync(f.file);
    assert.equal(compressed ? decodeZstdFrames(stored) : stored.toString(), f.payload.toString());
    assert.deepEqual(fs.readFileSync(f.sourceFile), f.original);
    assert.deepEqual(f.engine.recovery.version(f.engine.recovery.read(result.backupId), 'local'), f.before);
    assert.equal(fs.existsSync(path.join(f.home, '.git')), false);
    await assert.rejects(repairSessionImport(f.engine, preview.planId, { offline: true }), /预览后变化/);
    assert.throws(() => previewSessionRepair(f.engine, f.record.id, 'remote'), /内容已经完整/);
  }
});

test('offline confirmation, live or uninspectable hosts refuse all session writes', async t => {
  const f = fixture(t), preview = previewSessionRepair(f.engine, f.record.id, 'remote');
  await assert.rejects(repairSessionImport(f.engine, preview.planId), /offline-dsh-closed/);
  f.running(1); await assert.rejects(repairSessionImport(f.engine, preview.planId, { offline: true }), /仍检测到/);
  f.engine._spawn = async () => ({ code: 0, out: 'unknown', err: '', outputLimit: true });
  await assert.rejects(repairSessionImport(f.engine, preview.planId, { offline: true }), /无法确认/);
  assert.deepEqual(fs.readFileSync(f.file), f.before);
});

test('stale previews, changed prefixes, seed or plan corruption stop before replacement', async t => {
  const f = fixture(t), preview = previewSessionRepair(f.engine, f.record.id, 'remote');
  const planFile = path.join(f.home, '.chatsync-local/session-repair/plans', preview.planId + '.json');
  const saved = JSON.parse(fs.readFileSync(planFile)); atomicJson(planFile, { ...saved, expiresAt: 1 });
  await assert.rejects(repairSessionImport(f.engine, preview.planId, { offline: true }), /失效/); atomicJson(planFile, saved);
  fs.writeFileSync(f.file, f.before.toString().replace('inherited', 'changed'));
  await assert.rejects(repairSessionImport(f.engine, preview.planId, { offline: true }), /其他程序修改/); fs.writeFileSync(f.file, f.before);
  const seedFile = path.join(f.engine.recovery.directory(), f.record.id, 'seed-remote.jsonl');
  fs.appendFileSync(seedFile, 'tampered\n');
  await assert.rejects(repairSessionImport(f.engine, preview.planId, { offline: true }), /种子校验/); fs.writeFileSync(seedFile, f.payload);
  fs.appendFileSync(path.join(f.engine.recovery.directory(), f.record.id, 'import-remote.json'), ' ');
  await assert.rejects(repairSessionImport(f.engine, preview.planId, { offline: true }), /分叉计划校验/);
  assert.deepEqual(fs.readFileSync(f.file), f.before);
});

test('journal failure after replacement rolls back and keeps immutable repair originals', async t => {
  const f = fixture(t), preview = previewSessionRepair(f.engine, f.record.id, 'remote');
  const finish = f.engine.recovery.finish.bind(f.engine.recovery);
  f.engine.recovery.finish = (id, value) => { if (value.status === 'awaiting-host-readback') throw new Error('fixture journal failure'); return finish(id, value); };
  await assert.rejects(repairSessionImport(f.engine, preview.planId, { offline: true }), /journal failure/);
  assert.deepEqual(fs.readFileSync(f.file), f.before);
  const backup = f.engine.recovery.list().find(r => r.kind === 'import-repair-backup');
  assert.equal(backup.status, 'rolled-back'); assert.deepEqual(f.engine.recovery.version(backup, 'local'), f.before);
});

test('repair rollback preserves concurrent edits and refuses undo after host verification', async t => {
  const f = fixture(t), preview = previewSessionRepair(f.engine, f.record.id, 'remote');
  const result = await repairSessionImport(f.engine, preview.planId, { offline: true }), full = fs.readFileSync(f.file);
  fs.appendFileSync(f.file, '{"type":"event","seq":2}\n');
  await assert.rejects(rollbackSessionRepair(f.engine, result.backupId, { offline: true }), /其他程序修改/);
  fs.writeFileSync(f.file, full);
  const rolledBack = await rollbackSessionRepair(f.engine, result.backupId, { offline: true }); assert.equal(rolledBack.rolledBack, true);
  await rollbackSessionRepair(f.engine, result.backupId, { offline: true }); assert.deepEqual(fs.readFileSync(f.file), f.before);
  const current = f.engine.recovery.read(f.record.id);
  f.engine.recovery.finish(f.record.id, { imports: { remote: { ...current.imports.remote, status: 'verified' } } });
  await assert.rejects(rollbackSessionRepair(f.engine, result.backupId, { offline: true }), /已通过宿主验收/);
});

test('a host appearing after backup and a file changed during rollback both prevent writes', async t => {
  const f = fixture(t), preview = previewSessionRepair(f.engine, f.record.id, 'remote');
  const spawn = f.engine._spawn; let checks = 0;
  f.engine._spawn = async (...args) => { if (++checks === 2) f.running(1); return spawn(...args); };
  await assert.rejects(repairSessionImport(f.engine, preview.planId, { offline: true }), /仍检测到/);
  assert.deepEqual(fs.readFileSync(f.file), f.before);
  f.running(0); f.engine._spawn = spawn;
  const repaired = await repairSessionImport(f.engine, preview.planId, { offline: true });
  checks = 0; f.engine._spawn = async (...args) => { if (++checks === 2) fs.appendFileSync(f.file, 'changed'); return spawn(...args); };
  await assert.rejects(rollbackSessionRepair(f.engine, repaired.backupId, { offline: true }), /目标已变化/);
  assert.ok(fs.readFileSync(f.file).toString().endsWith('changed'));
});

test('ambiguous generations and directory links cannot select an unrelated session log', async t => {
  const f = fixture(t), duplicate = path.join(path.dirname(f.file), 'log.v3.jsonl'); fs.writeFileSync(duplicate, f.before);
  assert.throws(() => previewSessionRepair(f.engine, f.record.id, 'remote'), /唯一/); fs.unlinkSync(duplicate);
  const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside); const untouched = path.join(outside, 'note.txt'); fs.writeFileSync(untouched, 'unchanged');
  const link = path.join(f.home, 'sessions', 'linked'); fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => previewSessionRepair(f.engine, f.record.id, 'remote'), /符号链接/);
  assert.equal(fs.readFileSync(untouched, 'utf8'), 'unchanged');
});

test('standalone repair preview never syncs and missing offline parameters fail closed', async t => {
  const f = fixture(t);
  const cli = path.resolve('lib/cli.mjs');
  const args = { env: { ...process.env, DSH_HOME: f.home }, encoding: 'utf8', windowsHide: true, timeout: 20000 };
  const listed = spawnSync(process.execPath, [cli, '--session-repair-list'], args);
  assert.equal(listed.status, 0, listed.stderr); assert.equal(JSON.parse(listed.stdout).repairs[0].recoveryId, f.record.id);
  assert.equal(JSON.parse(listed.stdout).repairs[0].seedAvailable, true);
  const preview = spawnSync(process.execPath, [cli, '--session-repair-preview', f.record.id, 'remote'], args);
  assert.equal(preview.status, 0, preview.stderr); assert.equal(JSON.parse(preview.stdout).ok, true);
  const unsafe = spawnSync(process.execPath, [cli, '--session-repair-apply', JSON.parse(preview.stdout).planId], args);
  assert.equal(unsafe.status, 1); assert.equal(fs.existsSync(path.join(f.home, '.git')), false);
  assert.deepEqual(fs.readFileSync(f.file), f.before);
});

test('process interruption after replacement leaves a durable backup that can undo locally', async t => {
  const f = fixture(t), preview = previewSessionRepair(f.engine, f.record.id, 'remote');
  const script = `const { SyncEngine } = await import(${JSON.stringify(new URL('../lib/sync.js', import.meta.url).href)});
const { repairSessionImport } = await import(${JSON.stringify(new URL('../lib/session-repair.js', import.meta.url).href)});
const engine = new SyncEngine(process.argv[1], {autoRepo:false});
engine._spawn = async () => ({code:0,out:process.platform === 'win32' ? '0\\n' : '',err:''});
const finish = engine.recovery.finish.bind(engine.recovery);
engine.recovery.finish = (id,value) => { if(value.status === 'awaiting-host-readback') process.exit(42); return finish(id,value); };
await repairSessionImport(engine, process.argv[2], {offline:true});`;
  const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', script, f.home, preview.planId], { windowsHide: true, encoding: 'utf8', timeout: 20000 });
  assert.equal(crashed.status, 42, crashed.stderr);
  assert.deepEqual(fs.readFileSync(f.file), f.payload);
  const backup = f.engine.recovery.list().find(r => r.kind === 'import-repair-backup'); assert.equal(backup.status, 'prepared');
  await rollbackSessionRepair(f.engine, backup.id, { offline: true });
  assert.deepEqual(fs.readFileSync(f.file), f.before); assert.deepEqual(fs.readFileSync(f.sourceFile), f.original);
});
