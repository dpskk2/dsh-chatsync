import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { scopeMirrorPath } from '../lib/scope.js';
import { DEFAULT_CONFIG } from '../lib/sync.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zstdCompressSync } from 'node:zlib';
import { SyncEngine } from '../lib/sync.js';
import { decodeZstdFrames, validateSessionLog } from '../lib/merge.js';
import { header, event, jsonl, logPath } from './fixtures/issue4-data.mjs';

const catalogRoot = process.env.DSH_ISSUE4_CATALOG_ROOT;
const catalog = catalogRoot ? (await import(pathToFileURL(path.join(catalogRoot,
  'node_modules/@deepseek-ai/dsh-session-format-catalog/lib/index.js')))).sessionFormatCatalog : null;
const catalogVersion = catalogRoot ? JSON.parse(fs.readFileSync(path.join(catalogRoot,
  'node_modules/@deepseek-ai/dsh-session-format-catalog/package.json'), 'utf8')).version : null;
const records = [];
test.after(() => {
  if (process.env.DSH_ISSUE4_REPORT) fs.writeFileSync(process.env.DSH_ISSUE4_REPORT,
    JSON.stringify({ testedAt: new Date().toISOString(), node: process.version, catalog: catalogVersion,
      complete: records.length === 6,
      sourceHashes: Object.fromEntries(['lib/sync.js', 'lib/merge.js', 'lib/session-safety.js', 'lib/scheduler.js'].map(name =>
        [name, hash(fs.readFileSync(new URL('../' + name, import.meta.url)))])), records }, null, 2));
});
const hash = buf => createHash('sha256').update(buf).digest('hex');
const encode = rows => zstdCompressSync(jsonl(rows));
const baseRows = n => [header, ...Array.from({ length: n }, (_, seq) => event(seq, 'base'))];
function audit(buf) {
  const text = decodeZstdFrames(buf); assert.notEqual(text, null);
  const rows = text.trim().split('\n').map(JSON.parse);
  // Independent oracle: do not use the plugin's validator to check itself.
  for (let i = 1; i < rows.length; i++) assert.equal(rows[i].seq, i - 1, `seq mismatch at row ${i}`);
  if (catalog) {
    const restore = catalog.createRestore(rows[0], { recovery: 'strict', validation: 'current' });
    for (const row of rows.slice(1)) restore.decodeRow(row);
    assert.equal(restore.finish().events.length, rows.length - 1);
  }
  return rows;
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-issue4-stress-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  const make = name => {
    const home = path.join(root, name); fs.mkdirSync(home);
    const e = new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false, minCommitIntervalSeconds: 0 });
    e.verifyPrivateRemote = async () => ({ ok: true });
    const run = e.syncOnce.bind(e);
    e.syncOnce = (reason, opts = {}) => run(reason, { offlineApply: true, ...opts });
    acceptFixturePreviews(e); return e;
  };
  const write = (e, buf) => { const file = path.join(e.home, logPath); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); };
  return { root, a: make('a'), b: make('b'), write };
}
async function sync(e) {
  const r = await e.syncOnce('issue4-stress', { forceCommit: true });
  assert.equal(r.error, undefined, JSON.stringify(r)); return r;
}
function writer(file, start, seed, t) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/issue4-writer.mjs', import.meta.url)), file, String(start), String(seed)],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const pending = new Map(), received = new Map(); let error = '';
  child.stderr.on('data', data => { error += data; });
  child.on('message', msg => { received.set(msg.type, msg); pending.get(msg.type)?.resolve(msg); });
  child.on('error', e => { for (const p of pending.values()) p.reject(e); });
  child.on('exit', code => { if (code) for (const p of pending.values()) p.reject(new Error(error || `writer exited ${code}`)); });
  const wait = kind => received.has(kind) ? Promise.resolve(received.get(kind)) : new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`writer timeout: ${kind}`)), 20_000);
    pending.set(kind, { resolve: msg => { clearTimeout(timer); resolve(msg); }, reject });
  });
  return { child, wait };
}

test('the exact reported 7173 -> 7183 gap loses nine events and is rejected', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-issue4-overwrite-model-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'log.zstd');
  const original = baseRows(7174), late = Array.from({ length: 9 }, (_, i) => event(7174 + i, 'writer'));
  fs.writeFileSync(file, encode(original)); const staleSnapshot = fs.readFileSync(file);
  fs.appendFileSync(file, encode(late)); audit(fs.readFileSync(file));
  const staleMerged = [...decodeZstdFrames(staleSnapshot).trim().split('\n').map(JSON.parse), event(7183, 'remote')];
  fs.writeFileSync(file, encode(staleMerged));
  const corrupt = fs.readFileSync(file), check = validateSessionLog(corrupt);
  assert.equal(check.reason, 'session-seq-gap'); assert.equal(check.expected, 7174); assert.equal(check.actual, 7183);
  if (catalog) {
    const r = catalog.createRestore(header, { recovery: 'strict', validation: 'current' });
    for (const row of original.slice(1)) r.decodeRow(row);
    assert.throws(() => r.decodeRow(staleMerged.at(-1)), /seq gap.*expected 7174, got 7183/);
  }
  records.push({ case: 'reported-gap', eventsBefore: 7174, missing: late.length, rejected: true, officialCodec: Boolean(catalog) });
});

for (const seed of [17, 42, 20261018]) {
  test(`continuous external writer preserves both independent histories through a divergent merge; seed=${seed}`, { timeout: 150_000 }, async t => {
    const h = fixture(t), initial = baseRows(7174);
    h.write(h.a, encode(initial)); await sync(h.a); await sync(h.b); await sync(h.a);
    const remoteSide = encode([...initial, event(7174, 'remote', seed)]);
    h.write(h.a, remoteSide); await sync(h.a);
    const localSide = encode([...initial, event(7174, 'local', seed)]);
    h.write(h.b, localSide);
    const file = path.join(h.b.home, logPath), ino = fs.statSync(file).ino;
    const w = writer(file, 7175, seed, t); await w.wait('ready');
    const step = h.b.step.bind(h.b); let started = false;
    h.b.step = (stage, label) => { step(stage, label); if (!started && stage === 'fetch') { started = true; w.child.send('start'); } };
    h.b.setHostContext({ get: () => ({ list: () => [] }) }); // Deliberately stale idle probe.
    h.b.overrides.mode = 'auto';
    const result = await h.b.syncOnce('activity', { forceCommit: true, uploadOnly: true });
    assert.equal(result.error, undefined, JSON.stringify(result));
    let deferredSnapshots = 0;
    for (let cycle = 0; cycle < 2; cycle++) {
      const next = await h.b.syncOnce('activity', { forceCommit: true, uploadOnly: true });
      if (next.error) { assert.match(next.error, /invalid-session-log/); deferredSnapshots++; }
      const published = execFileSync('git', ['--git-dir', path.join(h.root, 'remote.git'), 'show', `refs/heads/main:${logPath}`]);
      audit(published);
    }
    w.child.send('stop'); const { count } = await w.wait('done');
    assert.equal(started, true); assert.ok(count > 10, `too little overlap: ${count}`);
    // A conflict can select the unchanged local snapshot, so there need not be
    // an inbound update to defer. The invariant is exact bytes and inode.
    assert.equal(fs.statSync(file).ino, ino);
    assert.equal(result.sessionWarnings?.[0]?.reason, 'divergent-session-history');
    const final = fs.readFileSync(file);
    const expected = Buffer.concat([localSide, ...Array.from({ length: count }, (_, i) => encode([event(7175 + i, 'writer', seed)]))]);
    assert.deepEqual(final, expected); const finalRows = audit(final);
    assert.deepEqual(finalRows.slice(7176), Array.from({ length: count }, (_, i) => event(7175 + i, 'writer', seed)));
    const warning = result.sessionWarnings[0];
    const preservedRemote = execFileSync('git', ['show', `${warning.remoteHead}:${logPath}`], { cwd: h.b._transport.home });
    assert.deepEqual(preservedRemote, remoteSide); audit(preservedRemote);
    h.b.setHostContext(null); await sync(h.b);
    const forked = await h.a.syncOnce('preserve-remote-fork', { forceCommit: true });
    assert.equal(forked.sessionDeferred?.[0]?.reason, 'divergent-session-history');
    const other = fs.readFileSync(path.join(h.a.home, logPath));
    assert.deepEqual(other, remoteSide); audit(other);
    const publishedFinal = execFileSync('git', ['--git-dir', h.remote || path.join(h.root, 'remote.git'), 'show', 'refs/heads/main:' + logPath]);
    assert.deepEqual(publishedFinal, final);
    const commits = execFileSync('git', ['--git-dir', path.join(h.root, 'remote.git'), 'rev-list', '--all', '--full-history', '--', logPath], { encoding: 'utf8' }).trim().split('\n');
    for (const commit of commits) audit(execFileSync('git', ['--git-dir', path.join(h.root, 'remote.git'), 'show', `${commit}:${logPath}`]));
    records.push({ case: 'continuous-writer', seed, baseEvents: 7174, appendedDuringSync: count,
      syncCyclesWhileWriting: 3, deferredPartialSnapshots: deferredSnapshots, verifiedRemoteCommits: commits.length,
      finalEvents: finalRows.length - 1, missingEvents: 0, exactBytesPreserved: true, bothDevicesReadableByCodec: true, distinctForkPreserved: true,
      sha256: hash(final), remoteOriginalSha256: hash(preservedRemote), officialCodec: Boolean(catalog) });
  });
}

test('a large fast-forward cannot replace a log while an external writer appends', { timeout: 120_000 }, async t => {
  const h = fixture(t), initial = baseRows(7174), seed = 101;
  const original = encode(initial); h.write(h.a, original); await sync(h.a); await sync(h.b); await sync(h.a);
  h.write(h.a, encode([...initial, event(7174, 'remote'), event(7175, 'remote')])); await sync(h.a);
  const file = path.join(h.b.home, logPath), ino = fs.statSync(file).ino;
  const w = writer(file, 7174, seed, t); await w.wait('ready'); const step = h.b.step.bind(h.b); let started = false;
  h.b.step = (stage, label) => { step(stage, label); if (!started && stage === 'fetch') { started = true; w.child.send('start'); } };
  h.b.setHostContext({ get: () => ({ list: () => [] }) });
  const result = await sync(h.b); w.child.send('stop'); const { count } = await w.wait('done');
  assert.equal(result.downloadPending, true); assert.ok(count > 10); assert.equal(fs.statSync(file).ino, ino);
  const expected = Buffer.concat([original, ...Array.from({ length: count }, (_, i) => encode([event(7174 + i, 'writer', seed)]))]);
  const actual = fs.readFileSync(file); assert.deepEqual(actual, expected); audit(actual);
  records.push({ case: 'fast-forward-with-writer', baseEvents: 7174, appendedDuringSync: count,
    missingEvents: 0, exactBytesPreserved: true, deferred: true, sha256: hash(actual), officialCodec: Boolean(catalog) });
});

test('a partial compressed frame cannot propagate and its completed frame can be retried', { timeout: 90_000 }, async t => {
  const h = fixture(t); const original = encode(baseRows(200)); h.write(h.a, original); await sync(h.a); await sync(h.b);
  const file = path.join(h.b.home, logPath), frame = encode([event(200, 'partial')]);
  const partial = Buffer.concat([original, frame.subarray(0, frame.length - 3)]); h.write(h.b, partial);
  const remoteBefore = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], { cwd: h.b._transport.home }).toString();
  const rejected = await h.b.syncOnce('partial', { forceCommit: true, uploadOnly: true });
  assert.match(rejected.error, /invalid-session-log/); assert.deepEqual(fs.readFileSync(file), partial);
  assert.equal(execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], { cwd: h.b._transport.home }).toString(), remoteBefore);
  fs.appendFileSync(file, frame.subarray(frame.length - 3)); await sync(h.b); await sync(h.a);
  const complete = Buffer.concat([original, frame]); assert.deepEqual(fs.readFileSync(path.join(h.a.home, logPath)), complete); audit(complete);
  records.push({ case: 'partial-frame', rejected: true, remoteUnchangedUntilComplete: true, retryPassed: true, officialCodec: Boolean(catalog) });
});
