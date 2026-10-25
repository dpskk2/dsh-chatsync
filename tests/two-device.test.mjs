import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { recordHandoff } from '../lib/handoff.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';

test('divergent session logs bypass Git text merging and retain both original histories', { timeout: 180_000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-session-divergence-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  const make = name => {
    const home = path.join(root, name);
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, 'dsh-sync.json'), JSON.stringify({ remote, autoRepo: false, workspaceSync: false, mode: 'manual' }));
    const engine = acceptFixturePreviews(attachFixturePersistence(new SyncEngine(home)));
    engine.verifyPrivateRemote = async () => ({ ok: true });
    return engine;
  };
  const a = make('a'), b = make('b');
  const rel = 'sessions/example/session-11111111-1111-1111-1111-111111111111/session.jsonl';
  const base = [{ type: 'session', version: 4, id: 'session-11111111-1111-1111-1111-111111111111' }, ...Array.from({ length: 12 }, (_, seq) => ({ type: 'event', seq, time: seq, data: { value: 'base' } }))];
  const encode = rows => rows.map(JSON.stringify).join('\n') + '\n';
  const write = (engine, rows) => { fs.mkdirSync(path.dirname(path.join(engine.home, rel)), { recursive: true }); fs.writeFileSync(path.join(engine.home, rel), encode(rows)); };
  write(a, base);
  assert.equal((await a.syncOnce('test', { forceCommit: true })).error, undefined);
  assert.equal((await b.syncOnce('test', { forceCommit: true })).error, undefined);
  const rowsA = structuredClone(base), rowsB = structuredClone(base);
  rowsA[1].data.value = 'device A'; rowsB[12].data.value = 'device B';
  write(a, rowsA); write(b, rowsB);
  assert.equal((await a.syncOnce('test', { forceCommit: true })).error, undefined);
  const result = await b.syncOnce('test', { forceCommit: true });
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.equal(result.sessionWarnings?.length, 1, JSON.stringify(result));
  assert.equal(result.sessionWarnings[0].reason, 'divergent-session-history');
  assert.equal(fs.readFileSync(path.join(b.home, rel), 'utf8'), encode(rowsB));
  const savedConflict = b.recovery.list().find(r => r.path === rel);
  assert.equal(savedConflict.kept, 'local');
  assert.equal(b.recoveryPreview(savedConflict.id).local.text, encode(rowsB));
  assert.equal(b.recoveryPreview(savedConflict.id).remote.text, encode(rowsA));
  assert.equal(b.recoveryPreview(savedConflict.id).canRestore, false);
  const tracked = execFileSync('git', ['ls-files', '.chatsync-local', '.dsh-sync.state.json'], { cwd: b._transport.home, encoding: 'utf8' });
  assert.equal(tracked, '');
  for (const [ref, original] of [[result.sessionWarnings[0].localHead, rowsB], [result.sessionWarnings[0].remoteHead, rowsA]]) {
    assert.equal(execFileSync('git', ['show', `${ref}:${rel}`], { cwd: b._transport.home, encoding: 'utf8' }), encode(original));
  }
  assert.equal(result.backupPushed, true);
  const returnSync = await a.syncOnce('test', { forceCommit: true });
  assert.equal(returnSync.sessionDeferred[0].reason, 'divergent-session-history');
  assert.equal(fs.readFileSync(path.join(a.home, rel), 'utf8'), encode(rowsA));
});

test('two isolated DSH homes exchange files through a real Git remote', { timeout: 180_000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-two-device-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  const makeDevice = (name) => {
    const home = path.join(root, name);
    fs.mkdirSync(path.join(home, 'attachments'), { recursive: true });
    fs.writeFileSync(path.join(home, 'dsh-sync.json'), JSON.stringify({ remote, autoRepo: false, workspaceSync: false }));
    const engine = acceptFixturePreviews(new SyncEngine(home));
    // The test remote is a local bare Git repository; visibility is tested separately.
    engine.verifyPrivateRemote = async () => ({ ok: true });
    return engine;
  };
  const a = makeDevice('a');
  const b = makeDevice('b');
  fs.writeFileSync(path.join(a.home, '.credentials.yaml'), 'test-only: never-upload\n');
  fs.writeFileSync(path.join(a.home, 'attachments', 'from-a.txt'), 'first device\n');
  const upload = await a.syncOnce('test', { forceCommit: true });
  assert.equal(upload.error, undefined, JSON.stringify(upload));
  assert.equal(upload.pushed, true);
  assert.equal(a.handoffStatus().receiptPublished, true);
  assert.equal(a.handoffStatus().peers.length, 0);
  const download = await b.syncOnce('test', { forceCommit: true });
  assert.equal(download.error, undefined, JSON.stringify(download));
  assert.equal(b.handoffStatus().receiptPublished, true);
  // Normal sync fetches main history before comparing receipt ancestry.
  await a.git(['fetch', 'origin']);
  await recordHandoff(a, { pushed: false });
  assert.equal(a.handoffStatus().peers.some(p => p.deviceId === b.actorId()), true);
  const reloadA = new SyncEngine(a.home);
  assert.equal(reloadA.handoffStatus().uploaded.scope.main, a.handoffStatus().uploaded.scope.main);
  const receiptHead = execFileSync('git', ['--git-dir', path.join(a.home, '.chatsync-local', 'handoff', 'receipt.git'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await recordHandoff(a, { pushed: false });
  assert.equal(execFileSync('git', ['--git-dir', path.join(a.home, '.chatsync-local', 'handoff', 'receipt.git'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), receiptHead);
  assert.equal(fs.readFileSync(path.join(b.home, 'attachments', 'from-a.txt'), 'utf8'), 'first device\n');
  assert.equal(fs.existsSync(path.join(b.home, '.credentials.yaml')), false);
  assert.equal(execFileSync('git', ['ls-files', '--', '.credentials.yaml'], { cwd: a._transport.home, encoding: 'utf8' }), '');
  fs.writeFileSync(path.join(b.home, 'attachments', 'from-b.txt'), 'second device\n');
  const back = await b.syncOnce('test', { forceCommit: true });
  assert.equal(back.error, undefined, JSON.stringify(back));
  const final = await a.syncOnce('test', { forceCommit: true });
  assert.equal(final.error, undefined, JSON.stringify(final));
  assert.equal(fs.readFileSync(path.join(a.home, 'attachments', 'from-b.txt'), 'utf8'), 'second device\n');
  // Both devices now have the same base and independently add distinct files.
  fs.writeFileSync(path.join(a.home, 'attachments', 'parallel-a.txt'), 'A\n');
  fs.writeFileSync(path.join(b.home, 'attachments', 'parallel-b.txt'), 'B\n');
  assert.equal((await a.syncOnce('test', { forceCommit: true })).error, undefined);
  const merged = await b.syncOnce('test', { forceCommit: true });
  assert.equal(merged.error, undefined, JSON.stringify(merged));
  assert.equal(fs.readFileSync(path.join(b.home, 'attachments', 'parallel-a.txt'), 'utf8'), 'A\n');
  assert.equal((await a.syncOnce('test', { forceCommit: true })).error, undefined);
  assert.equal(fs.readFileSync(path.join(a.home, 'attachments', 'parallel-b.txt'), 'utf8'), 'B\n');
  // A local commit must not be reported as a completed cloud sync when push fails.
  fs.writeFileSync(path.join(a.home, 'attachments', 'offline.txt'), 'pending\n');
  const retry = a.runWithRetry.bind(a);
  a.runWithRetry = async (operation, ...args) => operation === 'push'
    ? { code: 1, out: '', err: 'simulated network failure' }
    : retry(operation, ...args);
  const failed = await a.syncOnce('test', { forceCommit: true });
  await assert.rejects(recordHandoff(a, { pushed: false }), /本机提交与已传输内容不一致/);
  assert.equal(failed.error, 'push');
  assert.equal(a.progress.stage, 'error');
  a.runWithRetry = retry;
  const recovered = await a.syncOnce('test', { forceCommit: true });
  assert.equal(recovered.error, undefined, JSON.stringify(recovered));
  assert.equal((await b.syncOnce('test', { forceCommit: true })).error, undefined);
  assert.equal(fs.readFileSync(path.join(b.home, 'attachments', 'offline.txt'), 'utf8'), 'pending\n');
});

// Includes initial restore, two conflicts, failed fetch/push, backup retry and recovery using real Git.
test('first sync uploads workspace files and second device restores them under its own base', { timeout: 300_000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-workspace-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  const homeA = path.join(root, 'home-a');
  const homeB = path.join(root, 'home-b');
  const projectA = path.join(root, 'projects-a', 'example');
  const projectB = path.join(root, 'projects-b', 'example');
  fs.mkdirSync(path.join(homeA, 'storages'), { recursive: true });
  fs.mkdirSync(projectA, { recursive: true });
  fs.mkdirSync(homeB, { recursive: true });
  fs.writeFileSync(path.join(projectA, 'note.txt'), 'workspace content\n');
  fs.writeFileSync(path.join(homeA, 'storages', 'workspace.json'), JSON.stringify({ tables: { workspaces: { 'test-workspace': { path: projectA, title: 'example' } } } }));
  const a = acceptFixturePreviews(new SyncEngine(homeA));
  const b = acceptFixturePreviews(new SyncEngine(homeB, { remote, autoRepo: false, workspaceBase: path.join(root, 'projects-b') }));
  a.verifyPrivateRemote = b.verifyPrivateRemote = async () => ({ ok: true });
  // Simulate the automatic private-repository setup without contacting GitHub.
  a.bootstrapRemote = async () => { a.writeConfig({ remote }); return remote; };
  const sent = await a.syncOnce('test', { forceCommit: true });
  assert.equal(sent.error, undefined, JSON.stringify(sent));
  assert.equal(sent.workspaces.pushed, 1, JSON.stringify(sent.workspaces));
  const received = await b.syncOnce('test', { forceCommit: true });
  assert.equal(received.error, undefined, JSON.stringify(received));
  assert.equal(received.workspaces.errors.length, 0, JSON.stringify(received.workspaces));
  assert.equal(fs.readFileSync(path.join(projectB, 'note.txt'), 'utf8'), 'workspace content\n');
  fs.writeFileSync(path.join(projectA, 'note.txt'), 'edit on A\n');
  fs.writeFileSync(path.join(projectB, 'note.txt'), 'edit on B\n');
  assert.equal((await a.syncOnce('test', { forceCommit: true })).workspaces.errors.length, 0);
  const conflict = await b.syncOnce('test', { forceCommit: true });
  assert.equal(conflict.workspaces.errors.length, 0, JSON.stringify(conflict.workspaces));
  assert.equal(conflict.workspaces.backups.length, 1);
  assert.equal(conflict.workspaces.backups[0].pushed, true);
  assert.equal(fs.readFileSync(path.join(projectB, 'note.txt'), 'utf8'), 'edit on B\n');
  const record = b.recovery.list().find(r => r.kind === 'ws' && r.path === 'note.txt');
  const preview = b.recoveryPreview(record.id);
  assert.equal(preview.local.text, 'edit on B\n');
  assert.equal(preview.remote.text, 'edit on A\n');
  assert.equal(preview.canRestore, true);
  assert.equal((await a.syncOnce('test', { forceCommit: true })).workspaces.errors.length, 0);
  assert.equal(fs.readFileSync(path.join(projectA, 'note.txt'), 'utf8'), 'edit on B\n');
  // A third independent copy must restore the merged workspace.
  fs.mkdirSync(path.join(root, 'home-c'), { recursive: true });
  const c = acceptFixturePreviews(new SyncEngine(path.join(root, 'home-c'), { remote, autoRepo: false, workspaceBase: path.join(root, 'projects-c') }));
  c.verifyPrivateRemote = async () => ({ ok: true });
  const third = await c.syncOnce('test', { forceCommit: true });
  assert.equal(third.error, undefined, JSON.stringify(third));
  assert.equal(third.workspaces.errors.length, 0);
  assert.equal(fs.readFileSync(path.join(root, 'projects-c', 'example', 'note.txt'), 'utf8'), 'edit on B\n');
  // Fetch failure must not masquerade as an empty remote or a successful workspace.
  const retry = b.runWithRetry.bind(b);
  b.runWithRetry = async (operation, label, ...args) => operation === 'fetch' && label.startsWith('工作区 ')
    ? { code: 1, out: '', err: 'simulated workspace outage' }
    : retry(operation, label, ...args);
  const offline = await b.syncOnce('test', { forceCommit: true });
  assert.equal(offline.workspaces.synced, 0);
  assert.equal(offline.workspaces.errors[0].error, 'fetch');
  assert.equal(b.progress.stage, 'error');
  b.runWithRetry = retry;
  assert.equal((await b.syncOnce('test', { forceCommit: true })).workspaces.errors.length, 0);
  // Keep the backup discoverable even when the subsequent workspace push fails.
  fs.writeFileSync(path.join(projectA, 'note.txt'), 'second edit A\n');
  fs.writeFileSync(path.join(projectB, 'note.txt'), 'second edit B\n');
  assert.equal((await a.syncOnce('test', { forceCommit: true })).workspaces.errors.length, 0);
  b.runWithRetry = async (operation, label, ...args) => operation === 'push' && label.startsWith('工作区 ')
    ? { code: 1, out: '', err: 'simulated workspace push failure' }
    : retry(operation, label, ...args);
  const pending = await b.syncOnce('test', { forceCommit: true });
  assert.equal(pending.workspaces.synced, 0);
  assert.equal(pending.workspaces.errors[0].error, 'push');
  assert.equal(pending.workspaces.backups.length, 1);
  assert.equal(pending.workspaces.backups[0].pushed, false);
  const saved = execFileSync('git', ['--git-dir', b.workspaceGitDir('test-workspace'), 'show', pending.workspaces.backups[0].branch + ':note.txt'], { encoding: 'utf8' });
  assert.equal(saved, 'second edit A\n');
  b.runWithRetry = retry;
  assert.equal((await b.syncOnce('test', { forceCommit: true })).workspaces.errors.length, 0);
  assert.equal((await a.syncOnce('test', { forceCommit: true })).workspaces.errors.length, 0);
  assert.equal(fs.readFileSync(path.join(projectA, 'note.txt'), 'utf8'), 'second edit B\n');
  fs.writeFileSync(path.join(projectB, 'unrelated.txt'), 'untouched\n');
  const latest = b.recovery.list().find(r => r.kind === 'ws' && r.path === 'note.txt');
  const beforeRestore = b.recoveryPreview(latest.id);
  const restore = await b.restoreRecovery(latest.id, 'remote', beforeRestore.currentHash);
  assert.equal(restore.ok, true);
  assert.equal(fs.readFileSync(path.join(projectB, 'note.txt'), 'utf8'), 'second edit A\n');
  assert.equal(fs.readFileSync(path.join(projectB, 'unrelated.txt'), 'utf8'), 'untouched\n');
  assert.equal(b.recoveryPreview(restore.backupId).local.text, 'second edit B\n');
  assert.equal((await b.syncOnce('test', { forceCommit: true })).workspaces.errors.length, 0);
  assert.equal((await a.syncOnce('test', { forceCommit: true })).workspaces.errors.length, 0);
  assert.equal(fs.readFileSync(path.join(projectA, 'note.txt'), 'utf8'), 'second edit A\n');
});
