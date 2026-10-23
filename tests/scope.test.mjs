import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { normalizeScope, settingsProjection, restoreLocalSettings, transportable, scopeMirrorPath } from '../lib/scope.js';
import { parseYaml } from '../lib/yaml.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';

test('first scoped clone reuses local history without borrowing storage or seeding unsent commits', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-reference-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git'), home = path.join(root, 'home');
  const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--bare', '--initial-branch=main', remote]);
  git(['clone', remote, home]);
  git(['config', 'user.name', 'fixture'], home); git(['config', 'user.email', 'fixture@invalid'], home);
  fs.writeFileSync(path.join(home, 'note.txt'), 'shared history');
  git(['add', '.'], home); git(['commit', '-m', 'shared'], home); git(['push', 'origin', 'main'], home);
  const remoteHead = git(['rev-parse', 'HEAD'], home);
  fs.writeFileSync(path.join(home, 'note.txt'), 'unsent local edit');
  git(['add', '.'], home); git(['commit', '-m', 'unsent'], home);
  const localHead = git(['rev-parse', 'HEAD'], home);
  const engine = new SyncEngine(home, { remote: new URL('file:///' + remote.replaceAll('\\', '/')).href, autoRepo: false, workspaceSync: false });
  engine.verifyPrivateRemote = async () => ({ ok: true });
  const original = engine.git.bind(engine); let checked = false;
  engine.git = async (args, ...rest) => {
    const result = await original(args, ...rest);
    if (args[0] === 'clone') {
      assert.equal(engine.ok(result), true, result.err);
      assert.ok(args.includes('--dissociate')); assert.equal(args[args.indexOf('--reference-if-able') + 1], home);
      const folder = scopeMirrorPath(home, engine.loadConfig());
      assert.equal(git(['rev-parse', 'HEAD'], folder), remoteHead);
      assert.notEqual(remoteHead, localHead);
      assert.equal(fs.existsSync(path.join(folder, '.git/objects/info/alternates')), false);
      git(['fsck', '--full'], folder);
      // Verify the copied repository after its former reference disappears.
      const sourceObjects = path.join(home, '.git/objects'), archivedObjects = path.join(home, '.git/fixture-objects');
      fs.renameSync(sourceObjects, archivedObjects);
      try { assert.equal(git(['show', 'HEAD:note.txt'], folder), 'shared history'); git(['fsck', '--full'], folder); }
      finally { fs.renameSync(archivedObjects, sourceObjects); }
      checked = true;
    }
    return result;
  };
  await engine.syncOnce('reference-check', { forceCommit: true });
  assert.equal(checked, true); assert.equal(git(['rev-parse', 'HEAD'], home), localHead);
  assert.equal(fs.readFileSync(path.join(home, 'note.txt'), 'utf8'), 'unsent local edit');
});

test('reusing a transport never stacks progress callbacks across retries', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-progress-retry-'));
  t.after(() => removeFixture(home));
  const engine = new SyncEngine(home, { autoRepo: false, workspaceSync: false });
  fs.writeFileSync(path.join(home, 'note.txt'), 'original');
  for (let i = 0; i < 4; i++) {
    assert.equal((await engine.syncOnce('retry', { forceCommit: true })).error, undefined);
    const before = engine._stages.length;
    engine._transport.step('probe', 'single update');
    assert.equal(engine._stages.length, before + 1);
  }
});

test('an interrupted clone is archived and retried without touching local originals', {timeout:60000}, async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'chatsync-incomplete-clone-'));t.after(()=>removeFixture(root));
  const remote=path.join(root,'remote.git'),home=path.join(root,'home');fs.mkdirSync(home);
  execFileSync('git',['init','--bare',remote],{stdio:'ignore'});
  const engine=acceptFixturePreviews(new SyncEngine(home,{remote,autoRepo:false,workspaceSync:false}));
  engine.verifyPrivateRemote=async()=>({ok:true});
  fs.writeFileSync(path.join(home,'note.txt'),'local original');
  const folder=scopeMirrorPath(home,engine.loadConfig());fs.mkdirSync(path.join(folder,'.git'),{recursive:true});
  fs.writeFileSync(path.join(folder,'.git/HEAD'),'ref: refs/heads/.invalid\n');
  fs.writeFileSync(path.join(folder,'interrupted.txt'),'retain interrupted data');
  const result=await engine.syncOnce('interrupted-clone',{forceCommit:true});assert.equal(result.error,undefined,JSON.stringify(result));
  const archives=fs.readdirSync(path.dirname(folder)).filter(x=>x.startsWith('incomplete-clone-'));assert.equal(archives.length,1);
  assert.equal(fs.readFileSync(path.join(path.dirname(folder),archives[0],'interrupted.txt'),'utf8'),'retain interrupted data');
  assert.equal(fs.readFileSync(path.join(home,'note.txt'),'utf8'),'local original');
  assert.equal(execFileSync('git',['--git-dir',remote,'show','main:note.txt'],{encoding:'utf8'}),'local original');
});

test('workspace network operations run after the short local import transaction', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-mask-boundary-'));
  t.after(() => removeFixture(home));
  const engine = new SyncEngine(home, { autoRepo: false, workspaceSync: false });
  fs.writeFileSync(path.join(home, 'note.txt'), 'isolated transaction fixture');
  let checked = false;
  engine.syncAllWorkspaces = async () => {
    assert.equal(engine._syncControl.maskDepth || 0, 0);
    checked = true;
    return { errors: [] };
  };
  assert.equal((await engine.syncOnce('transaction-boundary', { forceCommit: true })).error, undefined);
  assert.equal(checked, true);
});

test('scope selection validates booleans and settings preserve local secrets even inside provider arrays', () => {
  for (const value of ['all', [], { sessions: 'false' }, { unknown: true }]) assert.throws(() => normalizeScope(value));
  const a = Buffer.from('theme: dark\nproxy: local-a\nproviders:\n  - name: a\n    apiKey: secret-a\n    model: model-a\n');
  const projected = settingsProjection(a);
  assert.doesNotMatch(projected.value.toString(), /local-a|secret-a/);
  const b = Buffer.from('theme: light\nproxy: local-b\nproviders:\n  - name: a\n    apiKey: secret-b\n    model: model-b\n');
  const restored = parseYaml(restoreLocalSettings(projected.value, b).toString()).value;
  assert.equal(restored.theme, 'dark');
  assert.equal(restored.proxy, 'local-b');
  assert.equal(restored.providers[0].apiKey, 'secret-b');
  assert.equal(restored.providers[0].model, 'model-a');
  const swapped = Buffer.from('theme: light\nproviders:\n  - name: other\n    model: other\n  - name: a\n    model: next\n');
  const kept = parseYaml(restoreLocalSettings(swapped, b).toString()).value;
  assert.equal(kept.providers[0].apiKey, undefined);
  assert.equal(kept.providers[1].apiKey, 'secret-b');
  assert.throws(() => settingsProjection(Buffer.from('settings: &anchor x\n')), /不支持/);
});

test('scoped transport keeps excluded remote data and local fields, and reenable takes unchanged remote updates', { timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-scopes-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  const make = name => {
    const home = path.join(root, name); fs.mkdirSync(home);
    const engine = new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false,
      contentScope: { sessions: true, attachments: true, settings: true } });
    engine.verifyPrivateRemote = async () => ({ ok: true });
    return acceptFixturePreviews(attachFixturePersistence(engine));
  };
  const a = make('a'), b = make('b');
  // The transfer mirror makes this path exceed Git for Windows' default 260 limit.
  const log = 'sessions/' + 'long-project-group-'.repeat(6) + '/session-11111111-1111-1111-1111-111111111111/session.jsonl';
  const put = (engine, file, value) => { const target = path.join(engine.home, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value); };
  const readRemote = file => execFileSync('git', ['--git-dir', remote, 'show', 'main:' + file], { encoding: 'utf8' });
  const sync = async engine => { const result = await engine.syncOnce('test', { forceCommit: true }); assert.equal(result.error, undefined, JSON.stringify(result)); return result; };
  const firstLog = '{"type":"session","version":4,"id":"session-11111111-1111-1111-1111-111111111111"}\n{"type":"turn/start","seq":0}\n';
  put(a, log, firstLog); put(a, 'attachments/file.txt', 'attachment-a');
  put(a, 'settings.yaml', 'theme: dark\nproxy: local-a\nprovider:\n  apiKey: secret-a\n');
  put(a, 'dsh-sync.json', JSON.stringify({ autoRepo: false }));
  await sync(a);
  assert.equal(readRemote('attachments/file.txt'), 'attachment-a');
  assert.doesNotMatch(readRemote('settings.yaml'), /secret-a|local-a/);
  put(b, 'settings.yaml', 'theme: dark\nproxy: local-b\nprovider:\n  apiKey: secret-b\n');
  put(b, 'attachments/local-only.txt', 'keep-local');
  put(b, '.gitignore', '*.private\n'); put(b, 'ignored.private', 'keep-ignored');
  b.overrides.contentScope.attachments = false;
  await sync(b);
  assert.equal(fs.readFileSync(path.join(b.home, log), 'utf8'), firstLog);
  assert.equal(fs.existsSync(path.join(b.home, 'attachments/file.txt')), false);
  assert.equal(fs.readFileSync(path.join(b.home, 'attachments/local-only.txt'), 'utf8'), 'keep-local');
  assert.equal(fs.readFileSync(path.join(b.home, 'ignored.private'), 'utf8'), 'keep-ignored');
  assert.match(fs.readFileSync(path.join(b.home, 'settings.yaml'), 'utf8'), /secret-b|local-b/);
  assert.equal(readRemote('attachments/file.txt'), 'attachment-a');
  b.overrides.contentScope.sessions = false;
  await sync(b);
  const secondLog = firstLog + '{"type":"turn/end","seq":1}\n';
  put(a, log, secondLog); await sync(a);
  await sync(b);
  assert.equal(fs.readFileSync(path.join(b.home, log), 'utf8'), firstLog);
  assert.equal(readRemote(log), secondLog);
  b.overrides.contentScope.sessions = true;
  await sync(b);
  assert.equal(fs.readFileSync(path.join(b.home, log), 'utf8'), secondLog);
  assert.equal(readRemote(log), secondLog);
  assert.equal(fs.existsSync(path.join(b.home, 'attachments/file.txt')), false);
});

test('sync preserves intentional ungrouping instead of manufacturing registry repair', { timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-scope-review-'));
  t.after(() => removeFixture(root));
  const home = path.join(root, 'home'), remote = path.join(root, 'remote.git');
  fs.mkdirSync(home); execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  const engine = new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false,
    contentScope: { sessions: true, attachments: false, settings: false } });
  engine.verifyPrivateRemote = async () => ({ ok: true });
  const sessionId = 'session-11111111-1111-1111-1111-111111111111';
  const cwd = path.join(home, 'project'); fs.mkdirSync(cwd);
  const log = path.join(home, 'sessions', 'group', sessionId, 'session.jsonl');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, JSON.stringify({ type: 'session', version: 4, id: sessionId, cwd }) + '\n{"type":"turn/start","seq":0}\n');
  fs.mkdirSync(path.join(home, 'storages'));
  fs.writeFileSync(path.join(home, 'storages', 'workspace.json'), JSON.stringify({ tables: { workspaces: {
    fixture: { path: cwd, title: 'Fixture', sessionIds: [] } } }, global: {} }));
  let result = await engine.syncOnce('manual', { forceCommit: true });
  const directions = [];
  for (let i = 0; i < 6 && result.needsReview; i++) {
    directions.push(result.review.direction);
    result = await engine.syncOnce('manual', { forceCommit: true, approval: result.review.id });
  }
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.deepEqual(directions, [], 'Selected scope is imported without repeated transfer approval');
  const observed = JSON.parse(fs.readFileSync(path.join(home, 'storages', 'workspace.json')));
  assert.deepEqual(observed.tables.workspaces.fixture.sessionIds, []);
});

// Runtime status/host ownership is machine-local even though the historical
// process lock uses a dot and the newer lifecycle files use a hyphen.
test('lifecycle status and host ownership never enter scoped transport or previews', () => {
  for (const file of ['.dsh-sync-status.json', '.dsh-sync-hosts/123.json', '.dsh-sync.process.lock', 'dsh-sync.json'])
    assert.equal(transportable(file), false, file);
  assert.equal(transportable('sessions/project/session-11111111-1111-1111-1111-111111111111/session.v4.jsonl'), true);
});
