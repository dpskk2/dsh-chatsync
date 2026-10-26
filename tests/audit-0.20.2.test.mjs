import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog';
import { SyncEngine, resolveSyncConfig } from '../lib/sync.js';
import { settingsProjection, restoreLocalSettings, scopeMirrorPath } from '../lib/scope.js';
import { parseYaml } from '../lib/yaml.js';
import { applyOfflineSession } from '../lib/session-safety.js';
import { applyProjectFile, recoverProjectApplications } from '../lib/project-sync.js';
import { digest } from '../lib/recovery.js';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-audit-release-'));
  t.after(() => removeFixture(root));
  const git = args =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const remote = path.join(root, 'remote.git');
  git(['init', '--bare', '-b', 'main', remote]);
  const make = (name, overrides = {}) => {
    const home = path.join(root, name),
      project = path.join(root, name + '-project');
    fs.mkdirSync(home);
    fs.mkdirSync(project);
    const engine = new SyncEngine(home, { remote, autoRepo: false, workspaceSync: true, ...overrides });
    engine.verifyPrivateRemote = async () => ({ ok: true });
    const ws = { id: 'audit-workspace', title: 'Audit', path: project };
    engine.workspaces = () => [ws];
    return { engine, home, project, ws, sync: () => engine.syncOnce('audit', { forceCommit: true }) };
  };
  const write = (d, text, file = 'note.txt') => fs.writeFileSync(path.join(d.project, file), text + '\n');
  return { root, remote, git, make, write };
}

test('R1: merge never overwrites an editor save after the exported project snapshot', async t => {
  const h = fixture(t),
    a = h.make('a'),
    b = h.make('b');
  h.write(a, 'BASE');
  await a.sync();
  await b.sync();
  h.write(a, 'REMOTE-A');
  await a.sync();
  h.write(b, 'LOCAL-B');
  const original = b.engine.gitW.bind(b.engine);
  let edited = false;
  b.engine.gitW = async (dir, tree, args, ...rest) => {
    if (!edited && args[0] === 'checkout' && args.includes('--ours')) {
      h.write(b, 'EDITOR-NEW');
      edited = true;
      assert.notEqual(tree, b.project);
    }
    return original(dir, tree, args, ...rest);
  };
  const result = await b.sync();
  assert.equal(edited, true);
  assert.ok(result.workspaces.errors.length);
  assert.equal(fs.readFileSync(path.join(b.project, 'note.txt'), 'utf8'), 'EDITOR-NEW\n');
  b.engine.gitW = original;
  assert.deepEqual((await b.sync()).workspaces.errors, []);
  await a.sync();
  assert.equal(fs.readFileSync(path.join(a.project, 'note.txt'), 'utf8'), 'EDITOR-NEW\n');
});

test('R2: cancellation aborts an isolated project conflict and retry never publishes markers', async t => {
  const h = fixture(t),
    a = h.make('a'),
    b = h.make('b');
  h.write(a, 'BASE');
  await a.sync();
  await b.sync();
  h.write(a, 'A');
  await a.sync();
  h.write(b, 'B');
  const original = b.engine.gitW.bind(b.engine);
  let cancelling,
    injected = false;
  b.engine.gitW = async (dir, tree, args, ...rest) => {
    const r = await original(dir, tree, args, ...rest);
    if (!injected && args[0] === 'merge' && args.includes('--no-edit') && fs.existsSync(path.join(dir, 'MERGE_HEAD'))) {
      injected = true;
      cancelling = b.engine.cancelSync();
    }
    return r;
  };
  const stopped = await b.sync();
  await cancelling;
  assert.equal(stopped.cancelled, true);
  assert.equal(injected, true);
  assert.equal(fs.existsSync(path.join(b.engine.workspaceGitDir(b.ws.id), 'MERGE_HEAD')), false);
  assert.equal(fs.readFileSync(path.join(b.project, 'note.txt'), 'utf8'), 'B\n');
  b.engine.gitW = original;
  assert.deepEqual((await b.sync()).workspaces.errors, []);
  assert.doesNotMatch(
    h.git(['--git-dir=' + h.remote, 'show', 'ws/audit-workspace:note.txt']),
    /<<<<<<<|=======|>>>>>>>/,
  );
});

test('R3: independent official codec rejects continuous but impossible events before upload and offline application', async t => {
  const h = fixture(t),
    a = h.make('a', { workspaceSync: false }),
    b = h.make('b', { workspaceSync: false });
  const id = 'session-55555555-5555-5555-5555-555555555555',
    rel = `sessions/audit/${id}/session.v4.jsonl`;
  const header = {
    type: 'session',
    version: 4,
    id,
    createdAt: 1700000000000,
    cwd: h.root,
    isSeeded: false,
    delegationDepth: 0,
  };
  const good = {
    seq: 0,
    time: 1700000000001,
    type: 'session/title',
    data: { title: 'good', messageSeqs: [], source: { kind: 'user' } },
  };
  const bad = { seq: 0, time: 1700000000001, type: 'step/end', data: { turn: 1, step: 1 } };
  const encode = row => Buffer.from([header, row].map(JSON.stringify).join('\n') + '\n');
  const restore = sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' });
  restore.decodeRow(good);
  assert.equal(restore.finish().events.length, 1);
  const other = sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' });
  other.decodeRow(bad);
  assert.throws(() => other.finish(), /step\/end/);
  fs.mkdirSync(path.dirname(path.join(a.home, rel)), { recursive: true });
  fs.writeFileSync(path.join(a.home, rel), encode(bad));
  assert.match((await a.sync()).error, /step\/end/);
  assert.equal(h.git(['--git-dir=' + h.remote, 'for-each-ref']), '');
  const offline = await applyOfflineSession(b.engine, rel, encode(bad), null);
  assert.equal(offline.deferred, true);
  assert.equal(fs.existsSync(path.join(b.home, rel)), false);
  assert.equal((await applyOfflineSession(b.engine, rel, encode(good), null)).applied, true);
  const { validateTransferSession } = await import('../lib/session-transfer.js');
  const historical = Buffer.from([{ ...header, version: 3 }, good].map(JSON.stringify).join('\n') + '\n');
  await validateTransferSession(a.engine, rel.replace('.v4.', '.v3.'), historical);
});

test('R4 and C3: YAML semantics survive comments, quoting and URL lists; removed providers never receive another key', () => {
  assert.equal(settingsProjection(Buffer.from('theme: dark # comment\n')).value.toString(), 'theme: dark\n');
  const text = String.raw`label: "say \"hello\""` + '\nexamples:\n  - https://example.com\n';
  const out = parseYaml(settingsProjection(Buffer.from(text)).value.toString());
  assert.equal(out.ok, true);
  assert.deepEqual(out.value, { examples: ['https://example.com'], label: 'say "hello"' });
  const old = Buffer.from('providers:\n  - id: removed\n    apiKey: local-only\n  - id: retained\n    model: old\n');
  const next = restoreLocalSettings(Buffer.from('providers:\n  - id: retained\n    model: new\n'), old);
  assert.deepEqual(parseYaml(next.toString()).value, { providers: [{ id: 'retained', model: 'new' }] });
  assert.throws(() => settingsProjection(Buffer.from('theme: dark\ntheme: light\n')), /不支持/);
});

test('R5/R6: corrupt registry and directory overrides stop; valid BOM override still selects its directory', async t => {
  const h = fixture(t),
    a = h.make('a');
  delete a.engine.workspaces;
  fs.mkdirSync(path.join(a.home, 'storages'));
  fs.writeFileSync(path.join(a.home, 'storages/workspace.json'), '{broken');
  assert.match((await a.sync()).error, /JSON|登记/);
  assert.equal(h.git(['--git-dir=' + h.remote, 'for-each-ref']), '');
  const file = path.join(a.home, 'storages/workspace-local-paths.json');
  fs.writeFileSync(file, '{broken');
  assert.throws(() => a.engine.workspaceRealPathOf(a.ws, a.engine.loadConfig()), /保存位置/);
  fs.writeFileSync(file, '\uFEFF' + JSON.stringify({ overrides: { [a.ws.id]: a.project } }));
  assert.equal(a.engine.workspaceRealPathOf(a.ws, a.engine.loadConfig()), a.project);
});

test('R7: exit uploads cannot issue an application receipt for remote content not applied locally', async t => {
  const h = fixture(t),
    a = h.make('a', { workspaceSync: false }),
    b = h.make('b', { workspaceSync: false });
  fs.mkdirSync(path.join(a.home, 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(a.home, 'attachments/note.txt'), 'v1');
  await a.sync();
  await b.sync();
  fs.writeFileSync(path.join(a.home, 'attachments/note.txt'), 'v2');
  await a.sync();
  const before = b.engine.handoffStatus().scope.main;
  const result = await b.engine.syncOnce('exit', { forceCommit: true, uploadOnly: true });
  assert.equal(result.downloadPending, true);
  assert.equal(fs.readFileSync(path.join(b.home, 'attachments/note.txt'), 'utf8'), 'v1');
  assert.equal(b.engine.handoffStatus().scope.main, before);
});

test('R8: Chinese project conflicts retain readable originals and merge with raw filenames', async t => {
  const h = fixture(t),
    a = h.make('a'),
    b = h.make('b'),
    file = '中文 文档.txt';
  h.write(a, 'BASE', file);
  await a.sync();
  await b.sync();
  h.write(a, 'A', file);
  await a.sync();
  h.write(b, 'B', file);
  const result = await b.sync();
  assert.deepEqual(result.workspaces.errors, []);
  const record = b.engine.recovery.list().find(r => r.kind === 'ws' && r.path === file);
  assert.ok(record);
  assert.equal(b.engine.recovery.version(record, 'local').toString(), 'B\n');
  assert.equal(b.engine.recovery.version(record, 'remote').toString(), 'A\n');
});

test('R9/R10: child environments share the proxy and split UTF-8 remains intact', async t => {
  const h = fixture(t),
    a = h.make('a');
  const old = process.env.HTTPS_PROXY;
  process.env.HTTPS_PROXY = 'http://127.0.0.1:65431';
  try {
    a.engine.applyProxyEnv({ proxy: '' });
    assert.equal(a.engine._gitEnv.HTTPS_PROXY, process.env.HTTPS_PROXY);
    a.engine.overrides.proxy = 'http://127.0.0.1:65432';
    let options;
    a.engine._spawn = async (_cmd, _args, _time, opts) => {
      options = opts;
      return { code: 0, out: '', err: '' };
    };
    await a.engine.gh(['--version']);
    assert.equal(options.useGitEnv, true);
    assert.equal(a.engine._gitEnv.HTTPS_PROXY, 'http://127.0.0.1:65432');
  } finally {
    if (old === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = old;
  }
  const r = await bSpawn(h.make('b').engine);
  assert.equal(r.out, '中');
  assert.equal(r.err, '文');
});
const bSpawn = e =>
  e._spawn(
    process.execPath,
    [
      '-e',
      'process.stdout.write(Buffer.from([0xe4]));process.stderr.write(Buffer.from([0xe6]));setTimeout(()=>{process.stdout.write(Buffer.from([0xb8,0xad]));process.stderr.write(Buffer.from([0x96,0x87]));},50)',
    ],
    5000,
  );

test('C1/C2: saved automatic choices survive host defaults; project and main use the same credential helper', async t => {
  assert.equal(
    resolveSyncConfig({ enabled: false, mode: 'manual', lifecycleAutomation: 1 }, { enabled: true, mode: 'auto' })
      .enabled,
    false,
  );
  const h = fixture(t),
    a = h.make('a', { remote: 'https://github.com/synthetic/private.git' });
  a.engine.ghAvailable = async () => true;
  await a.engine.ensureRepo(a.engine.loadConfig());
  await a.engine.ensureWorkspaceMirror(a.ws.id, a.project, a.engine.loadConfig());
  const main = await a.engine.git(['config', '--local', '--get', 'credential.helper']);
  const project = await a.engine.gitW(a.engine.workspaceGitDir(a.ws.id), a.project, [
    'config',
    '--local',
    '--get',
    'credential.helper',
  ]);
  assert.equal(project.out, main.out);
  assert.equal(main.out.trim(), '!gh auth git-credential');
});

test('project import preserves a new path created between retaining the inode and installing incoming data', t => {
  const h = fixture(t),
    a = h.make('a');
  h.write(a, 'BEFORE');
  const target = path.join(a.project, 'note.txt'),
    before = fs.readFileSync(target);
  const original = fs.linkSync;
  let edited = false;
  fs.linkSync = function (from, to, ...rest) {
    if (!edited && to === target && String(from).endsWith('incoming-file')) {
      edited = true;
      fs.writeFileSync(target, 'LATEST-EDITOR');
    }
    return original.call(this, from, to, ...rest);
  };
  try {
    assert.equal(applyProjectFile(a.engine, a.ws, a.project, 'note.txt', digest(before), Buffer.from('REMOTE')), false);
  } finally {
    fs.linkSync = original;
  }
  assert.equal(fs.readFileSync(target, 'utf8'), 'LATEST-EDITOR');
  const record = a.engine.recovery.list()[0];
  assert.equal(fs.readFileSync(record.retainedOriginal, 'utf8'), 'BEFORE\n');
});

test('interrupted project application restores a missing retained inode before any upload', t => {
  const h = fixture(t),
    a = h.make('a');
  h.write(a, 'ORIGINAL');
  const bytes = fs.readFileSync(path.join(a.project, 'note.txt'));
  const record = a.engine.recovery.save(
    { kind: 'restore-backup', status: 'prepared', workspaceId: a.ws.id, path: 'note.txt', reason: 'project-import' },
    { local: bytes, remote: Buffer.from('REMOTE') },
  );
  const dir = path.join(a.project + '.chatsync-backups', record.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.renameSync(path.join(a.project, 'note.txt'), path.join(dir, 'latest-original'));
  assert.throws(() => recoverProjectApplications(a.engine, a.ws, a.project), /应用中断/);
  assert.equal(fs.readFileSync(path.join(a.project, 'note.txt'), 'utf8'), 'ORIGINAL\n');
  assert.equal(a.engine.recovery.read(record.id).status, 'restored');
});

test('R3: a forged semantic-invalid remote fast-forward is refused before application or publication', async t => {
  const h = fixture(t),
    a = h.make('a', { workspaceSync: false }),
    b = h.make('b', { workspaceSync: false });
  fs.writeFileSync(path.join(a.home, 'note.txt'), 'baseline');
  await a.sync();
  await b.sync();
  const original = h.git(['--git-dir=' + h.remote, 'rev-parse', 'main']),
    forge = path.join(h.root, 'forge');
  h.git(['clone', '--branch', 'main', h.remote, forge]);
  const id = 'session-66666666-6666-6666-6666-666666666666',
    rel = `sessions/audit/${id}/session.v4.jsonl`;
  fs.mkdirSync(path.dirname(path.join(forge, rel)), { recursive: true });
  fs.writeFileSync(
    path.join(forge, rel),
    [
      { type: 'session', version: 4, id, createdAt: 1700000000000, cwd: h.root, isSeeded: false, delegationDepth: 0 },
      { seq: 0, time: 1700000000001, type: 'step/end', data: { turn: 1, step: 1 } },
    ]
      .map(JSON.stringify)
      .join('\n') + '\n',
  );
  const git = args =>
    execFileSync('git', args, { cwd: forge, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid', 'add', '.']);
  git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid', 'commit', '-m', 'forged remote']);
  git(['push', 'origin', 'main']);
  const forged = h.git(['--git-dir=' + h.remote, 'rev-parse', 'main']);
  assert.notEqual(forged, original);
  const result = await b.sync();
  assert.ok(result.error, JSON.stringify(result));
  assert.equal(fs.existsSync(path.join(b.home, rel)), false);
  assert.equal(h.git(['--git-dir=' + h.remote, 'rev-parse', 'main']), forged);
});

test('R4: real two-copy settings roundtrip preserves values and machine-local provider keys', async t => {
  const h = fixture(t),
    a = h.make('a', { workspaceSync: false }),
    b = h.make('b', { workspaceSync: false });
  const file = d => path.join(d.home, 'settings.yaml');
  fs.writeFileSync(
    file(a),
    'theme: dark # comment\nexamples:\n  - https://example.com\nproviders:\n  - id: kept\n    apiKey: a-local\n    model: first\n',
  );
  await a.sync();
  await b.sync();
  let value = parseYaml(fs.readFileSync(file(b), 'utf8')).value;
  assert.equal(value.theme, 'dark');
  assert.deepEqual(value.examples, ['https://example.com']);
  assert.equal(value.providers[0].apiKey, undefined);
  value.providers[0].apiKey = 'b-local';
  value.theme = 'light';
  value.providers[0].model = 'second';
  const { emitYaml } = await import('../lib/yaml.js');
  fs.writeFileSync(file(b), emitYaml(value));
  await b.sync();
  await a.sync();
  value = parseYaml(fs.readFileSync(file(a), 'utf8')).value;
  assert.equal(value.theme, 'light');
  assert.equal(value.providers[0].model, 'second');
  assert.equal(value.providers[0].apiKey, 'a-local');
  const shared = h.git(['--git-dir=' + h.remote, 'show', 'main:settings.yaml']);
  assert.doesNotMatch(shared, /a-local|b-local|apiKey/);
});

test('project recovery vaults stay local and filesystem-root workspaces cannot bypass overlap protection', async t => {
  const h = fixture(t),
    a = h.make('a');
  const { transportable } = await import('../lib/scope.js');
  assert.equal(transportable('parent.chatsync-backups/id/latest-original'), false);
  a.engine.workspaceRealPathOf = () => path.parse(a.home).root;
  assert.match((await a.engine.syncWorkspace(a.ws, a.engine.loadConfig(), 'test', {})).error, /重叠/);
  const file = path.join(a.project, 'note.txt');
  fs.writeFileSync(file, 'original');
  fs.mkdirSync(a.project + '.chatsync-backups');
  fs.writeFileSync(path.join(a.project + '.chatsync-backups', 'unrelated'), 'keep');
  assert.throws(() =>
    applyProjectFile(a.engine, a.ws, a.project, 'note.txt', digest(Buffer.from('original')), Buffer.from('incoming')),
  );
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  assert.equal(fs.readFileSync(path.join(a.project + '.chatsync-backups', 'unrelated'), 'utf8'), 'keep');
});

test('unsupported exclusive file installation stops before moving any project original', t => {
  const h = fixture(t),
    a = h.make('a');
  h.write(a, 'ORIGINAL');
  const target = path.join(a.project, 'note.txt'),
    before = fs.readFileSync(target);
  const original = fs.linkSync;
  let renamed = false;
  const rename = fs.renameSync;
  fs.linkSync = () => {
    const e = new Error('filesystem has no hard links');
    e.code = 'ENOTSUP';
    throw e;
  };
  fs.renameSync = (...args) => {
    if (args[0] === target) renamed = true;
    return rename(...args);
  };
  try {
    assert.throws(
      () => applyProjectFile(a.engine, a.ws, a.project, 'note.txt', digest(before), Buffer.from('REMOTE')),
      /no hard links/,
    );
  } finally {
    fs.linkSync = original;
    fs.renameSync = rename;
  }
  assert.equal(renamed, false);
  assert.deepEqual(fs.readFileSync(target), before);
});

test(
  'isolated exit workers inherit the public host catalog, validate sessions and upload a real snapshot',
  { timeout: 30000 },
  async t => {
    const h = fixture(t),
      host = path.join(h.root, 'host'),
      consumer = path.join(h.root, 'isolated-plugin'),
      home = path.join(h.root, 'exit-home');
    fs.mkdirSync(home);
    fs.mkdirSync(host);
    fs.mkdirSync(consumer);
    const entry = path.join(host, 'host.mjs');
    fs.writeFileSync(entry, '');
    const catalog = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-session-format-catalog');
    const pkg = path.join(host, 'node_modules/@deepseek-ai/dsh-session-format-catalog');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ type: 'module', main: 'index.js' }));
    fs.writeFileSync(path.join(pkg, 'index.js'), 'export * from ' + JSON.stringify(pathToFileURL(catalog).href) + ';');
    fs.cpSync(fileURLToPath(new URL('../lib', import.meta.url)), path.join(consumer, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(consumer, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(path.join(home, 'dsh-sync.json'), JSON.stringify({ autoRepo: false, workspaceSync: false }));
    const id = 'session-77777777-7777-7777-7777-777777777777',
      rel = `sessions/test/${id}/session.v4.jsonl`;
    const bytes = Buffer.from(
      [
        { type: 'session', version: 4, id, createdAt: 1700000000000, cwd: h.root, isSeeded: false, delegationDepth: 0 },
        {
          seq: 0,
          time: 1700000000001,
          type: 'session/title',
          data: { title: 'exit worker', messageSeqs: [], source: { kind: 'user' } },
        },
      ]
        .map(JSON.stringify)
        .join('\n') + '\n',
    );
    fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
    fs.writeFileSync(path.join(home, rel), bytes);
    const worker = path.join(consumer, 'lib/exit-sync.mjs');
    const run = async hostEntry => {
      const env = { ...process.env, NODE_PATH: '', DSH_SYNC_HOST_ENTRY: hostEntry };
      const parent = spawn(process.execPath, ['-e', 'setTimeout(()=>{},100)'], {
        env,
        stdio: 'ignore',
        windowsHide: true,
      });
      t.after(() => {
        if (parent.exitCode === null) parent.kill();
      });
      return await new Promise(resolve =>
        execFile(
          process.execPath,
          [worker, home, String(parent.pid)],
          { env, encoding: 'utf8', windowsHide: true, timeout: 20000 },
          (error, stdout, stderr) => resolve({ status: error ? error.code : 0, stdout, stderr }),
        ),
      );
    };
    const denied = await run('');
    assert.equal(denied.status, 1, denied.stderr);
    assert.match(
      JSON.parse(fs.readFileSync(path.join(home, '.dsh-sync-status.json'))).result.error,
      /会话格式接口不可用/,
    );
    assert.deepEqual(fs.readFileSync(path.join(home, rel)), bytes);
    const allowed = await run(entry);
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.dsh-sync-status.json'))).result.error, undefined);
    assert.deepEqual(
      execFileSync('git', ['-C', scopeMirrorPath(home, { remote: '', branch: 'main' }), 'show', 'HEAD:' + rel]),
      bytes,
    );
  },
);
