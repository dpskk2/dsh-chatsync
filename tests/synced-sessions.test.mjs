import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { listSyncedSessions, projectFolderLabel } from '../lib/synced-sessions.js';
import { removeSessionsFromSync } from '../lib/session-removals.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

const shown = 'session-66666666-6666-4666-8666-666666666666';
const hidden = 'session-77777777-7777-4777-8777-777777777777';
const log = id =>
  [
    { type: 'session', version: 4, id, cwd: 'C:/project' },
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'turn/end', seq: 1, time: 2, data: { turn: 1 } },
  ]
    .map(JSON.stringify)
    .join('\n') + '\n';

test('project folder labels decode the non-ASCII part of a DSH folder name', () => {
  assert.equal(projectFolderLabel('--C-Users-u-OneDrive-Document-~9879~76EE-chatsync--'), 'chatsync');
  assert.equal(projectFolderLabel('--C-Users-u-~9879~76EE-~804A~5929--'), '聊天');
});

test('the session list groups registered sessions apart and leaves out removed ones', { timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-list-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
  const home = path.join(root, 'a');
  fs.mkdirSync(home);
  const a = acceptFixturePreviews(
    attachFixturePersistence(new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false })),
  );
  a.verifyPrivateRemote = async () => ({ ok: true });
  const put = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(home, file)), { recursive: true });
    fs.writeFileSync(path.join(home, file), value);
  };
  put('sessions/--C-Users-u-~804A~5929--/' + shown + '/session.v4.jsonl', log(shown));
  put('sessions/--C-Users-u-old--/' + hidden + '/session.v4.jsonl', log(hidden));
  put(
    'storages/session_projcache/sessions/' + shown + '.json',
    JSON.stringify({ record: { rows: { title: { val: 'say hi' } } } }),
  );
  put(
    'storages/workspace.json',
    JSON.stringify({
      global: { initialized: true, workspaceIds: ['w'], archivedSessionIds: [] },
      tables: { workspaces: { w: { path: 'C:/project', title: 'default-workspace', sessionIds: [shown] } } },
    }),
  );
  assert.equal((await a.syncOnce('test', { forceCommit: true })).error, undefined);

  let list = listSyncedSessions(a);
  assert.equal(list.sharedKnown, true);
  const byId = Object.fromEntries(list.sessions.map(s => [s.id, s]));
  assert.equal(byId[shown].title, 'say hi');
  assert.equal(byId[shown].project, 'default-workspace');
  assert.equal(byId[shown].folder, '聊天');
  assert.equal(byId[hidden].project, null);
  assert.equal(byId[hidden].inShared, true);

  removeSessionsFromSync(a, [hidden]);
  list = listSyncedSessions(a);
  assert.deepEqual(
    list.sessions.map(s => s.id),
    [shown],
  );
  assert.equal(list.removedCount, 1);
});
