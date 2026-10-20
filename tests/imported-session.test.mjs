import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { classifyFile, mergeSessionLog } from '../lib/merge.js';
import { probeLogActivity } from '../lib/session-activity.js';

test('imported local and remote-only sessions retain project membership while deleted registrations are removed', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-imported-identity-'));
  t.after(() => removeFixture(home));
  const localId = 'import-11111111-1111-1111-1111-111111111111';
  const remoteId = 'codex-22222222-2222-2222-2222-222222222222';
  const ghostId = 'import-33333333-3333-3333-3333-333333333333';
  const engine = new SyncEngine(home, { autoRepo: false, branch: 'main', workspaceSync: false });
  const git = args => execFileSync('git', args, { cwd: home, stdio: 'pipe', encoding: 'utf8' });
  git(['init', '-b', 'main']); git(['config', 'user.name', 'fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
  const remoteFile = path.join(home, 'sessions/project', remoteId, 'session.v4.jsonl');
  fs.mkdirSync(path.dirname(remoteFile), { recursive: true });
  fs.writeFileSync(remoteFile, JSON.stringify({ type: 'session', version: 4, id: remoteId, cwd: home }) + '\n');
  git(['add', '.']); git(['commit', '-m', 'fixture remote session']); git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  fs.unlinkSync(remoteFile);
  fs.rmdirSync(path.dirname(remoteFile));
  const localFile = path.join(home, 'sessions/project', localId, 'session.v4.jsonl');
  fs.mkdirSync(path.dirname(localFile), { recursive: true });
  fs.writeFileSync(localFile, JSON.stringify({ type: 'session', version: 4, id: localId, cwd: home }) + '\n');
  fs.mkdirSync(path.join(home, 'storages'));
  const registryFile = path.join(home, 'storages/workspace.json');
  fs.writeFileSync(registryFile, JSON.stringify({ global: { workspaceIds: ['project'], archivedSessionIds: [remoteId, ghostId] },
    tables: { workspaces: { project: { path: home, sessionIds: [localId, remoteId, ghostId] } } } }));
  const result = await engine.pruneGhostRegistrations();
  assert.equal(result.pruned, 2);
  const saved = JSON.parse(fs.readFileSync(registryFile));
  assert.deepEqual(saved.tables.workspaces.project.sessionIds, [localId, remoteId]);
  assert.deepEqual(saved.global.archivedSessionIds, [remoteId]);
  assert.deepEqual(engine.scanSessions().map(s => s.id), [localId]);
  assert.deepEqual([...await engine.remoteSessionIds('main')], [remoteId]);
  const activity = probeLogActivity({ home });
  assert.equal(activity.available, true);
  assert.deepEqual(activity.activeIds, [localId], 'Imported conversations must also postpone restart when recently written');
});

test('imported histories use session conflict protection rather than opaque text replacement', () => {
  const id = 'import-11111111-1111-1111-1111-111111111111';
  const file = 'sessions/project/' + id + '/session.v4.jsonl';
  const header = { type: 'session', version: 4, id };
  const encode = value => Buffer.from([header, { type: 'user/message', seq: 0, time: 1, data: { text: value } }].map(JSON.stringify).join('\n') + '\n');
  assert.equal(classifyFile(file), 'session-log');
  assert.equal(mergeSessionLog(encode('left'), encode('right')).ok, false);
  assert.equal(classifyFile(file + '.conflict-copy'), 'opaque');
});
