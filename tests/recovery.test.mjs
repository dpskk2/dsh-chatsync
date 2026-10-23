import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RecoveryStore, digest, restoreFile, safePath, recoveryCategory } from '../lib/recovery.js';
import { SyncEngine } from '../lib/sync.js';

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new RecoveryStore(root);
  const file = path.join(root, 'note.txt');
  fs.writeFileSync(file, 'current');
  const record = store.save({ kind: 'ws', workspaceId: 'example', path: 'note.txt', status: 'merged' },
    { local: Buffer.from('original local'), remote: Buffer.from('original remote') });
  return { root, store, file, record };
}

test('archiving preserves originals and restoration access, validates hashes and can be undone', t => {
  const { store, record } = setup(t);
  const hashes = Object.fromEntries(['local','remote'].map(side => [side,record.versions[side].sha256]));
  assert.throws(() => store.archive(record.id, { ...hashes, remote:'stale' }), /变化/);
  store.archive(record.id,hashes);
  const archived = store.read(record.id);
  assert.equal(recoveryCategory(archived),'history'); assert.equal(archived.status,'merged');
  assert.equal(store.preview(record.id).remote.text,'original remote');
  store.archive(record.id,null,false); assert.equal(recoveryCategory(store.read(record.id)),'attention');
  store.finish(record.id,{imports:{local:{status:'pending'}}});
  assert.throws(() => store.archive(record.id,hashes),/未完成/);
  assert.equal(recoveryCategory({...archived,imports:{local:{status:'pending'}}}),'attention');
  store.finish(record.id,{imports:{}});
  fs.writeFileSync(path.join(store.directory(),record.id,'remote.bin'),'corrupted');
  assert.throws(() => store.archive(record.id,hashes),/校验失败/);
});

test('repair previews and completed backups are history rather than unresolved merges', () => {
  for (const kind of ['scope-backup','data-repair','restore-backup']) assert.equal(recoveryCategory({kind}),'history');
  assert.equal(recoveryCategory({kind:'main',status:'pending'}),'attention');
});

test('selected restoration backs up the current file and can undo without touching unrelated files', t => {
  const { root, store, file, record } = setup(t);
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'untouched');
  const restored = restoreFile(store, record.id, 'remote', root, digest(Buffer.from('current')));
  assert.equal(fs.readFileSync(file, 'utf8'), 'original remote');
  const reloaded = new RecoveryStore(root);
  assert.equal(reloaded.preview(restored.backupId).local.text, 'current');
  restoreFile(reloaded, restored.backupId, 'local', root, restored.sha256);
  assert.equal(fs.readFileSync(file, 'utf8'), 'current');
  assert.equal(fs.readFileSync(path.join(root, 'unrelated.txt'), 'utf8'), 'untouched');
});

test('scoped import backups preview against the main home without requiring a workspace registration', t => {
  const { root, store, file } = setup(t);
  const engine = new SyncEngine(root, { autoRepo: false });
  const record = store.save({ kind: 'scope-backup', path: 'note.txt', status: 'applied' },
    { local: Buffer.from('before import'), remote: Buffer.from('imported') });
  const preview = engine.recoveryPreview(record.id);
  assert.equal(preview.local.text, 'before import');
  assert.equal(preview.remote.text, 'imported');
  assert.equal(preview.currentHash, digest(Buffer.from('current')));
  assert.equal(preview.canRestore, false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'current');
});

test('stale previews, corrupt originals and session restore all stop before writing', t => {
  const { root, store, file, record } = setup(t);
  assert.throws(() => restoreFile(store, record.id, 'remote', root, 'stale'), /文件已/);
  fs.writeFileSync(path.join(store.directory(), record.id, 'remote.bin'), 'damaged');
  assert.throws(() => restoreFile(store, record.id, 'remote', root, digest(Buffer.from('current'))), /校验失败/);
  const main = store.save({ kind: 'main', path: 'note.txt', status: 'merged' }, { local: Buffer.from('x'), remote: Buffer.from('y') });
  assert.throws(() => restoreFile(store, main.id, 'remote', root, digest(Buffer.from('current'))), /只读预览/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'current');
});

test('empty files are kept distinct from deleted versions', t => {
  const { root, store, file } = setup(t);
  const record = store.save({ kind: 'ws', path: 'note.txt', status: 'merged' }, { local: null, remote: Buffer.alloc(0) });
  assert.equal(store.preview(record.id).local.missing, true);
  assert.equal(store.preview(record.id).remote.bytes, 0);
  restoreFile(store, record.id, 'remote', root, digest(Buffer.from('current')));
  assert.equal(fs.statSync(file).size, 0);
  assert.throws(() => restoreFile(store, record.id, 'local', root, digest(Buffer.alloc(0))), /删除状态/);
});

test('restoration rolls back if recording the result fails after replacement', t => {
  const { root, store, file, record } = setup(t);
  store.finish = () => { throw new Error('simulated disk failure'); };
  assert.throws(() => restoreFile(store, record.id, 'remote', root, digest(Buffer.from('current'))), /disk failure/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'current');
  assert.equal(store.list().find(r => r.kind === 'restore-backup').versions.local.sha256, digest(Buffer.from('current')));
});

test('path traversal and directory links cannot access outside recovery or workspace roots', t => {
  const { root } = setup(t);
  for (const file of ['../secret', '/absolute', 'C:/secret', 'a/../../secret', 'a\\b', '.git/../config']) assert.throws(() => safePath(root, file));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => safePath(root, 'linked/secret'), /符号链接/);
});

test('preview and diagnostics on a new home do not initialize Git or write state', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-preview-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const engine = new SyncEngine(root, { autoRepo: false });
  assert.equal((await engine.localPreview()).initialized, false);
  assert.equal(engine.doctor().repositoryInitialized, false);
  assert.equal(engine.handoffStatus(), null);
  assert.deepEqual(fs.readdirSync(root), []);
});
