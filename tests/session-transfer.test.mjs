import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { zstdCompressSync } from 'node:zlib';
import { SyncEngine } from '../lib/sync.js';
import { mergeSessionLog, parseSessionLog } from '../lib/merge.js';
import {
  applySessionTransfer,
  pendingSessionTransfers,
  retrySessionTransfers,
  selectSessionGenerations,
} from '../lib/session-transfer.js';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { removeFixture } from './helpers/fixture-cleanup.mjs';
import { inspectContent } from '../lib/privacy.js';

const id = 'session-11111111-1111-1111-1111-111111111111';
const file = 'sessions/example/' + id + '/session.v4.jsonl';
const header = { type: 'session', version: 4, id };
const event = seq => ({
  type: seq % 2 ? 'turn/end' : 'turn/start',
  seq,
  time: seq + 1,
  data: { turn: Math.floor(seq / 2) + 1 },
});
const encode = n =>
  Buffer.from([header, ...Array.from({ length: n }, (_, i) => event(i))].map(JSON.stringify).join('\n') + '\n');
const packedLog = (version = 0, type = 'reasoning-chunks') => [
  { ...header, version },
  event(0),
  {
    type,
    seq0: 1,
    time0: 2,
    data: {
      turn: 1,
      step: 0,
      index: 0,
      dt: [1, 1],
      ...(type === 'tool-call-chunks'
        ? { id: 'call-fixture', name: 'fixture', args: ['{', '"x":1', '}'] }
        : { texts: ['a', 'b', 'c'] }),
    },
  },
  event(4),
];
const encodeRows = rows => Buffer.from(rows.map(JSON.stringify).join('\n') + '\n');

test('released v0/v1 packed rows retain original bytes and logical sequence continuity', () => {
  for (const version of [0, 1])
    for (const type of ['text-chunks', 'reasoning-chunks', 'tool-call-chunks']) {
      const rows = packedLog(version, type);
      for (const compress of [bytes => bytes, zstdCompressSync]) {
        const bytes = compress(encodeRows(rows));
        assert.deepEqual(parseSessionLog(bytes), rows);
        assert.deepEqual(inspectContent(file, bytes), []);
        const longer = compress(encodeRows([...rows, event(5)]));
        assert.deepEqual(mergeSessionLog(bytes, longer), { ok: true, value: longer });
      }
    }
});

test('packed rows still reject gaps, overlaps, malformed runs, modern packed rows and torn tails', () => {
  const mutations = [
    rows => {
      rows[2].seq0 = 2;
    },
    rows => {
      rows[2].seq0 = 0;
    },
    rows => {
      rows[3].seq = 5;
    },
    rows => {
      rows[3].seq = 3;
    },
    rows => {
      rows[2].data.dt.pop();
    },
    rows => {
      rows[2].data.texts = [];
    },
    rows => {
      rows[2].data.texts[0] = null;
    },
    rows => {
      rows[2].data.dt[0] = 0.5;
    },
    rows => {
      rows[2].data.index = -1;
    },
    rows => {
      rows[2].seq = 1;
    },
    rows => {
      rows[0].version = 3;
    },
    rows => {
      rows[2].time0 = Number.MAX_SAFE_INTEGER;
    },
  ];
  for (const mutate of mutations)
    for (const compress of [bytes => bytes, zstdCompressSync]) {
      const rows = packedLog();
      mutate(rows);
      const bytes = compress(encodeRows(rows));
      assert.equal(parseSessionLog(bytes), null);
      assert.equal(mergeSessionLog(bytes, bytes).ok, false);
      assert.ok(inspectContent(file, bytes).includes('会话记录不完整或序号不连续'));
    }
  assert.equal(parseSessionLog(zstdCompressSync(encodeRows(packedLog()).subarray(0, -1))), null);
});

test(
  'real Git sync accepts archived packed v0 beside a current log and applies only the current generation',
  { timeout: 90000 },
  async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-packed-'));
    t.after(() => removeFixture(root));
    const remote = path.join(root, 'remote.git');
    execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
    const make = name => {
      const home = path.join(root, name);
      fs.mkdirSync(home);
      const engine = acceptFixturePreviews(
        attachFixturePersistence(
          new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false, patches: false }),
        ),
      );
      engine.verifyPrivateRemote = async () => ({ ok: true });
      return engine;
    };
    const a = make('a'),
      b = make('b');
    const oldFile = file.replace('session.v4.jsonl', 'session.jsonl.zstd');
    const target = path.join(a.home, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const archived = zstdCompressSync(encodeRows(packedLog()));
    fs.writeFileSync(path.join(a.home, oldFile), archived);
    fs.writeFileSync(target, encode(12));
    assert.equal((await a.syncOnce('packed-fixture', { forceCommit: true })).error, undefined);
    assert.equal((await b.syncOnce('packed-fixture', { forceCommit: true })).error, undefined);
    assert.deepEqual(fs.readFileSync(path.join(b.home, file)), encode(12));
    assert.equal(fs.existsSync(path.join(b.home, oldFile)), false);
    assert.deepEqual(fs.readFileSync(path.join(a.home, oldFile)), archived);
    fs.writeFileSync(target, encode(14));
    assert.equal((await a.syncOnce('packed-fixture', { forceCommit: true })).error, undefined);
    assert.equal((await b.syncOnce('packed-fixture', { forceCommit: true })).error, undefined);
    assert.deepEqual(fs.readFileSync(path.join(b.home, file)), encode(14));
  },
);
test('only the highest generation is applied, and two current candidates are refused', () => {
  const old = file.replace('v4', 'v3');
  assert.deepEqual([...selectSessionGenerations([old, file])], [file]);
  assert.deepEqual([...selectSessionGenerations([old, old + '.zstd', file])], [file]);
  assert.throws(() => selectSessionGenerations([file, file + '.zstd']), /同代多份/);
});
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-session-transfer-'));
  t.after(() => removeFixture(home));
  const engine = attachFixturePersistence(new SyncEngine(home, { autoRepo: false, workspaceSync: false }));
  const target = path.join(home, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, encode(12));
  return { engine, target, persistence: engine.ctx.sessionPersistence };
}

test('identical and prefix gap logs, duplicate seq and torn tails are refused in plain and compressed logs', () => {
  for (const compress of [bytes => bytes, zstdCompressSync]) {
    const valid = compress(encode(12));
    for (const tail of [event(21), event(11)]) {
      const bad = compress(Buffer.concat([encode(12), Buffer.from(JSON.stringify(tail) + '\n')]));
      assert.equal(mergeSessionLog(valid, bad).ok, false);
      assert.equal(mergeSessionLog(bad, bad).ok, false);
    }
    const torn = compress(encode(12).subarray(0, -1));
    assert.equal(mergeSessionLog(torn, torn).ok, false);
  }
});

test('a held writer defers import and a released writer permits prefix continuation', async t => {
  const { engine, target, persistence } = fixture(t);
  const writer = await persistence.open(id, 'write');
  const deferred = await applySessionTransfer(engine, file, encode(14));
  assert.equal(deferred.reason, 'session-writer-held');
  assert.deepEqual(fs.readFileSync(target), encode(12));
  await writer.close();
  assert.equal((await applySessionTransfer(engine, file, encode(14))).applied, true);
  assert.deepEqual(fs.readFileSync(target), encode(14));
});

test('an append between stat and writer acquisition is read fresh and never truncated', async t => {
  const { engine, target, persistence } = fixture(t);
  const open = persistence.open.bind(persistence);
  persistence.open = async (...args) => {
    fs.writeFileSync(target, encode(31));
    return open(...args);
  };
  const result = await applySessionTransfer(engine, file, encode(22));
  assert.equal(result.reason, 'local-session-ahead');
  assert.deepEqual(fs.readFileSync(target), encode(31));
  fs.appendFileSync(target, JSON.stringify(event(31)) + '\n');
  assert.equal(parseSessionLog(fs.readFileSync(target)).length, 33);
});

test('failed partial appends retain a full retry seed and complete before the next export', async t => {
  const { engine, target, persistence } = fixture(t);
  const open = persistence.open.bind(persistence);
  let failed = false;
  persistence.open = async (...args) => {
    const handle = await open(...args),
      append = handle.append.bind(handle);
    handle.append = async events => {
      if (!failed) {
        failed = true;
        await append(events.slice(0, 1));
        throw new Error('fixture interruption');
      }
      return append(events);
    };
    return handle;
  };
  assert.equal((await applySessionTransfer(engine, file, encode(16))).deferred, true);
  assert.equal(engine.hasPendingSessionImport(), true);
  assert.equal(parseSessionLog(fs.readFileSync(target)).length, 14);
  const reopened = attachFixturePersistence(new SyncEngine(engine.home, { autoRepo: false, workspaceSync: false }));
  assert.equal(await retrySessionTransfers(reopened), null);
  assert.deepEqual(fs.readFileSync(target), encode(16));
  assert.deepEqual(pendingSessionTransfers(engine), {});
});

test('missing public host capabilities and remote deletion preserve the local original', async t => {
  const { engine, target } = fixture(t);
  engine.setHostContext(null);
  assert.equal((await applySessionTransfer(engine, file, encode(16))).reason, 'session-api-unavailable');
  assert.equal((await applySessionTransfer(engine, file, null)).reason, 'session-deletion');
  assert.deepEqual(fs.readFileSync(target), encode(12));
});

test(
  'a corrupted fetched log never reaches the host tree, and a corrected remote can be retried',
  { timeout: 90000 },
  async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-session-gap-'));
    t.after(() => removeFixture(root));
    const producer = path.join(root, 'producer'),
      home = path.join(root, 'home'),
      remote = path.join(root, 'remote.git');
    fs.mkdirSync(producer);
    fs.mkdirSync(home);
    const git = args => execFileSync('git', args, { cwd: producer, windowsHide: true, stdio: 'ignore' });
    git(['init', '--bare', remote]);
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'fixture']);
    git(['config', 'user.email', 'fixture@example.invalid']);
    const source = path.join(producer, file);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, Buffer.concat([encode(12), Buffer.from(JSON.stringify(event(21)) + '\n')]));
    git(['add', '.']);
    git(['commit', '-m', 'bad external fixture']);
    git(['remote', 'add', 'origin', remote]);
    git(['push', 'origin', 'main']);
    const engine = acceptFixturePreviews(
      attachFixturePersistence(new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false, patches: false })),
    );
    engine.verifyPrivateRemote = async () => ({ ok: true });
    const bad = await engine.syncOnce('test', { forceCommit: true });
    assert.equal(bad.error, 'invalid-remote-session');
    assert.equal(fs.existsSync(path.join(home, file)), false);
    fs.writeFileSync(source, encode(22));
    git(['add', '.']);
    git(['commit', '-m', 'corrected fixture']);
    git(['push', 'origin', 'main']);
    const repaired = await engine.syncOnce('test', { forceCommit: true });
    assert.equal(repaired.error, undefined, JSON.stringify(repaired));
    assert.deepEqual(fs.readFileSync(path.join(home, file)), encode(22));
  },
);

test(
  'real Git merge cannot overwrite a separate producer appending nine events to the host tree',
  { timeout: 120000 },
  async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-issue4-safe-'));
    t.after(() => removeFixture(root));
    const remote = path.join(root, 'remote.git');
    execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
    const make = name => {
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
      engine.verifyPrivateRemote = async () => ({ ok: true });
      return engine;
    };
    const a = make('a'),
      b = make('b');
    const put = (engine, n) => {
      const target = path.join(engine.home, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, encode(n));
    };
    const sync = engine => engine.syncOnce('issue4-fixture', { forceCommit: true });
    put(a, 12);
    assert.equal((await sync(a)).error, undefined);
    assert.equal((await sync(b)).error, undefined);
    put(a, 14);
    put(b, 22);
    assert.equal((await sync(a)).error, undefined);
    const original = b._transport._writeMerged.bind(b._transport);
    let injected = false;
    b._transport._writeMerged = (name, bytes) => {
      if (name === file && !injected) {
        injected = true;
        execFileSync(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            'import fs from "node:fs";fs.appendFileSync(process.argv[1],Buffer.from(process.argv[2],"base64"));',
            path.join(b.home, file),
            encode(31).subarray(encode(22).length).toString('base64'),
          ],
          { windowsHide: true },
        );
      }
      return original(name, bytes);
    };
    const result = await sync(b);
    assert.equal(injected, true);
    assert.ok(result.scopeWarnings?.length);
    assert.deepEqual(fs.readFileSync(path.join(b.home, file)), encode(31));
    fs.appendFileSync(path.join(b.home, file), JSON.stringify(event(31)) + '\n');
    assert.equal((await sync(b)).error, undefined);
    assert.equal((await sync(a)).error, undefined);
    assert.deepEqual(fs.readFileSync(path.join(a.home, file)), encode(32));
    assert.equal(fs.existsSync(path.join(a.home, '.git')), false, 'live DSH root is never a Git worktree');
  },
);
