import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { previewWorkspaceHistory, applyWorkspaceHistory } from '../lib/workspace-history.js';
import { SyncEngine } from '../lib/sync.js';
import { syncIssues } from '../lib/diagnostics.js';
import { transportable } from '../lib/scope.js';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-issue6-'));
  t.after(() => removeFixture(root));
  const home = path.join(root, 'home'), project = path.join(root, 'project');
  const remote = path.join(root, 'remote.git'), globalConfig = path.join(root, 'empty-gitconfig');
  fs.mkdirSync(home); fs.mkdirSync(project); fs.writeFileSync(globalConfig, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig };
  for (const key of Object.keys(env)) if (/^GIT_(?:AUTHOR_|COMMITTER_|CONFIG_(?:COUNT|KEY_|VALUE_))|^EMAIL$/.test(key)) delete env[key];
  const git = (args, cwd = root) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--bare', '--initial-branch=main', remote]);
  const seed = path.join(root, 'seed'); fs.mkdirSync(seed);
  git(['init', '-b', 'main'], seed);
  git(['config', 'user.name', 'synthetic seed'], seed); git(['config', 'user.email', 'seed@invalid'], seed);
  fs.writeFileSync(path.join(seed, 'main-only.txt'), 'main history stays separate\n');
  git(['add', '.'], seed); git(['commit', '-m', 'synthetic main'], seed); git(['push', remote, 'main'], seed);
  const engine = new SyncEngine(home, { remote, autoRepo: false, ...overrides });
  engine._gitEnv = env;
  const ws = { id: 'default-workspace', title: 'Issue 6 fixture', path: project };
  engine.workspaces = () => [ws];
  const gitdir = engine.workspaceGitDir(ws.id), branch = 'ws/' + ws.id;
  const local = args => git(['--git-dir=' + gitdir, '--work-tree=' + project, ...args]);
  const sync = (opts = { forceCommit: true }) => engine.syncAllWorkspaces(engine.loadConfig(), 'issue6-fixture', opts);
  return { root, home, project, remote, globalConfig, env, git, local, engine, ws, gitdir, branch, sync };
}

test('issue 6: main-only remote accepts first workspace upload without global Git identity', { timeout: 30000 }, async t => {
  const f = fixture(t, { gitUserName: ' ', gitUserEmail: null });
  const { engine, project, sync, git, remote, branch, globalConfig, local } = f;
  fs.writeFileSync(path.join(project, 'note.txt'), 'first upload\n');
  const before = git(['--git-dir=' + remote, 'rev-parse', 'main']);
  const result = await sync();
  assert.deepEqual(result.errors, []); assert.equal(result.pushed, 1);
  assert.equal(git(['--git-dir=' + remote, 'show', branch + ':note.txt']), 'first upload');
  assert.equal(git(['--git-dir=' + remote, 'rev-parse', 'main']), before);
  assert.equal(local(['config', '--local', 'user.name']), 'dsh-chatsync');
  assert.equal(local(['config', '--local', 'user.email']), 'dsh-chatsync@localhost');
  assert.equal(fs.readFileSync(globalConfig, 'utf8'), '');
  assert.equal(await engine.rev('refs/remotes/origin/main', f.gitdir, project), null);
  // An empty second device restores from the same ws branch using real Git.
  const secondHome = path.join(f.root, 'second-home'), secondProject = path.join(f.root, 'second-project');
  fs.mkdirSync(secondHome);
  const second = new SyncEngine(secondHome, { remote, autoRepo: false }); second._gitEnv = f.env;
  const restored = await second.syncWorkspace({ ...f.ws, path: secondProject }, second.loadConfig(), 'issue6-restore', { forceCommit: true });
  assert.equal(restored.error, undefined, JSON.stringify(restored)); assert.ok(restored.pulled);
  assert.equal(fs.readFileSync(path.join(secondProject, 'note.txt'), 'utf8'), 'first upload\n');
});

test('issue 6: empty remote and empty workspace are valid first-sync states', { timeout: 30000 }, async t => {
  const f = fixture(t);
  f.git(['--git-dir=' + f.remote, 'update-ref', '-d', 'refs/heads/main']);
  let result = await f.sync();
  assert.deepEqual(result.errors, []); assert.equal(result.synced, 1); assert.equal(result.pushed, 0);
  fs.writeFileSync(path.join(f.project, 'note.txt'), 'new remote\n');
  result = await f.sync();
  assert.deepEqual(result.errors, []); assert.equal(result.pushed, 1);
});

test('issue 6: failed branch probe cannot turn an unreachable remote into first upload', { timeout: 30000 }, async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.project, 'note.txt'), 'preserved offline snapshot\n');
  const invoke = f.engine.gitW.bind(f.engine); let pushes = 0;
  f.engine.gitW = async (dir, tree, args, ...rest) => {
    if (args[0] === 'ls-remote') return { code: 128, out: '', err: 'synthetic authentication failure' };
    if (args[0] === 'push') pushes++;
    return invoke(dir, tree, args, ...rest);
  };
  const result = await f.sync();
  assert.equal(result.synced, 0); assert.equal(result.errors[0].error, 'fetch'); assert.equal(pushes, 0);
  assert.equal(f.local(['show', 'HEAD:note.txt']), 'preserved offline snapshot');
  assert.equal(fs.readFileSync(path.join(f.project, 'note.txt'), 'utf8'), 'preserved offline snapshot\n');
});

test('issue 6: changed identity and external duplicate config are repaired in the same engine', async t => {
  const f = fixture(t), cfg = f.engine.loadConfig();
  assert.equal(await f.engine.ensureWorkspaceMirror(f.ws.id, f.project, cfg), true);
  f.local(['config', 'user.name', 'external identity']);
  f.local(['config', '--unset-all', 'user.email']);
  f.local(['config', '--add', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
  const changed = { ...cfg, gitUserName: 'new identity', gitUserEmail: 'new@invalid' };
  assert.equal(await f.engine.ensureWorkspaceMirror(f.ws.id, f.project, changed), true);
  assert.equal(f.local(['config', '--local', 'user.name']), changed.gitUserName);
  assert.equal(f.local(['config', '--local', 'user.email']), changed.gitUserEmail);
  assert.equal(f.local(['config', '--local', '--get-all', 'remote.origin.fetch']), '+refs/heads/' + f.branch + ':refs/remotes/origin/' + f.branch);
  const invoke = f.engine.gitW.bind(f.engine); let writes = 0;
  f.engine.gitW = (...args) => { if (args[2].includes('--replace-all')) writes++; return invoke(...args); };
  await f.engine.ensureWorkspaceMirror(f.ws.id, f.project, changed);
  assert.equal(writes, 0);
});

test('issue 6: real config lock is reported before any workspace transfer and retries after unlock', async t => {
  const f = fixture(t);
  await f.engine.ensureWorkspaceMirror(f.ws.id, f.project, f.engine.loadConfig());
  f.local(['config', '--unset-all', 'user.email']);
  const lock = path.join(f.gitdir, 'config.lock'); fs.writeFileSync(lock, '');
  fs.writeFileSync(path.join(f.project, 'note.txt'), 'keep local\n');
  let result = await f.sync();
  assert.equal(result.errors[0].operation, 'config');
  assert.match(result.errors[0].gitError, /could not lock config file/);
  assert.equal(result.errors[0].path, f.project);
  assert.equal(fs.readFileSync(path.join(f.project, 'note.txt'), 'utf8'), 'keep local\n');
  fs.unlinkSync(lock);
  result = await f.sync(); assert.deepEqual(result.errors, []); assert.equal(result.pushed, 1);
});

for (const operation of ['status', 'add', 'commit']) test(`issue 6: ${operation} failure surfaces Git reason and preserves dirty files against remote updates`, { timeout: 30000 }, async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.project, 'note.txt'), 'shared base\n');
  assert.deepEqual((await f.sync()).errors, []);
  const writer = path.join(f.root, 'writer'); f.git(['clone', '-b', f.branch, f.remote, writer]);
  f.git(['config', 'user.name', 'synthetic writer'], writer); f.git(['config', 'user.email', 'writer@invalid'], writer);
  fs.writeFileSync(path.join(writer, 'note.txt'), 'remote update\n');
  f.git(['add', '.'], writer); f.git(['commit', '-m', 'remote update'], writer); f.git(['push', 'origin', f.branch], writer);
  const remoteHead = f.git(['--git-dir=' + f.remote, 'rev-parse', f.branch]);
  fs.writeFileSync(path.join(f.project, 'note.txt'), 'unsaved local edit\n');
  const invoke = f.engine.gitW.bind(f.engine); let injected = false; const commands = [];
  f.engine.gitW = async (dir, tree, args, ...rest) => {
    commands.push(args[0]);
    if (args[0] === operation && !injected) {
      injected = true;
      if (operation === 'status') return { code: 128, out: '', err: 'synthetic unreadable index' };
      if (operation === 'add') fs.writeFileSync(path.join(dir, 'index.lock'), '');
      if (operation === 'commit') { f.local(['config', 'user.name', '']); f.local(['config', 'user.email', '']); }
    }
    return invoke(dir, tree, args, ...rest);
  };
  const result = await f.sync();
  assert.equal(result.synced, 0); assert.equal(result.errors[0].operation, operation);
  assert.match(result.errors[0].error, /快照未保存/);
  assert.match(result.errors[0].gitError, operation === 'status' ? /unreadable index/ : operation === 'add' ? /index.lock/ : /identity unknown|empty ident/);
  assert.equal(fs.readFileSync(path.join(f.project, 'note.txt'), 'utf8'), 'unsaved local edit\n');
  assert.equal(f.git(['--git-dir=' + f.remote, 'rev-parse', f.branch]), remoteHead);
  assert.ok(!commands.some(command => ['merge', 'reset', 'checkout', 'push'].includes(command)));
  if (operation === 'add') assert.ok(!commands.includes('commit'));
  const issue = syncIssues({ workspaces: result })[0];
  assert.equal(issue.code, 'WORKSPACE_' + operation.toUpperCase() + '_FAILED');
  assert.ok(issue.reason.includes(result.errors[0].gitError));
  if (operation === 'commit') assert.match(issue.action, /gitUserName.*gitUserEmail/);
});

test('issue 6: desktop Electron runtime is excluded before traversal; existing tracked copy leaves index only', async t => {
  const f = fixture(t), runtime = path.join(f.home, 'electron'); fs.mkdirSync(runtime);
  fs.writeFileSync(path.join(runtime, 'default_app.asar'), 'synthetic runtime');
  assert.equal(transportable('electron'), false); assert.equal(transportable('electron/default_app.asar'), false);
  assert.equal(transportable('skills/electron/example.txt'), true);
  assert.equal(await f.engine.ensureRepo(f.engine.loadConfig()), true);
  // Simulate a previously tracked runtime and user-maintained .gitignore.
  await f.engine.git(['add', '-f', '--', 'electron/default_app.asar']);
  fs.writeFileSync(path.join(f.home, '.gitignore'), '# user rule\nprivate-notes/\n');
  assert.equal(await f.engine.ensureRepo(f.engine.loadConfig()), true);
  assert.equal((await f.engine.git(['ls-files', '--', 'electron'])).out, '');
  assert.equal(fs.readFileSync(path.join(runtime, 'default_app.asar'), 'utf8'), 'synthetic runtime');
  assert.match(fs.readFileSync(path.join(f.home, '.gitignore'), 'utf8'), /^\/electron\/$/m);
  assert.match(fs.readFileSync(path.join(f.home, '.gitignore'), 'utf8'), /^private-notes\/$/m);
  // Simulate Electron's patched fs throwing if the runtime is touched.
  const readDir = fs.readdirSync;
  fs.readdirSync = (target, ...rest) => {
    assert.notEqual(path.resolve(target), runtime, 'must not descend into Electron installation');
    return readDir(target, ...rest);
  };
  try {
    f.engine.verifyPrivateRemote = async () => ({ ok: true });
    f.engine.overrides.workspaceSync = false;
    const result = await f.engine.syncOnce('issue6-electron', { forceCommit: true });
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.notEqual(spawnSync('git', ['--git-dir=' + f.remote, 'show', 'main:electron/default_app.asar'], { stdio: 'ignore' }).status, 0);
  } finally { fs.readdirSync = readDir; }
});

test('issue 6: oversized installer never enters normal or exit snapshots; ignore then retry needs no history rewrite', { timeout: 30000 }, async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.project, 'note.txt'), 'small project\n');
  assert.deepEqual((await f.sync()).errors, []);
  const head = f.local(['rev-parse', 'HEAD']);
  const installer = path.join(f.project, 'installer with spaces.exe');
  fs.writeFileSync(installer, Buffer.alloc(66 * 1024 * 1024));
  const result = await f.sync();
  assert.equal(result.synced, 0); assert.match(result.errors[0].error, /8 MiB/);
  assert.equal(f.local(['rev-parse', 'HEAD']), head);
  const report = f.engine._privacyReport;
  assert.equal(report.stage, 'before-commit');
  assert.equal(report.findings[0].size, 66 * 1024 * 1024);
  assert.equal(report.findings[0].file, 'installer with spaces.exe');
  assert.match(syncIssues({ privacy: report })[0].action, /尚未写入本次快照/);
  f.engine.flushSync();
  assert.equal(f.local(['rev-parse', 'HEAD']), head);
  assert.equal(fs.statSync(installer).size, 66 * 1024 * 1024);
  fs.writeFileSync(path.join(f.project, '.gitignore'), '*.exe\n');
  assert.deepEqual((await f.sync()).errors, []);
  assert.doesNotMatch(f.git(['--git-dir=' + f.remote, 'rev-list', '--objects', f.branch]), /installer with spaces/);
  assert.equal(fs.statSync(installer).size, 66 * 1024 * 1024);
});

test('issue 6: deleted oversized history is blocked until an explicit checked rebuild preserves its backup', { timeout: 30000 }, async t => {
  const f = fixture(t);
  await f.engine.ensureWorkspaceMirror(f.ws.id, f.project, f.engine.loadConfig());
  const installer = path.join(f.project, 'old-installer.exe');
  fs.writeFileSync(installer, Buffer.alloc(66 * 1024 * 1024));
  f.local(['add', '.']); f.local(['commit', '-m', 'simulate old unsent oversized snapshot']);
  await f.sync();
  f.engine.verifyPrivateRemote = async () => ({ok:true});
  await assert.rejects(previewWorkspaceHistory(f.engine, f.ws.id), /当前快照仍有/);
  fs.unlinkSync(installer); f.local(['add', '-A']); f.local(['commit', '-m', 'delete installer from current tree']);
  const before = f.local(['rev-parse', 'HEAD']);
  const result = await f.sync();
  assert.equal(result.synced, 0); assert.equal(result.errors[0].error, 'push');
  assert.equal(f.local(['rev-parse', 'HEAD']), before);
  assert.equal(f.local(['cat-file', '-s', 'HEAD~1:old-installer.exe']), String(66 * 1024 * 1024));
  const report = f.engine._privacyReport;
  assert.equal(report.stage, undefined);
  assert.equal(report.findings[0].file, 'old-installer.exe');
  assert.match(syncIssues({ privacy: report })[0].action, /仅删除当前文件不能清除历史/);
  assert.notEqual(spawnSync('git', ['--git-dir=' + f.remote, 'rev-parse', '--verify', f.branch], { stdio: 'ignore' }).status, 0);
  f.engine.verifyPrivateRemote = async () => ({ok:true});
  const plan = await previewWorkspaceHistory(f.engine, f.ws.id);
  assert.equal(f.local(['rev-parse','HEAD']),before, 'preview cannot move refs');
  const applied = await applyWorkspaceHistory(f.engine, plan.previewId);
  assert.equal(f.local(['rev-parse',applied.backupBranch]),before);
  assert.equal(f.local(['cat-file','-s',applied.backupBranch+'~1:old-installer.exe']),String(66*1024*1024));
  assert.equal(fs.existsSync(installer),false);
  assert.deepEqual((await f.sync()).errors,[]);
  assert.equal(f.git(['--git-dir='+f.remote,'ls-tree','-r',f.branch]),'');
});

test('issue 6: incomplete staged-size check stops before commit or transfer', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.project, 'note.txt'), 'preserved content\n');
  const invoke = f.engine.gitInput.bind(f.engine);
  f.engine.gitInput = async (args, ...rest) => args.includes('--batch-check')
    ? { code: 1, out: '', err: '', outputLimit: true } : invoke(args, ...rest);
  const result = await f.sync();
  assert.equal(result.synced, 0); assert.match(result.errors[0].error, /无法检查工作区暂存对象大小/);
  assert.equal(await f.engine.rev('HEAD', f.gitdir, f.project), null);
  assert.equal(fs.readFileSync(path.join(f.project, 'note.txt'), 'utf8'), 'preserved content\n');
});


test('issue 6: legacy project migration preserves an uncommitted local deletion', async t => {
  const f=fixture(t);await f.engine.ensureWorkspaceMirror(f.ws.id,f.project,f.engine.loadConfig());
  const file=path.join(f.project,'deleted.txt');fs.writeFileSync(file,'legacy original');
  f.local(['add','.']);f.local(['commit','-m','legacy project']);fs.unlinkSync(file);
  assert.deepEqual((await f.sync()).errors,[]);
  assert.equal(fs.existsSync(file),false);
  assert.equal(f.git(['--git-dir='+f.remote,'ls-tree','-r',f.branch]),'');
});

test('issue 6: history rebuild keeps the published parent and rejects stale previews',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.project,'note.txt'),'published');await f.sync();
  const published=f.git(['--git-dir='+f.remote,'rev-parse',f.branch]);
  const large=path.join(f.project,'old.exe');fs.writeFileSync(large,Buffer.alloc(9*1024*1024));
  f.local(['add','.']);f.local(['commit','-m','legacy oversized']);fs.unlinkSync(large);
  f.local(['add','-A']);f.local(['commit','-m','remove from snapshot']);await f.sync();
  f.engine.verifyPrivateRemote=async()=>({ok:true});
  const plan=await previewWorkspaceHistory(f.engine,f.ws.id);
  assert.equal(f.git(['--git-dir='+f.remote,'rev-parse',f.branch]),published);
  const old=f.local(['rev-parse','HEAD']);
  f.local(['commit','--allow-empty','-m','other process changes HEAD']);
  await assert.rejects(applyWorkspaceHistory(f.engine,plan.previewId),/变化/);
  assert.notEqual(f.local(['rev-parse','HEAD']),old);
  const current=await previewWorkspaceHistory(f.engine,f.ws.id);
  await applyWorkspaceHistory(f.engine,current.previewId);
  assert.equal(f.local(['show','-s','--format=%P','HEAD']),published);
  assert.deepEqual((await f.sync()).errors,[]);
  assert.equal(f.local(['show','HEAD:note.txt']),'published');
});
