import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { summarizeLog, sessionTitle, sessionPreview } from '../lib/session-info.js';
import { removeSessionsFromSync } from '../lib/session-removals.js';
import { listSyncedSessions } from '../lib/synced-sessions.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

// The sync page names sessions by the title and first messages in their own log,
// including sessions that now exist only in the shared history.
const id = 'session-99999999-9999-4999-8999-999999999999';
const lines = [
  { type: 'session', version: 4, id, cwd: 'C:/project' },
  { type: 'turn/start', seq: 0, time: 1000, data: { turn: 1 } },
  {
    type: 'user/message',
    seq: 1,
    time: 1001,
    data: { role: 'user', content: [{ type: 'text', text: '帮我整理\n同步方案' }] },
  },
  { type: 'session/title', seq: 2, time: 1002, data: { title: '旧标题' } },
  { type: 'session/title', seq: 3, time: 1003, data: { title: '同步方案整理' } },
  { type: 'user/message', seq: 4, time: 1004, data: { role: 'user', content: [{ type: 'image' }] } },
  { type: 'turn/end', seq: 5, time: 1005, data: { turn: 1 } },
];
const log = lines.map(JSON.stringify).join('\n') + '\n';

test('a log summary has the latest title and the first text messages', () => {
  for (const [buf, file] of [
    [Buffer.from(log), 'session.v4.jsonl'],
    [zstdCompressSync(Buffer.from(log)), 'session.v4.jsonl.zstd'],
  ]) {
    const summary = summarizeLog(buf, file);
    assert.equal(summary.title, '同步方案整理');
    assert.equal(summary.messages, 2);
    assert.deepEqual(summary.preview, ['帮我整理 同步方案']);
    assert.equal(summary.firstAt, 1000);
    assert.equal(summary.lastAt, 1005);
  }
  assert.equal(summarizeLog(Buffer.from('not json\n'), 'x.jsonl').title, '');
});

test('titles and previews come from this computer, the shared copy or its history', { timeout: 180000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-session-info-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
  const home = path.join(root, 'a');
  fs.mkdirSync(home);
  const engine = acceptFixturePreviews(
    attachFixturePersistence(new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false })),
  );
  engine.verifyPrivateRemote = async () => ({ ok: true });
  const logFile = path.join(home, 'sessions/project', id, 'session.v4.jsonl');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, log);
  fs.mkdirSync(path.join(home, 'storages'), { recursive: true });
  fs.writeFileSync(
    path.join(home, 'storages/workspace.json'),
    JSON.stringify({
      global: { initialized: true, workspaceIds: ['w'], archivedSessionIds: [] },
      tables: { workspaces: { w: { path: 'C:/project', title: 'project', sessionIds: [id] } } },
    }),
  );
  const sync = async () => {
    const result = await engine.syncOnce('test', { forceCommit: true });
    assert.equal(result.error, undefined, JSON.stringify(result));
  };
  await sync();

  assert.equal(sessionTitle(engine, id), '同步方案整理', 'no title cache: read from the log');
  assert.equal(listSyncedSessions(engine).sessions[0].title, '同步方案整理');
  let preview = await sessionPreview(engine, id);
  assert.equal(preview.source, 'local');
  assert.deepEqual(preview.preview, ['帮我整理 同步方案']);

  // Removed from sync and deleted here: only the shared history still has it.
  removeSessionsFromSync(engine, [id]);
  await sync();
  fs.rmSync(path.join(home, 'sessions'), { recursive: true });
  assert.equal(sessionTitle(engine, id), '');
  preview = await sessionPreview(engine, id);
  assert.equal(preview.source, 'history');
  assert.equal(preview.title, '同步方案整理');
  await assert.rejects(sessionPreview(engine, 'session-00000000-0000-4000-8000-000000000000'), /找不到/);
});
