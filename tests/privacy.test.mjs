import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { zstdCompressSync } from 'node:zlib';
import { inspectContent, scanOutgoing } from '../lib/privacy.js';
import { SyncEngine } from '../lib/sync.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';

function gitFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-privacy-batch-'));
  t.after(() => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); removeFixture(root); });
  const home = path.join(root, 'home'), remote = path.join(root, 'remote.git'); fs.mkdirSync(home);
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  const engine = acceptFixturePreviews(new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false }));
  // These exercise the isolated transport's history protocol. The host/mirror
  // boundary and concurrent producer are covered by session-transfer.test.mjs.
  engine._isolatedTransport = true;
  engine.verifyPrivateRemote = async () => ({ ok: true });
  return { root, home, remote, engine };
}

test('legacy and cache cleanup cannot upload pending secrets before the normal privacy check', { timeout: 90000 }, async t => {
  for (const kind of ['legacy', 'cache']) {
    const { home, remote, engine } = gitFixture(t);
    fs.writeFileSync(path.join(home, 'base.txt'), 'safe baseline\n');
    assert.equal((await engine.syncOnce('cleanup-test', { forceCommit: true })).error, undefined);
    const before = execFileSync('git', ['--git-dir', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
    const copy = kind === 'legacy' ? 'note.txt.dsh-conflict-fixture' : 'storages/session_projcache/note.txt.dsh-conflict-fixture';
    fs.mkdirSync(path.dirname(path.join(home, copy)), { recursive: true });
    fs.writeFileSync(path.join(home, copy), 'old safe conflict copy\n');
    assert.equal(engine.ok(await engine.git(['add', '--', copy])), true);
    assert.equal(engine.ok(await engine.git(['commit', '-m', 'unpublished old conflict copy'])), true);
    if (kind === 'legacy') {
      const stateFile = path.join(home, '.dsh-sync.state.json');
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); state.legacyConflictCleanup = false;
      fs.writeFileSync(stateFile, JSON.stringify(state));
    }
    fs.writeFileSync(path.join(home, 'pending-secret.txt'), 'ghp_' + 'Q'.repeat(40));
    const value = await engine.syncOnce('cleanup-test', { forceCommit: true });
    assert.match(value.error, /上传已暂停/, JSON.stringify(value));
    assert.equal(fs.existsSync(path.join(home, copy)), false);
    assert.equal(execFileSync('git', ['--git-dir', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim(), before);
    assert.notEqual(spawnSync('git', ['--git-dir', remote, 'show', 'main:pending-secret.txt'], { stdio: 'ignore' }).status, 0);
    assert.equal((await engine.git(['show', 'HEAD~1:' + copy])).out.trim(), 'old safe conflict copy');
  }
});

test('legacy cleanup still scans and uploads selected executable configuration without repeated approval', { timeout: 90000 }, async t => {
  const { home, remote, engine } = gitFixture(t);
  fs.writeFileSync(path.join(home, 'base.txt'), 'safe baseline\n');
  assert.equal((await engine.syncOnce('cleanup-test', { forceCommit: true })).error, undefined);
  const before = execFileSync('git', ['--git-dir', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(home, 'note.txt.dsh-conflict-fixture'), 'old safe copy\n');
  assert.equal(engine.ok(await engine.git(['add', '--', 'note.txt.dsh-conflict-fixture'])), true);
  assert.equal(engine.ok(await engine.git(['commit', '-m', 'old conflict fixture'])), true);
  const stateFile = path.join(home, '.dsh-sync.state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); state.legacyConflictCleanup = false;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  fs.mkdirSync(path.join(home, 'patches'), { recursive: true });
  fs.writeFileSync(path.join(home, 'patches/cleanup-fixture.mjs'), 'export default {};\n');
  engine.syncOnce = SyncEngine.prototype.syncOnce.bind(engine);
  const value = await engine.syncOnce('cleanup-test', { forceCommit: true });
  assert.equal(value.needsReview, undefined, JSON.stringify(value));
  assert.equal(value.error, undefined, JSON.stringify(value));
  assert.notEqual(execFileSync('git', ['--git-dir', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim(), before);
  assert.equal(execFileSync('git', ['--git-dir', remote, 'show', 'main:patches/cleanup-fixture.mjs'], { encoding: 'utf8' }), 'export default {};\n');
});

test('exit uploads and retries pin the checked commit when an external writer advances main or workspace', { timeout: 90000 }, async t => {
  for (const target of ['main', 'workspace']) {
    const { root, home, remote, engine } = gitFixture(t);
    fs.writeFileSync(path.join(home, 'safe.txt'), 'checked content\n');
    const project = path.join(root, 'project'), workspaceId = 'exit-race-fixture';
    if (target === 'workspace') {
      fs.mkdirSync(project); fs.mkdirSync(path.join(home, 'storages'));
      fs.writeFileSync(path.join(project, 'safe.txt'), 'checked workspace\n');
      fs.writeFileSync(path.join(home, 'storages/workspace.json'), JSON.stringify({ tables: { workspaces:
        { [workspaceId]: { path: project, title: 'exit fixture' } } } }));
      engine.overrides.workspaceSync = true;
    }
    assert.equal((await engine.syncOnce('exit-race-test', { forceCommit: true })).error, undefined);
    // The implicit first round does not perform an extra approval retry. Settle
    // first-run metadata before testing a race against an already checked head.
    assert.equal((await engine.syncOnce('exit-race-test', { forceCommit: true })).error, undefined);
    const gitdir = target === 'workspace' ? engine.workspaceGitDir(workspaceId) : null;
    const branch = target === 'workspace' ? engine.workspaceBranchOf(engine.loadConfig(), workspaceId) : 'main';
    const checked = engine._safeUploadHeads.get(gitdir || 'main'); assert.ok(checked);
    const original = engine.gitSync.bind(engine), originalWorkspace = engine.gitWSync.bind(engine), attempts = [];
    const race = (args, run, worktree) => {
      if (args[0] !== 'push') return run(args);
      attempts.push([...args]);
      if (attempts.length === 1) {
        fs.writeFileSync(path.join(worktree, 'pending-secret.txt'), 'ghp_' + 'R'.repeat(40));
        assert.equal(engine.ok(run(['add', '--', 'pending-secret.txt'])), true);
        assert.equal(engine.ok(run(['commit', '-m', 'external unpublished fixture'])), true);
        return { code: 1, out: '', err: 'fixture first exit push failure' };
      }
      return run(args);
    };
    if (gitdir) engine.gitWSync = (dir, worktree, args, ...options) => dir === gitdir
      ? race(args, argv => originalWorkspace(dir, worktree, argv, ...options), worktree)
      : originalWorkspace(dir, worktree, args, ...options);
    else engine.gitSync = (args, ...options) => race(args, argv => original(argv, ...options), home);
    engine.flushSync();
    assert.equal(attempts.length, 2);
    assert.ok(attempts.every(args => args[2] === checked.head + ':refs/heads/' + branch));
    assert.equal(execFileSync('git', ['--git-dir', remote, 'rev-parse', branch], { encoding: 'utf8' }).trim(), checked.head);
    assert.notEqual(spawnSync('git', ['--git-dir', remote, 'show', branch + ':pending-secret.txt'], { stdio: 'ignore' }).status, 0);
  }
});

test('more than 32 MiB of unique history is scanned in bounded batches and delivered through real Git', { timeout: 90000 }, async t => {
  const { home, engine, remote } = gitFixture(t);
  for (let i = 0; i < 6; i++) {
    const bytes = Buffer.alloc(7 * 1024 * 1024, 65 + i);
    fs.writeFileSync(path.join(home, 'large-' + i + '.txt'), bytes);
  }
  const reads = [], original = engine.gitInput.bind(engine);
  engine.gitInput = async (args, input, timeout, binary, limits) => {
    const result = await original(args, input, timeout, binary, limits);
    if (args.includes('--batch')) reads.push({ bytes: result.out.length, cap: limits.maxOutputBytes });
    return result;
  };
  const result = await engine.syncOnce('batch-test', { forceCommit: true });
  assert.equal(result.error, undefined, JSON.stringify(result)); assert.equal(result.pushed, true);
  assert.ok(reads.length >= 6);
  assert.ok(reads.every(read => read.bytes <= read.cap && read.cap <= 8 * 1024 * 1024 + 256 * 128));
  const files = execFileSync('git', ['--git-dir', remote, 'ls-tree', '--name-only', 'main'], { encoding: 'utf8' });
  assert.ok(files.includes('large-5.txt'));
  const remoteFile = execFileSync('git', ['--git-dir', remote, 'show', 'main:large-5.txt'], { maxBuffer: 9 * 1024 * 1024 });
  assert.deepEqual(remoteFile, fs.readFileSync(path.join(home, 'large-5.txt')));
});

test('a secret removed after a later large batch still blocks the whole unpublished history', { timeout: 90000 }, async t => {
  const { home, engine, remote } = gitFixture(t);
  assert.equal(await engine.ensureRepo(engine.loadConfig()), true);
  for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(home, 'large-' + i + '.txt'), Buffer.alloc(7 * 1024 * 1024, 65 + i));
  fs.writeFileSync(path.join(home, 'history-secret.txt'), 'ghp_' + 'Z'.repeat(40));
  assert.equal(engine.ok(await engine.git(['add', '.'])), true);
  assert.equal(engine.ok(await engine.git(['commit', '-m', 'unpublished fixture'])), true);
  fs.unlinkSync(path.join(home, 'history-secret.txt'));
  assert.equal(engine.ok(await engine.git(['add', '.'])), true);
  assert.equal(engine.ok(await engine.git(['commit', '-m', 'remove from working tree'])), true);
  const report = await scanOutgoing(engine, 'main');
  assert.ok(report.bytes > 32 * 1024 * 1024); assert.ok(report.batches >= 6);
  assert.ok(report.findings.some(f => f.file === 'history-secret.txt' && f.reasons.includes('GitHub 令牌格式')));
  assert.ok(!JSON.stringify(report).includes('ZZZZ'));
  const result = await engine.syncOnce('batch-secret', { forceCommit: true });
  assert.match(result.error, /上传已暂停/);
  assert.notEqual(spawnSync('git', ['--git-dir', remote, 'rev-parse', '--verify', 'main'], { stdio: 'ignore' }).status, 0);
});

test('more than 5000 objects are inspected and malformed or oversized batch output fails closed', { timeout: process.platform === 'win32' ? 180000 : 90000 }, async t => {
  // Windows runner filesystem setup exceeded 90s once. Keep all 5100 objects
  // and all negative assertions; product Git command timeouts remain unchanged.
  const started = Date.now(), phase = name => t.diagnostic(name + ': ' + (Date.now() - started) + 'ms');
  const { home, engine } = gitFixture(t);
  assert.equal(await engine.ensureRepo(engine.loadConfig()), true);
  const folder = path.join(home, 'many'); fs.mkdirSync(folder);
  for (let i = 0; i < 5100; i++) fs.writeFileSync(path.join(folder, i + '.txt'), 'unique-' + i);
  assert.equal(engine.ok(await engine.git(['add', '.'])), true);
  phase('created 5100 fixture files');
  assert.equal(engine.ok(await engine.git(['commit', '-m', 'many fixture objects'])), true);
  phase('committed fixture');
  engine.progress = { running: true, label: '准备上传测试内容…' };
  const report = await scanOutgoing(engine, 'main');
  assert.ok(report.checked > 5000); assert.deepEqual(report.findings, []);
  phase('full independent object scan');
  assert.equal(engine.progress.label, '准备上传测试内容…');
  const original = engine.gitInput.bind(engine);
  engine.gitInput = async (...args) => {
    const result = await original(...args);
    if (args[0].includes('--batch')) result.out = Buffer.concat([result.out, Buffer.from('unchecked trailer')]);
    return result;
  };
  await assert.rejects(scanOutgoing(engine, 'main'), /额外数据/);
  engine.gitInput = async (...args) => {
    const result = await original(...args);
    if (args[0].includes('--batch-check')) result.out = result.out.replace(/ blob \d+/, ' blob 9999999999999999999999');
    return result;
  };
  await assert.rejects(scanOutgoing(engine, 'main'), /大小不正确/);
  engine.gitInput = async (...args) => args[0].includes('rev-list') ? { code: 0, out: '', err: '', outputLimit: true } : original(...args);
  await assert.rejects(scanOutgoing(engine, 'main'), /枚举/);
  phase('all malformed-output assertions completed');
});

test('a branch changed during upload never sends the new unscanned secret or claims a completed handoff', { timeout: 90000 }, async t => {
  const { home, engine, remote } = gitFixture(t);
  fs.writeFileSync(path.join(home, 'public.txt'), 'public');
  const original = engine.git.bind(engine); let changed = false, uploaded;
  engine.git = async (...args) => {
    if (args[0].includes('push') && args[0].some(arg => /^[a-f0-9]{40,64}:refs\/heads\/main$/.test(arg))) {
      uploaded = args[0].find(arg => arg.endsWith(':refs/heads/main')).split(':')[0];
      if (!changed) {
        changed = true;
        fs.writeFileSync(path.join(home, 'secret.txt'), 'ghp_' + 'Y'.repeat(40));
        assert.equal(engine.ok(await original(['add', '.'])), true);
        assert.equal(engine.ok(await original(['commit', '-m', 'concurrent unscanned fixture'])), true);
      }
    }
    return original(...args);
  };
  const result = await engine.syncOnce('concurrent-commit', { forceCommit: true });
  assert.match(result.error, /仅上传已检查版本/); assert.equal(result.pushed, false);
  assert.equal(execFileSync('git', ['--git-dir', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim(), uploaded);
  assert.notEqual(spawnSync('git', ['--git-dir', remote, 'show', 'main:secret.txt'], { stdio: 'ignore' }).status, 0);
  assert.equal(engine.handoffStatus(), null);
});

test('scanner reports categories only and distinguishes templates, private keys and compressed session content', () => {
  const fake = 'ghp_' + 'A'.repeat(40);
  const findings = inspectContent('note.txt', Buffer.from(fake));
  assert.deepEqual(findings, ['GitHub 令牌格式']);
  assert.doesNotMatch(JSON.stringify(findings), /AAAA|ghp_/);
  assert.deepEqual(inspectContent('.env.example', Buffer.from('PUBLIC=example')), []);
  assert.deepEqual(inspectContent('project/.env', Buffer.from('PUBLIC=example')), ['敏感文件名']);
  assert.deepEqual(inspectContent('key.txt', Buffer.from('-----BEGIN PRIVATE KEY-----')), ['私钥内容']);
  assert.ok(inspectContent('sessions/session.jsonl.zstd', zstdCompressSync(Buffer.from(fake))).includes('GitHub 令牌格式'));
  // Filename rules intentionally flag even public environment files: documented false positive.
  assert.equal(inspectContent('.env.public', Buffer.from('ONLY_PUBLIC=true')).length, 1);
});

test('new sensitive history blocks the first upload even after the current file is removed', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-privacy-'));
  t.after(() => removeFixture(root));
  const home = path.join(root, 'home'), remote = path.join(root, 'remote.git');
  fs.mkdirSync(home);
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  const engine = new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false });
  engine.verifyPrivateRemote = async () => ({ ok: true });
  fs.writeFileSync(path.join(home, 'credentials.json'), 'PUBLIC=value');
  fs.writeFileSync(path.join(home, 'note.txt'), 'PUBLIC=value');
  const first = await engine.syncOnce('test', { forceCommit: true });
  assert.match(first.error, /上传已暂停/);
  assert.equal(first.privacy.findings.some(f => f.file === 'credentials.json'), true);
  assert.notEqual(spawnSync('git', ['--git-dir', remote, 'rev-parse', '--verify', 'main'], { stdio: 'ignore' }).status, 0);
  fs.unlinkSync(path.join(home, 'credentials.json'));
  const second = await engine.syncOnce('test', { forceCommit: true });
  assert.match(second.error, /上传已暂停/);
  assert.equal(second.privacy.findings.some(f => f.file === 'credentials.json'), true);
  assert.notEqual(spawnSync('git', ['--git-dir', remote, 'rev-parse', '--verify', 'main'], { stdio: 'ignore' }).status, 0);
  let uploads = 0;
  const original = engine.gitSync.bind(engine);
  engine.gitSync = args => { if (args.includes('push')) uploads++; return original(args); };
  engine.flushSync();
  assert.equal(uploads, 0);
});

test('oversized and undecodable blobs pause upload instead of silently skipping inspection', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-privacy-size-'));
  t.after(() => removeFixture(root));
  const home = path.join(root, 'home'), remote = path.join(root, 'remote.git'); fs.mkdirSync(home);
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  const engine = new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false });
  engine.verifyPrivateRemote = async () => ({ ok: true });
  fs.writeFileSync(path.join(home, 'large-note.txt'), Buffer.alloc(9 * 1024 * 1024, 65));
  const result = await engine.syncOnce('test', { forceCommit: true });
  assert.match(result.error, /上传已暂停/);
  assert.ok(result.privacy.findings.some(finding => finding.file === 'large-note.txt'));
  assert.notEqual(spawnSync('git', ['--git-dir', remote, 'rev-parse', '--verify', 'main'], { stdio: 'ignore' }).status, 0);
  assert.ok(inspectContent('session.jsonl.zstd', zstdCompressSync(Buffer.alloc(9 * 1024 * 1024, 65))).length > 0);
  assert.ok(inspectContent('session.jsonl.zstd', Buffer.from([0x28, 0xB5, 0x2F, 0xFD, 0])).length > 0);
});
