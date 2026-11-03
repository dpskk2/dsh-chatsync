import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { zstdCompressSync } from 'node:zlib';
import { SyncEngine } from '../lib/sync.js';
import { sessionIdOfLogPath, sessionIdPattern } from '../lib/session-path.js';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

// DSH keeps the caller's session id when one is supplied, e.g. a bare UUID (issue #13).
const id = '24fc0cb2-58d1-41d0-b0af-dc2a0d7d8299';
const file = 'sessions/--D-OneDrive--/' + id + '/session.v4.jsonl.zstd';
const event = seq => ({
  type: seq % 2 ? 'turn/end' : 'turn/start',
  seq,
  time: seq + 1,
  data: { turn: (seq >> 1) + 1 },
});
const encode = n =>
  zstdCompressSync(
    Buffer.from(
      [{ type: 'session', version: 4, id }, ...Array.from({ length: n }, (_, i) => event(i))]
        .map(JSON.stringify)
        .join('\n') + '\n',
    ),
  );

test('bare UUID session folders are sessions; other folder names still are not', () => {
  assert.equal(sessionIdOfLogPath(file), id);
  assert.equal(sessionIdOfLogPath('sessions/w/session-' + id + '/session.v4.jsonl'), 'session-' + id);
  for (const name of ['storages', 'sessions', 'session_projcache', 'sync-meta', '--D-OneDrive--', id + '-x'])
    assert.equal(sessionIdPattern.test(name), false, name);
});

// A producer computer pushes `bytes` as the session log; returns a fresh second computer.
function secondComputer(t, bytes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-session-id-'));
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
  fs.mkdirSync(path.dirname(path.join(producer, file)), { recursive: true });
  fs.writeFileSync(path.join(producer, file), bytes);
  git(['add', '.']);
  git(['commit', '-m', 'bare uuid session']);
  git(['remote', 'add', 'origin', remote]);
  git(['push', 'origin', 'main']);
  const engine = acceptFixturePreviews(
    attachFixturePersistence(new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false, patches: false })),
  );
  engine.verifyPrivateRemote = async () => ({ ok: true });
  return { home, engine };
}

test('a bare UUID session from another computer is applied through the host writer', { timeout: 90000 }, async t => {
  const { home, engine } = secondComputer(t, encode(6));
  const result = await engine.syncOnce('test', { forceCommit: true });
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.deepEqual(result.sessionDeferred || [], []);
  assert.ok(fs.existsSync(path.join(home, file)));
});

test('a damaged bare UUID session is refused like any other session', { timeout: 90000 }, async t => {
  // seq jumps from 5 to 9: before this fix the file travelled as an opaque blob.
  const gap = zstdCompressSync(
    Buffer.concat([
      Buffer.from(
        [{ type: 'session', version: 4, id }, ...Array.from({ length: 6 }, (_, i) => event(i)), event(9)]
          .map(JSON.stringify)
          .join('\n') + '\n',
      ),
    ]),
  );
  const { home, engine } = secondComputer(t, gap);
  const result = await engine.syncOnce('test', { forceCommit: true });
  assert.equal(result.error, 'invalid-remote-session');
  assert.equal(fs.existsSync(path.join(home, file)), false);
});
