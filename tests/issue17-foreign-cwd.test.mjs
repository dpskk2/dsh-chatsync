import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog';
import { SyncEngine } from '../lib/sync.js';
import { applySessionTransfer, foreignSessionCwd, validateTransferSession } from '../lib/session-transfer.js';
import { decodeRecoverySession } from '../lib/session-recovery.js';
import { summarize } from '../lib/http/summary.js';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

const winCwd = 'C:\\Users\\win-user\\Documents\\deepseek-harness\\default-workspace';
const macCwd = '/Users/mac-user/Documents/deepseek-harness/default-workspace';
const sessionRows = (id, cwd, title = 'fixture') => [
  { type: 'session', version: 4, id, createdAt: 1700000000000, cwd, isSeeded: false, delegationDepth: 0 },
  { seq: 0, time: 1700000000001, type: 'session/title', data: { title, messageSeqs: [], source: { kind: 'user' } } },
];
const encode = rows => Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');

test('only an absolute path of the other OS counts as foreign', () => {
  assert.equal(foreignSessionCwd(winCwd, path.posix), winCwd);
  assert.equal(foreignSessionCwd('\\\\server\\share\\ws', path.posix), '\\\\server\\share\\ws');
  assert.equal(foreignSessionCwd(macCwd, path.posix), null);
  // win32 treats a rooted POSIX path as absolute; the host accepts it there.
  assert.equal(foreignSessionCwd(macCwd, path.win32), null);
  assert.equal(foreignSessionCwd(winCwd, path.win32), null);
  assert.equal(foreignSessionCwd('relative/dir', path.posix), null);
  assert.equal(foreignSessionCwd(undefined, path.posix), null);
});

test(
  'the official codec still checks a foreign session, with only its cwd projected',
  { skip: process.platform === 'win32' && 'the host accepts both path styles on Windows' },
  async () => {
    const engine = { loadTransferCatalog: async () => sessionFormatCatalog };
    const id = 'session-17171717-1717-1717-1717-171717171717',
      file = `sessions/x/${id}/session.v4.jsonl`;
    const good = encode(sessionRows(id, winCwd));
    assert.throws(() => decodeRecoverySession(good, sessionFormatCatalog), /cwd must be absolute/);
    assert.deepEqual(await validateTransferSession(engine, file, good), { foreign: winCwd });
    const bad = encode([sessionRows(id, winCwd)[0], { seq: 0, time: 1, type: 'step/end', data: { turn: 1, step: 1 } }]);
    await assert.rejects(validateTransferSession(engine, file, bad), /step\/end/);
    const applied = await applySessionTransfer(engine, file, good);
    assert.equal(applied.reason, 'foreign-platform-session');
  },
);

test('a Windows session on the remote no longer stops a macOS sync', { timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-issue17-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  // A host catalog that applies the macOS rule for header cwd, on any test OS.
  const posixCatalog = {
    createRestore(header) {
      if (typeof header.cwd === 'string' && !path.posix.isAbsolute(header.cwd))
        throw new Error('format v4 header cwd must be absolute');
      return { decodeRow() {}, finish: () => ({ header, events: [] }) };
    },
  };
  const make = (name, hostPath, catalog) => {
    const home = path.join(root, name);
    fs.mkdirSync(home);
    const engine = acceptFixturePreviews(
      attachFixturePersistence(
        new SyncEngine(home, {
          remote,
          autoRepo: false,
          workspaceSync: false,
          patches: false,
          autoRestartAfterRepair: false,
        }),
      ),
    );
    engine.hostPath = hostPath;
    if (catalog) engine.loadTransferCatalog = async () => catalog;
    engine.verifyPrivateRemote = async () => ({ ok: true });
    return engine;
  };
  const windows = make('windows', path.win32),
    mac = make('mac', path.posix, posixCatalog);
  const put = (engine, id, cwd) => {
    const rel = `sessions/default-workspace/${id}/session.v4.jsonl`;
    fs.mkdirSync(path.dirname(path.join(engine.home, rel)), { recursive: true });
    fs.writeFileSync(path.join(engine.home, rel), encode(sessionRows(id, cwd)));
    return rel;
  };
  const sync = engine => engine.syncOnce('issue17', { forceCommit: true });

  const macFile = put(mac, 'session-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', macCwd);
  assert.equal((await sync(mac)).error, undefined);
  const winFile = put(windows, 'session-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', winCwd);
  const up = await sync(windows);
  assert.equal(up.error, undefined, JSON.stringify(up));
  assert.ok(fs.existsSync(path.join(windows.home, macFile)), 'Windows still receives the macOS session');

  const down = await sync(mac);
  assert.equal(down.error, undefined, JSON.stringify(down));
  assert.deepEqual(
    down.sessionsForeign.map(s => s.id),
    ['session-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
  );
  assert.match(summarize(down), /1 个会话建在另一种系统上/);
  assert.equal(fs.existsSync(path.join(mac.home, winFile)), false);
  assert.equal(down.sessionDeferred, undefined);

  // macOS keeps syncing its own work, and never retires the Windows session.
  put(mac, 'session-cccccccc-cccc-cccc-cccc-cccccccccccc', macCwd);
  const again = await sync(mac);
  assert.equal(again.error, undefined, JSON.stringify(again));
  const tree = execFileSync('git', ['--git-dir=' + remote, 'ls-tree', '-r', '--name-only', 'main'], {
    encoding: 'utf8',
  });
  assert.match(tree, /session-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/);
  assert.match(tree, /session-cccccccc-cccc-cccc-cccc-cccccccccccc/);
  assert.equal((await sync(windows)).error, undefined);
  assert.ok(fs.existsSync(path.join(windows.home, winFile)));
});
