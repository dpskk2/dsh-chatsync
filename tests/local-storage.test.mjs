import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import {
  scanLocalStorage,
  previewStorageCleanup,
  applyStorageCleanup,
  saveStoragePolicy,
} from '../lib/local-storage.js';
import { scopeMirrorPath } from '../lib/scope.js';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-storage-'));
  t.after(() => removeFixture(root));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const engine = new SyncEngine(home, { autoRepo: false, workspaceSync: false, enabled: false });
  saveStoragePolicy(engine, { retentionDays: 0 });
  const put = (name, value) => {
    const file = path.join(home, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
    return file;
  };
  return { root, home, engine, put };
}
async function previewFile(h, file) {
  const scan = await scanLocalStorage(h.engine),
    row = scan.items.find(item => item.path === file);
  assert.ok(row);
  assert.equal(row.protected, false, row.reason);
  return previewStorageCleanup(h.engine, { ids: [row.id] });
}
test('cleanup deletes only previewed completed backups and leaves live files and pending records byte-identical', async t => {
  const h = fixture(t),
    live = h.put('attachments/keep.txt', 'attachment bytes');
  const done = h.engine.recovery.save(
    { kind: 'scope-backup', status: 'applied', path: 'a.txt' },
    { local: Buffer.from('before'), remote: Buffer.from('after') },
  );
  const pending = h.engine.recovery.save(
    { kind: 'main', status: 'merged', path: 'pending.txt' },
    { local: Buffer.from('pending'), remote: Buffer.from('other') },
  );
  const file = path.dirname(h.engine.recovery.recordPath(done.id));
  const preview = await previewFile(h, file);
  const result = await applyStorageCleanup(h.engine, { token: preview.token, confirm: true });
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readFileSync(live, 'utf8'), 'attachment bytes');
  assert.equal(h.engine.recovery.version(h.engine.recovery.read(pending.id), 'local').toString(), 'pending');
  await assert.rejects(applyStorageCleanup(h.engine, { token: preview.token, confirm: true }), /过期/);
});
test('changed bytes, newly pending seed and corrupted metadata invalidate cleanup before deletion', async t => {
  const h = fixture(t),
    a = h.put('.chatsync-local/config-history/a.json', 'first');
  let preview = await previewFile(h, a);
  fs.writeFileSync(a, 'second');
  await assert.rejects(applyStorageCleanup(h.engine, { token: preview.token, confirm: true }), /变化/);
  assert.equal(fs.readFileSync(a, 'utf8'), 'second');
  const seed = h.put('.chatsync-local/session-applications/seed.jsonl', 'seed bytes');
  preview = await previewFile(h, seed);
  h.put(
    '.chatsync-local/session-applications.json',
    JSON.stringify({ 'sessions/x': { source: '.chatsync-local/session-applications/seed.jsonl' } }),
  );
  await assert.rejects(applyStorageCleanup(h.engine, { token: preview.token, confirm: true }), /变化/);
  h.put('.chatsync-local/session-applications.json', '{bad');
  const scan = await scanLocalStorage(h.engine);
  assert.ok(scan.warnings.length);
  assert.ok(scan.items.every(row => row.protected));
  assert.equal(fs.readFileSync(seed, 'utf8'), 'seed bytes');
});
test('all selection is rechecked before any item is removed, and arbitrary paths cannot be submitted', async t => {
  const h = fixture(t),
    a = h.put('.chatsync-local/config-history/a.json', 'a'),
    b = h.put('.chatsync-local/config-history/b.json', 'b');
  const scan = await scanLocalStorage(h.engine),
    ids = scan.items.filter(row => row.category === 'config').map(row => row.id);
  const preview = await previewStorageCleanup(h.engine, { ids });
  fs.writeFileSync(b, 'changed');
  await assert.rejects(applyStorageCleanup(h.engine, { token: preview.token, confirm: true }), /变化/);
  assert.equal(fs.readFileSync(a, 'utf8'), 'a');
  await assert.rejects(previewStorageCleanup(h.engine, { ids: ['../../attachments'] }), /保护|变化/);
  await assert.rejects(previewStorageCleanup(h.engine, { ids: [ids[0], ids[0]] }), /选择/);
});
test('retention, active repository, cross-process lock and explicit confirmation are enforced', async t => {
  const h = fixture(t),
    file = h.put('.chatsync-local/config-history/new.json', '{}');
  saveStoragePolicy(h.engine, { retentionDays: 30 });
  let scan = await scanLocalStorage(h.engine);
  assert.match(scan.items.find(row => row.path === file).reason, /保留时间/);
  saveStoragePolicy(h.engine, { retentionDays: 0 });
  const active = path.dirname(scopeMirrorPath(h.home, h.engine.loadConfig()));
  fs.mkdirSync(active, { recursive: true });
  scan = await scanLocalStorage(h.engine);
  assert.match(scan.items.find(row => row.path === active).reason, /当前/);
  const preview = await previewFile(h, file);
  await assert.rejects(applyStorageCleanup(h.engine, { token: preview.token }), /确认/);
  const release = h.engine.acquireProcessLock();
  await assert.rejects(applyStorageCleanup(h.engine, { token: preview.token, confirm: true }), /进程/);
  release();
  h.engine.inFlight = Promise.resolve();
  await assert.rejects(scanLocalStorage(h.engine), /同步进行中/);
  h.engine.inFlight = null;
  assert.equal(fs.existsSync(file), true);
});
test('queued and unexpired repair plans protect originals, while expired unused previews can be cleaned', async t => {
  const h = fixture(t),
    record = h.engine.recovery.save(
      { kind: 'data-repair', status: 'repaired', path: 'x' },
      { local: Buffer.from('a'), remote: Buffer.from('b') },
    );
  const id = randomUUID(),
    expired = randomUUID();
  h.put(
    '.chatsync-local/data-repair/plans/' + id + '.json',
    JSON.stringify({ id, expiresAt: Date.now() + 60000, files: [{ backupId: record.id }] }),
  );
  const old = h.put(
    '.chatsync-local/data-repair/plans/' + expired + '.json',
    JSON.stringify({ id: expired, expiresAt: 1, files: [] }),
  );
  h.put('.chatsync-local/data-repair/queue.json', JSON.stringify([id]));
  const scan = await scanLocalStorage(h.engine);
  assert.equal(scan.items.find(row => row.recordId === record.id).protected, true);
  const preview = await previewFile(h, old);
  assert.equal((await applyStorageCleanup(h.engine, { token: preview.token, confirm: true })).ok, true);
  assert.equal(h.engine.recovery.read(record.id).status, 'repaired');
});
test('junctions and nested links never authorize deletion outside the data root', async t => {
  const h = fixture(t),
    outside = path.join(h.root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'unique');
  const link = path.join(h.home, '.chatsync-local/config-history/link');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  const scan = await scanLocalStorage(h.engine),
    row = scan.items.find(item => item.path === link);
  assert.equal(row.protected, true);
  await assert.rejects(previewStorageCleanup(h.engine, { ids: [row.id] }), /保护/);
  assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'unique');
});
test('project vaults require owner metadata, completed recovery and separate confirmation; hardlinked current files survive', async t => {
  const h = fixture(t),
    project = path.join(h.root, 'project');
  fs.mkdirSync(project);
  h.engine.workspaces = () => [{ id: 'workspace-fixture', path: project }];
  h.engine.workspaceRealPathOf = () => project;
  const live = path.join(project, 'file.txt');
  fs.writeFileSync(live, 'active inode bytes');
  const record = h.engine.recovery.save(
    { kind: 'restore-backup', status: 'restored', workspaceId: 'workspace-fixture', path: 'file.txt' },
    { local: Buffer.from('backup'), remote: Buffer.from('current') },
  );
  const vault = project + '.chatsync-backups',
    folder = path.join(vault, record.id);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(vault, 'owner.json'), JSON.stringify({ format: 1, project }));
  fs.linkSync(live, path.join(folder, 'latest-original'));
  fs.chmodSync(live, 0o444);
  const originalMode = fs.statSync(live).mode;
  const preview = await previewFile(h, folder);
  assert.equal(preview.separateConfirmation, true);
  await assert.rejects(applyStorageCleanup(h.engine, { token: preview.token, confirm: true }), /单独确认/);
  const result = await applyStorageCleanup(h.engine, { token: preview.token, confirm: true, confirmSeparate: true });
  assert.equal(result.ok, true);
  assert.equal(result.results[0].sharedLinks, true);
  assert.equal(fs.readFileSync(live, 'utf8'), 'active inode bytes');
  assert.equal(fs.statSync(live).mode, originalMode);
});
test('old synchronized repositories can be removed only when clean and fully covered by recorded remote refs', async t => {
  const h = fixture(t),
    remote = path.join(h.root, 'remote.git');
  const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  git(['init', '--bare', remote], h.root);
  const old = path.join(h.home, '.chatsync-local/main-views/old'),
    tree = path.join(old, 'tree');
  fs.mkdirSync(old, { recursive: true });
  git(['clone', remote, tree], h.root);
  git(['config', 'user.name', 'Fixture'], tree);
  git(['config', 'user.email', 'fixture@example.invalid'], tree);
  fs.writeFileSync(path.join(tree, 'fixture.txt'), 'snapshot');
  git(['add', '.'], tree);
  git(['commit', '-m', 'synthetic'], tree);
  git(['push', 'origin', 'HEAD'], tree);
  const preview = await previewFile(h, old);
  const removed = await applyStorageCleanup(h.engine, { token: preview.token, confirm: true, confirmSeparate: true });
  assert.equal(removed.ok, true, JSON.stringify(removed));
  assert.equal(fs.existsSync(old), false);
  git(['--git-dir', remote, 'fsck', '--full'], h.root);
  git(['clone', remote, tree], h.root);
  fs.writeFileSync(path.join(tree, 'uncommitted.txt'), 'only copy');
  const row = (await scanLocalStorage(h.engine)).items.find(item => item.path === old);
  assert.equal(row.protected, true);
  assert.match(row.reason, /独有/);
});

test('configuration or dependency changes during asynchronous repository inspection invalidate the entire inventory', async t => {
  const h = fixture(t),
    old = path.join(h.home, '.chatsync-local/main-views/old');
  fs.mkdirSync(path.join(old, 'tree'), { recursive: true });
  const backup = h.put('.chatsync-local/config-history/keep.json', 'still needed');
  let changed = false;
  h.engine.gitW = async () => {
    if (!changed) {
      changed = true;
      h.put(
        '.chatsync-local/session-applications.json',
        JSON.stringify({ pending: { source: '.chatsync-local/session-applications/seed.jsonl' } }),
      );
    }
    return { code: 0, out: '', err: '' };
  };
  await assert.rejects(scanLocalStorage(h.engine), /记录发生变化/);
  assert.equal(fs.readFileSync(backup, 'utf8'), 'still needed');
});
