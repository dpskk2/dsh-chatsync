import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { analyzeRepoUsage } from '../lib/repo-usage.js';
import { scopeMirrorPath } from '../lib/scope.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

// The usage check tells current content from history and archived or unregistered
// sessions from those in use, and changes nothing in the repository.
const live = 'session-66666666-6666-4666-8666-666666666666';
const archived = 'session-77777777-7777-4777-8777-777777777777';
const hidden = 'session-88888888-8888-4888-8888-888888888888';
const logOf = id => 'sessions/project/' + id + '/session.v4.jsonl';
const log = id =>
  [
    { type: 'session', version: 4, id, cwd: 'C:/project' },
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'turn/end', seq: 1, time: 2, data: { turn: 1 } },
  ]
    .map(JSON.stringify)
    .join('\n') + '\n';

test('repository usage splits current content, history and session groups', { timeout: 180000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-usage-'));
  t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
  // An older version uploaded a machine-only file.
  const old = path.join(root, 'old');
  execFileSync('git', ['clone', remote, old], { stdio: 'ignore' });
  fs.mkdirSync(path.join(old, 'profiles/desktop'), { recursive: true });
  fs.writeFileSync(path.join(old, 'profiles/desktop/package.json'), '{"from":"old"}');
  const oldGit = args =>
    execFileSync('git', ['-c', 'user.name=old', '-c', 'user.email=old@invalid', ...args], {
      cwd: old,
      stdio: 'ignore',
    });
  oldGit(['add', '.']);
  oldGit(['commit', '-m', 'older version']);
  oldGit(['push', 'origin', 'HEAD:main']);

  const home = path.join(root, 'a');
  fs.mkdirSync(home);
  const engine = acceptFixturePreviews(
    attachFixturePersistence(new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false })),
  );
  engine.verifyPrivateRemote = async () => ({ ok: true });
  const put = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(home, file)), { recursive: true });
    fs.writeFileSync(path.join(home, file), value);
  };
  const sync = async () => {
    const result = await engine.syncOnce('test', { forceCommit: true });
    assert.equal(result.error, undefined, JSON.stringify(result));
  };
  for (const id of [live, archived, hidden]) put(logOf(id), log(id));
  put(
    'storages/workspace.json',
    JSON.stringify({
      global: { initialized: true, workspaceIds: ['w'], archivedSessionIds: [archived] },
      tables: { workspaces: { w: { path: 'C:/project', title: 'project', sessionIds: [live, archived] } } },
    }),
  );
  put('attachments/big.bin', randomBytes(64 * 1024));
  await sync();
  put('attachments/big.bin', randomBytes(64 * 1024));
  await sync();

  const refs = () => execFileSync('git', ['--git-dir', remote, 'for-each-ref'], { encoding: 'utf8' });
  const mirror = scopeMirrorPath(home, engine.loadConfig());
  const mirrorHead = () => execFileSync('git', ['-C', mirror, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const before = [refs(), mirrorHead()];

  const usage = await analyzeRepoUsage(engine);
  assert.equal(usage.ok, true);
  const group = id => usage.groups.find(g => g.id === id);
  assert.ok(group('sessions').files >= 1);
  assert.equal(group('archived').files, 1);
  assert.equal(group('hidden').files, 1);
  assert.equal(group('leftover').files, 1);
  assert.equal(group('attachments').files, 1);
  assert.ok(group('attachments').historyBytes > 60 * 1024, 'the replaced attachment stays in history');
  assert.equal(usage.largestHistory[0].path, 'attachments/big.bin');
  assert.ok(usage.commits >= 3);
  assert.equal(usage.totalBytes, usage.currentBytes + usage.historyBytes + usage.structureBytes);
  assert.deepEqual(usage.branches, { project: 0, backup: 0, device: 1, other: 0 });

  assert.deepEqual([refs(), mirrorHead()], before, 'the check changes no branch or copy');
});
