import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { zstdCompressSync } from 'node:zlib';
import { SyncEngine } from '../lib/sync.js';
import { inspectContent, scanOutgoing } from '../lib/privacy.js';
import { chooseSessionHistory } from '../lib/branch-history.js';
import { applySessionTransfer, retrySessionTransfers } from '../lib/session-transfer.js';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
const id = 'session-11111111-1111-1111-1111-111111111111',
  file = 'sessions/test/' + id + '/session.v4.jsonl';
const encode = n =>
  Buffer.from(
    [
      { type: 'session', version: 4, id },
      ...Array.from({ length: n }, (_, seq) => ({ type: 'turn/start', seq, time: seq, data: { turn: seq + 1 } })),
    ]
      .map(JSON.stringify)
      .join('\n') + '\n',
  );
function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-compat-repair-'));
  t.after(() => removeFixture(home));
  return home;
}
const put = (home, name, bytes) => {
  const target = path.join(home, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
};

test('BOM settings preserve every choice; damaged settings never bootstrap or overwrite', async t => {
  const home = setup(t),
    file = path.join(home, 'dsh-sync.json');
  const config = {
    remote: 'https://github.com/fixture/custom',
    autoRepo: false,
    contentScope: { sessions: true, attachments: false, settings: false },
  };
  fs.writeFileSync(file, '\uFEFF' + JSON.stringify(config));
  const engine = new SyncEngine(home);
  assert.equal(engine.loadConfig().remote, config.remote);
  engine.writeConfig({ enabled: false });
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { ...config, enabled: false });
  for (const value of ['{broken', 'null', '[]']) {
    fs.writeFileSync(file, value);
    let contacted = false;
    engine.ghLogin = async () => {
      contacted = true;
      return 'fixture';
    };
    assert.ok((await engine.syncOnce('test')).error);
    assert.equal(contacted, false);
    assert.throws(() => engine.writeConfig({ remote: 'https://github.com/fixture/other' }), /配置/);
    assert.equal(fs.readFileSync(file, 'utf8'), value);
  }
});

test('identical, nested and junction-aliased workspace targets stop before any project Git operation', async t => {
  const home = setup(t),
    engine = new SyncEngine(home, { autoRepo: false, workspaceBase: path.join(home, 'mapped') });
  engine.workspaces = () => [
    { id: 'a', path: 'C:/one/project' },
    { id: 'b', path: 'D:/two/project' },
  ];
  engine.syncWorkspace = async () => assert.fail('must not touch any project');
  assert.equal((await engine.syncAllWorkspaces(engine.loadConfig(), 'test', {})).errors.length, 2);
  const root = path.join(home, 'target');
  fs.mkdirSync(root);
  const alias = path.join(home, 'alias');
  fs.symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  engine.workspaceRealPathOf = ws =>
    ws.id === 'a' ? path.join(root, 'missing') : path.join(alias, 'missing', 'nested');
  assert.equal((await engine.syncAllWorkspaces(engine.loadConfig(), 'test', {})).errors.length, 2);
});

test('large valid session histories are fully scanned, including compressed suffix secrets', async t => {
  const home = setup(t),
    engine = new SyncEngine(home, { autoRepo: false });
  const rows = [
    { type: 'session', version: 4, id },
    { type: 'turn/start', seq: 0, time: 1, data: { text: 'x'.repeat(9 * 1024 * 1024) } },
  ];
  const bytes = Buffer.from(rows.map(JSON.stringify).join('\n') + '\n');
  assert.deepEqual(inspectContent(file + '.zstd', zstdCompressSync(bytes)), []);
  put(home, file, bytes);
  execFileSync('git', ['init', '-b', 'main'], { cwd: home, stdio: 'ignore' });
  for (const args of [
    ['config', 'user.name', 'fixture'],
    ['config', 'user.email', 'fixture@invalid'],
    ['add', '.'],
    ['commit', '-m', 'fixture'],
  ])
    execFileSync('git', args, { cwd: home, stdio: 'ignore' });
  assert.deepEqual((await scanOutgoing(engine, 'HEAD')).findings, []);
  rows[1].data.secret = 'sk-' + 'A'.repeat(30);
  assert.ok(
    inspectContent(file + '.zstd', zstdCompressSync(Buffer.from(rows.map(JSON.stringify).join('\n') + '\n'))).includes(
      '服务密钥格式',
    ),
  );
});

test('pending session application never publishes a successful other-device receipt', async t => {
  const root = setup(t),
    remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  const make = name => {
    const home = path.join(root, name);
    fs.mkdirSync(home);
    const e = acceptFixturePreviews(
      new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false, patches: false }),
    );
    e.verifyPrivateRemote = async () => ({ ok: true });
    return e;
  };
  const a = attachFixturePersistence(make('a')),
    b = make('b');
  put(a.home, file, encode(2));
  assert.equal((await a.syncOnce('test', { forceCommit: true })).error, undefined);
  const result = await b.syncOnce('test', { forceCommit: true });
  assert.equal(result.downloadPending, true);
  assert.equal(fs.existsSync(path.join(b.home, file)), false);
  assert.equal(b.handoffStatus(), null);
  await a.syncOnce('test', { forceCommit: true });
  assert.equal(a.handoffStatus().peers.length, 0);
});

test('disabling session scope pauses existing partial application rather than secretly appending', async t => {
  const home = setup(t),
    engine = attachFixturePersistence(new SyncEngine(home, { autoRepo: false, workspaceSync: false }));
  put(home, file, encode(2));
  const open = engine.ctx.sessionPersistence.open.bind(engine.ctx.sessionPersistence);
  engine.ctx.sessionPersistence.open = async (...args) => {
    const h = await open(...args);
    h.append = async () => {
      throw new Error('fixture disk error');
    };
    return h;
  };
  assert.equal((await applySessionTransfer(engine, file, encode(4))).deferred, true);
  engine.overrides.contentScope = { sessions: false, attachments: true, settings: true };
  assert.ok((await retrySessionTransfers(engine)).error);
  assert.deepEqual(fs.readFileSync(path.join(home, file)), encode(2));
});

test('logical prefix comparison selects existing bytes while genuine branches remain independent', async t => {
  const home = setup(t),
    engine = new SyncEngine(home, { autoRepo: false });
  const header = { type: 'session', version: 0, id };
  const packed = {
    type: 'text-chunks',
    seq0: 0,
    time0: 1,
    data: { turn: 0, step: 0, index: 0, texts: ['a', 'b'], dt: [1] },
  };
  const expanded = [0, 1].map(seq => ({ type: 'text/chunk', seq, time: seq + 1, data: { text: seq ? 'b' : 'a' } }));
  engine.loadTransferCatalog = async () => ({
    createRestore(header) {
      const events = [];
      return {
        decodeRow(row) {
          if (row.type === 'text-chunks') events.push(...expanded);
          else events.push(row);
        },
        finish() {
          return { header, events, inheritedEventCount: 0 };
        },
      };
    },
  });
  const a = Buffer.from([header, packed].map(JSON.stringify).join('\n') + '\n'),
    b = Buffer.from(
      [header, ...expanded, { type: 'turn/end', seq: 2, time: 3, data: {} }].map(JSON.stringify).join('\n') + '\n',
    );
  const selected = await chooseSessionHistory(engine, a, b);
  assert.equal(selected.logicalPrefix, true);
  assert.deepEqual(selected.value, b);
  const branch = Buffer.from(
    [header, ...expanded.slice(0, 1), { ...expanded[1], data: { text: 'different' } }].map(JSON.stringify).join('\n') +
      '\n',
  );
  assert.equal((await chooseSessionHistory(engine, a, branch)).ok, false);
});
