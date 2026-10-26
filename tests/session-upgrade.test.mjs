import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { zstdCompressSync } from 'node:zlib';
import { SyncEngine, pickSessionLog } from '../lib/sync.js';
import { pickSessionLogFile } from '../lib/session-activity.js';
import { sessionLogGeneration } from '../lib/session-path.js';
import { selectSessionGenerations } from '../lib/session-transfer.js';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { removeFixture } from './helpers/fixture-cleanup.mjs';
import { releasedPackedSession } from './helpers/released-session-fixture.mjs';

const id = 'session-11111111-1111-1111-1111-111111111111';
const dir = 'sessions/project/' + id + '/';
const encode = rows => Buffer.from(rows.map(JSON.stringify).join('\n') + '\n');
const current = n =>
  encode([
    { type: 'session', version: 4, id },
    ...Array.from({ length: n }, (_, seq) => ({ type: 'event', seq, time: seq, data: { value: 'fixture' } })),
  ]);
const legacy = version => zstdCompressSync(encode(releasedPackedSession(version, id)));

test('native and imported log names use the same discovery and generation rules', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-imported-log-'));
  t.after(() => removeFixture(root));
  fs.writeFileSync(path.join(root, 'log.v4.jsonl'), 'fixture');
  assert.equal(pickSessionLog(root), path.join(root, 'log.v4.jsonl'));
  assert.equal(pickSessionLogFile(root), path.join(root, 'log.v4.jsonl'));
  fs.writeFileSync(path.join(root, 'session.v4.jsonl'), 'fixture');
  assert.equal(pickSessionLog(root), null);
  assert.equal(pickSessionLogFile(root), null);
});

test('all selectors agree that compression does not change the generation, including v0 → v1', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-generation-'));
  t.after(() => removeFixture(root));
  for (const oldCompressed of [false, true])
    for (const version of [1, 2, 3, 4, 5])
      for (const compressed of [false, true]) {
        const older = 'session.jsonl' + (oldCompressed ? '.zstd' : '');
        const newer = 'session.v' + version + '.jsonl' + (compressed ? '.zstd' : '');
        fs.writeFileSync(path.join(root, older), 'fixture');
        fs.writeFileSync(path.join(root, newer), 'fixture');
        assert.equal(sessionLogGeneration(older), 0);
        assert.equal(sessionLogGeneration(newer), version);
        assert.equal(pickSessionLog(root), path.join(root, newer));
        assert.equal(pickSessionLogFile(root), path.join(root, newer));
        assert.deepEqual([...selectSessionGenerations([dir + newer, dir + older])], [dir + newer]);
        fs.unlinkSync(path.join(root, older));
        fs.unlinkSync(path.join(root, newer));
      }
});

test('ambiguous highest generations are never picked arbitrarily; an unambiguous successor remains usable', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-generation-'));
  t.after(() => removeFixture(root));
  for (const name of ['session.jsonl', 'session.jsonl.zstd']) fs.writeFileSync(path.join(root, name), 'fixture');
  assert.equal(pickSessionLog(root), null);
  assert.equal(pickSessionLogFile(root), null);
  assert.throws(() => selectSessionGenerations(['session.jsonl', 'session.jsonl.zstd'].map(n => dir + n)), /同代多份/);
  fs.writeFileSync(path.join(root, 'session.v1.jsonl'), 'fixture');
  assert.equal(pickSessionLog(root), path.join(root, 'session.v1.jsonl'));
  assert.equal(pickSessionLogFile(root), path.join(root, 'session.v1.jsonl'));
});

// Reproduce the old on-disk topology (Git in DSH home and archived physical
// generations). This test does not claim to execute an old installed DSH host.
test(
  'upgrade from a legacy home Git repository preserves originals and exchanges current logs beside v0/v1 archives',
  { timeout: 120000 },
  async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-upgrade-'));
    t.after(() => removeFixture(root));
    const remote = path.join(root, 'remote.git'),
      home = path.join(root, 'old-home');
    fs.mkdirSync(home);
    const git = (...args) =>
      execFileSync('git', args, { cwd: home, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '--bare', remote);
    git('init', '-b', 'main');
    git('config', 'user.name', 'fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    const put = (base, file, bytes) => {
      const target = path.join(base, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    };
    const archives = { 'session.jsonl.zstd': legacy(0), 'session.v1.jsonl.zstd': legacy(1) };
    for (const [name, bytes] of Object.entries(archives)) put(home, dir + name, bytes);
    put(home, dir + 'session.v4.jsonl', current(2));
    git('add', 'sessions');
    git('commit', '-m', 'legacy home layout');
    git('remote', 'add', 'origin', remote);
    git('push', 'origin', 'main');
    const oldHead = git('rev-parse', 'HEAD');
    // Already-written local events must survive upgrade even when not committed
    // in the old home repository. The transport is seeded from the remote tree.
    put(home, dir + 'session.v4.jsonl', current(4));
    const make = base => {
      fs.mkdirSync(base, { recursive: true });
      const engine = acceptFixturePreviews(
        attachFixturePersistence(
          new SyncEngine(base, { remote, autoRepo: false, workspaceSync: false, patches: false }),
        ),
      );
      engine.verifyPrivateRemote = async () => ({ ok: true });
      return engine;
    };
    const a = make(home),
      b = make(path.join(root, 'new-home'));
    const sync = async engine => {
      const result = await engine.syncOnce('upgrade-fixture', { forceCommit: true });
      assert.equal(result.error, undefined, JSON.stringify(result));
    };
    await sync(a);
    await sync(b);
    assert.deepEqual(fs.readFileSync(path.join(b.home, dir + 'session.v4.jsonl')), current(4));
    for (const name of Object.keys(archives)) assert.equal(fs.existsSync(path.join(b.home, dir + name)), false);
    put(b.home, dir + 'session.v4.jsonl', current(6));
    await sync(b);
    await sync(a);
    assert.deepEqual(fs.readFileSync(path.join(home, dir + 'session.v4.jsonl')), current(6));
    for (const [name, bytes] of Object.entries(archives))
      assert.deepEqual(fs.readFileSync(path.join(home, dir + name)), bytes);
    assert.equal(git('rev-parse', 'HEAD'), oldHead, 'upgrade must not merge/reset the live home repository');
    assert.equal(fs.existsSync(path.join(b.home, '.git')), false);
  },
);
