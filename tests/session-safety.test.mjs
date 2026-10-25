import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { removeFixture } from './helpers/fixture-cleanup.mjs';
import { scopeMirrorPath } from '../lib/scope.js';
import { DEFAULT_CONFIG } from '../lib/sync.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { zstdCompressSync } from 'node:zlib';
import { SyncEngine } from '../lib/sync.js';
import { validateSessionLog, mergeSessionLog } from '../lib/merge.js';
import { readSyncStatus, registerHost, liveHosts } from '../lib/session-safety.js';
const rel = 'sessions/test/session-11111111-1111-1111-1111-111111111111/session.v4.jsonl.zstd';
const rows = n => [{ type: 'session', version: 4, id: 'session-11111111-1111-1111-1111-111111111111' }, ...Array.from({ length: n }, (_, seq) => ({ type: 'event', seq, time: seq }))];
const encode = r => zstdCompressSync(Buffer.from(r.map(JSON.stringify).join('\n') + '\n'));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-safe-log-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  const device = name => {
    const home = path.join(root, name); fs.mkdirSync(home);
    const engine = new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false, minCommitIntervalSeconds: 0 });
    engine.verifyPrivateRemote = async () => ({ ok: true });
    const run = engine.syncOnce.bind(engine);
    engine.syncOnce = (reason, opts = {}) => run(reason, { offlineApply: true, ...opts });
    acceptFixturePreviews(engine);
    return engine;
  };
  const write = (engine, data) => { const file = path.join(engine.home, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
  const git = (engine, args) => execFileSync('git', args, { cwd: engine._transport?.home || engine.home, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { root, remote, a: device('a'), b: device('b'), write, git };
}
const sync = e => e.syncOnce('test', { forceCommit: true });

test('seq gaps, duplicates and identical corrupt buffers fail validation', () => {
  for (const seq of [3, 0, -1, 1.5]) {
    const r = rows(2); r[2].seq = seq;
    const buf = encode(r);
    assert.equal(validateSessionLog(buf).reason, 'session-seq-gap');
    assert.equal(mergeSessionLog(buf, buf).reason, 'session-seq-gap');
  }
});

test('live idle hosts never replace existing log bytes or an open writer handle; offline sync imports later', { timeout: 90_000 }, async t => {
  const h = fixture(t), file = path.join(h.b.home, rel);
  h.write(h.a, encode(rows(1))); assert.equal((await sync(h.a)).error, undefined);
  assert.equal((await sync(h.b)).error, undefined);
  h.write(h.a, encode(rows(2))); assert.equal((await sync(h.a)).error, undefined);
  const before = fs.readFileSync(file), inode = fs.statSync(file).ino;
  const fd = fs.openSync(file, 'a');
  try {
    h.b.setHostContext({ get: () => ({ list: () => [] }) });
    const result = await sync(h.b);
    assert.equal(result.downloadPending, true, JSON.stringify(result));
    assert.deepEqual(fs.readFileSync(file), before); assert.equal(fs.statSync(file).ino, inode);
    // A held DSH descriptor still points to the original inode, not an unlinked copy.
    fs.writeSync(fd, zstdCompressSync(Buffer.from(JSON.stringify({ type: 'event', seq: 1, time: 1 }) + '\n')));
  } finally { fs.closeSync(fd); }
  assert.equal(validateSessionLog(fs.readFileSync(file)).ok, true);
  h.b.setHostContext(null);
  const offline = await sync(h.b); assert.equal(offline.error, undefined, JSON.stringify(offline));
  assert.equal(validateSessionLog(fs.readFileSync(file)).ok, true);
});

test('an append during network wait aborts materialization without losing a byte', { timeout: 90_000 }, async t => {
  const h = fixture(t); h.write(h.a, encode(rows(1))); await sync(h.a); await sync(h.b);
  h.write(h.a, encode(rows(2))); await sync(h.a);
  const file = path.join(h.b.home, rel), before = fs.readFileSync(file);
  const appended = zstdCompressSync(Buffer.from(JSON.stringify({ type: 'event', seq: 1, time: 99 }) + '\n'));
  const retry = h.b.runWithRetry.bind(h.b); let injected = false;
  h.b.runWithRetry = async (op, label, args, opts) => {
    const result = await retry(op, label, args, opts);
    if (op === 'fetch' && label === '主仓库' && !injected) { fs.appendFileSync(file, appended); injected = true; }
    return result;
  };
  const result = await sync(h.b);
  assert.equal(injected, true); assert.equal(result.downloadPending, true, JSON.stringify(result));
  assert.deepEqual(fs.readFileSync(file), Buffer.concat([before, appended]));
});

test('a corrupt remote fast-forward is rejected before checkout and publication', { timeout: 90_000 }, async t => {
  const h = fixture(t); h.write(h.a, encode(rows(1))); await sync(h.a); await sync(h.b);
  await sync(h.a);
  const before = fs.readFileSync(path.join(h.b.home, rel));
  const bad = rows(3); bad[2].seq = 9; h.write(h.a, encode(bad));
  fs.writeFileSync(path.join(h.a._transport.home, rel), encode(bad));
  h.git(h.a, ['add', '-A']); h.git(h.a, ['commit', '-m', 'simulate old corrupt client']); h.git(h.a, ['push', 'origin', 'main']);
  const result = await sync(h.b);
  assert.equal(result.error, 'invalid-remote-session');
  assert.match(result.hint, /session-seq-gap/);
  assert.deepEqual(fs.readFileSync(path.join(h.b.home, rel)), before);
});

test('a corrupt local snapshot is never committed or uploaded', { timeout: 30_000 }, async t => {
  const h = fixture(t), bad = rows(2); bad[2].seq = 8; const bytes = encode(bad); h.write(h.a, bytes);
  const result = await sync(h.a); assert.match(result.error, /session-seq-gap/);
  assert.deepEqual(fs.readFileSync(path.join(h.a.home, rel)), bytes);
  assert.equal(execFileSync('git', ['ls-remote', '--heads', h.remote], { encoding: 'utf8' }).trim(), '');
});

test('cancelling isolated integration after network completion preserves the original and removes its worktree', { timeout: 90_000 }, async t => {
  const h = fixture(t); h.write(h.a, encode(rows(1))); await sync(h.a); await sync(h.b);
  h.write(h.a, encode(rows(2))); await sync(h.a);
  const file = path.join(h.b.home, rel), before = fs.readFileSync(file);
  const retry = h.b.runWithRetry.bind(h.b); let cancelling;
  h.b.runWithRetry = async (op, label, args, opts) => {
    const result = await retry(op, label, args, opts);
    if (op === 'fetch' && label === '主仓库') cancelling = h.b.cancelSync();
    return result;
  };
  const result = await sync(h.b); await cancelling;
  assert.equal(result.cancelled, true); assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(h.git(h.b, ['worktree', 'list', '--porcelain']).split('\n').filter(line => line.startsWith('worktree ')).length, 1);
  assert.equal(fs.existsSync(path.join(h.b.home, '.dsh-sync.process.lock')), false);
});

test('cancelling during a local transaction finishes file, HEAD and index together', { timeout: 90_000 }, async t => {
  const h = fixture(t); h.write(h.a, encode(rows(1))); await sync(h.a); await sync(h.b);
  const updated = encode(rows(2)); h.write(h.a, updated); await sync(h.a);
  let cancelling; const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (...args) => { const result = rename(...args); if (args[1] === path.join(h.b.home, rel)) cancelling = h.b.cancelSync(); return result; });
  const result = await sync(h.b); await cancelling;
  assert.equal(result.cancelled, true);
  assert.deepEqual(fs.readFileSync(path.join(h.b.home, rel)), updated);
  assert.equal(h.git(h.b, ['diff', '--cached', '--name-only', 'HEAD']), '');
  assert.deepEqual(execFileSync('git', ['show', `HEAD:${rel}`], { cwd: h.b._transport.home }), updated);
  assert.equal(fs.existsSync(path.join(h.b.home, '.dsh-sync.process.lock')), false);
});

test('legacy packed snapshots upload and download verbatim alongside migrated logs', { timeout: 90_000 }, async t => {
  const h = fixture(t);
  const legacyRel = rel.replace('session.v4.', 'session.');
  const legacy = encode([{ type: 'session', version: 0, id: rows(0)[0].id }, { type: 'text-chunks', seq0: 0, time0: 100,
    data: { turn: 0, step: 0, index: 0, dt: [1], texts: ['a', 'b'] } }, { type: 'event', seq: 2 }]);
  h.write(h.a, encode(rows(3)));
  fs.writeFileSync(path.join(h.a.home, legacyRel), legacy);
  assert.equal((await sync(h.a)).error, undefined);
  assert.equal((await sync(h.b)).error, undefined);
  assert.equal(fs.existsSync(path.join(h.b.home, legacyRel)), false, 'retired generations stay in Git instead of being imported');
  assert.deepEqual(execFileSync('git', ['show', `HEAD:${legacyRel}`], { cwd: h.b._transport.home }), legacy);
  assert.deepEqual(fs.readFileSync(path.join(h.b.home, rel)), encode(rows(3)));
});

test('active or unknown host state defers manual and startup sync before Git work', async t => {
  const h = fixture(t); h.a.setHostContext({});
  h.a._syncOnce = () => assert.fail('must not enter sync');
  for (const activity of [{ available: false }, { available: true, activeCount: 1 }]) {
    h.a.setActiveSessionProbe(() => activity);
    assert.equal((await h.a.syncOnce('startup')).deferred, true);
  }
});

test('a live host lease also protects external CLI imports', async t => {
  const h = fixture(t); const release = registerHost(h.a.home);
  assert.deepEqual(liveHosts(h.a.home), [process.pid]); release(); assert.deepEqual(liveHosts(h.a.home), []);
});

test('workspace mirrors cannot bypass log protection through overlapping data paths', async t => {
  const h = fixture(t);
  h.a.ensureWorkspaceMirror = () => assert.fail('must not run Git against DSH data as a workspace');
  for (const folder of [h.a.home, path.join(h.a.home, 'sessions'), path.dirname(h.a.home)]) {
    h.a.workspaceRealPathOf = () => folder;
    const result = await h.a.syncWorkspace({ id: 'unsafe' }, h.a.loadConfig(), 'test', {});
    assert.match(result.error, /主仓库保护/);
  }
});

test('new log versions in existing session directories are deferred in a live host', { timeout: 90_000 }, async t => {
  const h = fixture(t); h.write(h.a, encode(rows(1))); await sync(h.a); await sync(h.b);
  const newRel = rel.replace('.v4.', '.v5.');
  const v5 = rows(2); v5[0].version = 5;
  fs.writeFileSync(path.join(h.a.home, newRel), encode(v5)); await sync(h.a);
  const before = fs.readFileSync(path.join(h.b.home, rel));
  h.b.setHostContext({ get: () => ({ list: () => [] }) });
  const result = await sync(h.b); assert.equal(result.downloadPending, true, JSON.stringify(result));
  assert.equal(fs.existsSync(path.join(h.b.home, newRel)), false);
  assert.deepEqual(fs.readFileSync(path.join(h.b.home, rel)), before);
});

test('exit worker waits for its parent and records actual snapshot completion', { timeout: 30_000 }, async t => {
  const h = fixture(t); const home = path.join(h.root, 'exit-home'); fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, 'dsh-sync.json'), JSON.stringify({ autoRepo: false, workspaceSync: false }));
  fs.mkdirSync(path.join(home, 'attachments'), { recursive: true }); fs.writeFileSync(path.join(home, 'attachments/note.txt'), 'saved without clicking sync');
  fs.writeFileSync(path.join(home, '.credentials.yaml'), 'must remain excluded');
  const parent = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 1000)'], { stdio: 'ignore' });
  const completed = promisify(execFile)(process.execPath, [fileURLToPath(new URL('../lib/exit-sync.mjs', import.meta.url)), home, String(parent.pid)]);
  await completed;
  const status = readSyncStatus(home); assert.equal(status.source, 'exit'); assert.equal(status.result.error, undefined);
  assert.match(execFileSync('git', ['show', 'HEAD:attachments/note.txt'], { cwd: scopeMirrorPath(home, { ...DEFAULT_CONFIG, remote: '' }), encoding: 'utf8' }), /without clicking/);
  assert.equal(execFileSync('git', ['ls-files', '.credentials.yaml'], { cwd: scopeMirrorPath(home, { ...DEFAULT_CONFIG, remote: '' }), encoding: 'utf8' }), '');
});
