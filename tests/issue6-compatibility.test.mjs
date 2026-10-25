import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { checkWorkspaceSnapshotSizes, checkWorkspaceSnapshotSizesSync } from '../lib/privacy.js';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-compat-'));
  t.after(() => removeFixture(root));
  const home = path.join(root, 'home'), project = path.join(root, 'project'), remote = path.join(root, 'remote.git');
  fs.mkdirSync(home); fs.mkdirSync(project);
  const git = args => execFileSync('git', args, { cwd: home, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--bare', '--initial-branch=main', remote]);
  const logs = [], engine = new SyncEngine(home, { remote, autoRepo: false, ...overrides }, (_level, message) => logs.push(message));
  engine._verifiedPrivateRemote = engine.loadConfig().remote;
  engine.verifyPrivateRemote = async () => ({ ok: true });
  const ws = { id: 'compat', title: 'Compatibility project', path: project };
  engine.workspaces = () => [ws];
  const gitdir = engine.workspaceGitDir(ws.id), branch = engine.workspaceBranchOf(engine.loadConfig(), ws.id);
  const local = args => git(['--git-dir=' + gitdir, '--work-tree=' + project, ...args]);
  const setup = () => engine.ensureWorkspaceMirror(ws.id, project, engine.loadConfig());
  const sync = () => engine.syncAllWorkspaces(engine.loadConfig(), 'compatibility', { forceCommit: true });
  return { root, home, project, remote, git, local, engine, ws, gitdir, branch, setup, sync, logs };
}
const large = () => Buffer.alloc(9 * 1024 * 1024);

test('compatibility: local-only snapshots keep large files during normal sync and exit', async t => {
  const f = fixture(t, { remote: '' });
  fs.writeFileSync(path.join(f.project, 'local-backup.bin'), large());
  assert.deepEqual((await f.sync()).errors, []);
  assert.equal(f.local(['cat-file', '-s', 'HEAD:local-backup.bin']), String(large().length));
  fs.writeFileSync(path.join(f.project, 'exit-backup.bin'), large());
  f.engine.flushSync();
  assert.equal(f.local(['cat-file', '-s', 'HEAD:exit-backup.bin']), String(large().length));
});

test('compatibility: an unchanged oversized blob already in remote history does not block new small files', async t => {
  const f = fixture(t); await f.setup();
  fs.writeFileSync(path.join(f.project, 'legacy.bin'), large());
  f.local(['add', '.']); f.local(['commit', '-m', 'simulate legacy accepted blob']);
  f.local(['push', 'origin', f.branch]);
  const remoteBefore = f.git(['--git-dir=' + f.remote, 'rev-parse', f.branch]);
  fs.writeFileSync(path.join(f.project, 'new-note.txt'), 'new small edit\n');
  const result = await f.sync();
  assert.deepEqual(result.errors, []); assert.equal(result.pushed, 1);
  assert.notEqual(f.git(['--git-dir=' + f.remote, 'rev-parse', f.branch]), remoteBefore);
  assert.equal(f.git(['--git-dir=' + f.remote, 'show', f.branch + ':new-note.txt']), 'new small edit');
  assert.equal(f.git(['--git-dir=' + f.remote, 'cat-file', '-s', f.branch + ':legacy.bin']), String(large().length));
});

test('compatibility: pre-commit size check uses the same session limit as outgoing privacy scan', { timeout: 30000 }, async t => {
  const f = fixture(t);
  const id = 'session-11111111-1111-1111-1111-111111111111';
  const rel = `sessions/example/${id}/session.jsonl`;
  const bytes = Buffer.from(JSON.stringify({ type: 'session', version: 4, id }) + '\n'
    + JSON.stringify({ type: 'event', seq: 0, time: 1, data: { text: 'a'.repeat(9 * 1024 * 1024) } }) + '\n');
  fs.mkdirSync(path.dirname(path.join(f.project, rel)), { recursive: true }); fs.writeFileSync(path.join(f.project, rel), bytes);
  const result = await f.sync();
  assert.deepEqual(result.errors, []); assert.equal(result.pushed, 1);
  assert.equal(f.git(['--git-dir=' + f.remote, 'cat-file', '-s', f.branch + ':' + rel]), String(bytes.length));
});

test('compatibility: exit still prevents oversized snapshots before remote visibility has been verified', async t => {
  const f = fixture(t); await f.setup(); f.engine._verifiedPrivateRemote = null;
  fs.writeFileSync(path.join(f.project, 'installer.bin'), large());
  f.engine.flushSync();
  assert.equal(await f.engine.rev('HEAD', f.gitdir, f.project), null);
  assert.equal(fs.statSync(path.join(f.project, 'installer.bin')).size, large().length);
});

test('compatibility: project ignore and nested Git exclusions still take precedence over large-file checks', async t => {
  const f = fixture(t, { workspaceExtraIgnore: ['cache'] });
  for (const folder of ['cache', 'nested']) {
    fs.mkdirSync(path.join(f.project, folder));
    fs.writeFileSync(path.join(f.project, folder, 'large.bin'), large());
  }
  f.git(['init', path.join(f.project, 'nested')]);
  fs.writeFileSync(path.join(f.project, '.gitignore'), '*.exe\n');
  fs.writeFileSync(path.join(f.project, 'excluded.exe'), large());
  fs.writeFileSync(path.join(f.project, 'note.txt'), 'included\n');
  assert.deepEqual((await f.sync()).errors, []);
  assert.equal(f.local(['ls-files']), '.gitignore\nnote.txt');
  assert.equal(fs.statSync(path.join(f.project, 'excluded.exe')).size, large().length);
});

test('compatibility: workspace disabled creates no mirror or snapshot even at exit', async t => {
  const f = fixture(t, { workspaceSync: false });
  fs.writeFileSync(path.join(f.project, 'large.bin'), large());
  assert.equal((await f.sync()).skipped, 'disabled');
  f.engine.flushSync();
  assert.equal(fs.existsSync(f.gitdir), false);
});

test('compatibility: one blocked workspace does not block main data or another workspace', { timeout: 30000 }, async t => {
  const f = fixture(t), healthy = path.join(f.root, 'healthy'); fs.mkdirSync(healthy);
  const other = { id: 'healthy', title: 'Healthy project', path: healthy };
  f.engine.workspaces = () => [f.ws, other];
  fs.mkdirSync(path.join(f.home, 'attachments')); fs.writeFileSync(path.join(f.home, 'attachments/note.txt'), 'main data\n');
  fs.writeFileSync(path.join(healthy, 'note.txt'), 'healthy project\n');
  fs.writeFileSync(path.join(f.project, 'installer.bin'), large());
  const result = await f.engine.syncOnce('compatibility', { forceCommit: true });
  assert.match(result.error, /上传已暂停/);
  assert.equal(result.workspaces.synced, 1); assert.equal(result.workspaces.errors.length, 1);
  assert.equal(f.git(['--git-dir=' + f.remote, 'show', 'main:attachments/note.txt']), 'main data');
  assert.equal(f.git(['--git-dir=' + f.remote, 'show', 'ws/healthy:note.txt']), 'healthy project');
  assert.notEqual(spawnSync('git', ['--git-dir=' + f.remote, 'rev-parse', '--verify', f.branch], { stdio: 'ignore' }).status, 0);
});

test('compatibility: raw Git failures explain the error without exposing credential values', async t => {
  const f = fixture(t), token = 'ghp_' + 'Q'.repeat(40);
  fs.writeFileSync(path.join(f.project, 'note.txt'), 'local content\n');
  const invoke = f.engine.gitW.bind(f.engine);
  f.engine.gitW = (dir, tree, args, ...rest) => args[0] === 'commit'
    ? Promise.resolve({ code: 1, out: '', err: 'pre-commit hook failed; token=' + token })
    : invoke(dir, tree, args, ...rest);
  const result = await f.sync();
  assert.equal(result.errors[0].operation, 'commit'); assert.match(result.errors[0].error, /pre-commit hook failed/);
  assert.ok(!JSON.stringify({ result, logs: f.logs }).includes(token));
});

test('compatibility: staged object metadata is checked in bounded batches, including unusual filenames', async t => {
  const f = fixture(t); await f.setup();
  for (let i = 0; i < 600; i++) fs.writeFileSync(path.join(f.project, 'note-' + i + '.txt'), 'unique ' + i);
  fs.writeFileSync(path.join(f.project, '空格 name.txt'), 'filename fixture');
  f.local(['add', '.']);
  assert.deepEqual(await checkWorkspaceSnapshotSizes(f.engine, f.gitdir, f.project), []);
  assert.deepEqual(checkWorkspaceSnapshotSizesSync(f.engine, f.gitdir, f.project), []);
  assert.equal(f.local(['ls-files', '-z']).split('\0').filter(Boolean).length, 601);
});

test('compatibility: copying a previously uploaded large blob adds no new object, while editing its content is blocked', async t => {
  const f = fixture(t); await f.setup();
  const original = path.join(f.project, 'legacy.bin'); fs.writeFileSync(original, large());
  f.local(['add', '.']); f.local(['commit', '-m', 'synthetic legacy upload']); f.local(['push', 'origin', f.branch]);
  fs.copyFileSync(original, path.join(f.project, 'copy.bin'));
  fs.renameSync(original, path.join(f.project, 'renamed.bin'));
  assert.deepEqual((await f.sync()).errors, []);
  const head = f.local(['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(f.project, 'copy.bin'), Buffer.alloc(9 * 1024 * 1024, 1));
  assert.match((await f.sync()).errors[0].error, /单文件检查上限/);
  assert.equal(f.local(['rev-parse', 'HEAD']), head);
  assert.equal(f.git(['--git-dir=' + f.remote, 'rev-parse', f.branch]), head);
});

test('compatibility: saved automation-off and explicit Git identity survive restart and manual sync', async t => {
  const f = fixture(t, { remote: '' });
  f.engine.writeConfig({ enabled: false, autoPullOnStart: false, autoPushOnExit: false,
    gitUserName: 'Explicit author', gitUserEmail: 'author@invalid' });
  const reloaded = new SyncEngine(f.home, { remote: '', autoRepo: false });
  reloaded.workspaces = () => [f.ws];
  const before = fs.readFileSync(reloaded.configPath());
  const cfg = reloaded.loadConfig();
  assert.equal(cfg.enabled, false); assert.equal(cfg.autoPullOnStart, false); assert.equal(cfg.autoPushOnExit, false);
  fs.writeFileSync(path.join(f.project, 'note.txt'), 'manual still works\n');
  assert.deepEqual((await reloaded.syncAllWorkspaces(cfg, 'manual', { forceCommit: true })).errors, []);
  assert.equal(f.local(['show', '-s', '--format=%an <%ae>', 'HEAD']), 'Explicit author <author@invalid>');
  assert.deepEqual(fs.readFileSync(reloaded.configPath()), before);
  assert.equal(new SyncEngine(f.home).loadConfig().enabled, false);
});

test('compatibility: truncated staged change listing is rejected in both normal and exit checks', async t => {
  const f = fixture(t); await f.setup();
  const partial = { code: 0, out: ':000000 100644 ' + '0'.repeat(40) + ' ' + 'a'.repeat(40) + ' A\0note.txt', err: '' };
  const invoke = f.engine.gitInput.bind(f.engine), invokeSync = f.engine.gitWSync.bind(f.engine);
  f.engine.gitInput = (args, ...rest) => args.includes('--raw') ? Promise.resolve(partial) : invoke(args, ...rest);
  f.engine.gitWSync = (dir, tree, args, ...rest) => args.includes('--raw') ? partial : invokeSync(dir, tree, args, ...rest);
  await assert.rejects(checkWorkspaceSnapshotSizes(f.engine, f.gitdir, f.project), /清单不完整/);
  assert.throws(() => checkWorkspaceSnapshotSizesSync(f.engine, f.gitdir, f.project), /清单不完整/);
});
