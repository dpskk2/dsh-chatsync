import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createSendGuard, protectPrompt } from '../lib/send-guard.js';
import { SyncEngine } from '../lib/sync.js';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

const oldId = 'session-11111111-1111-1111-1111-111111111111';
const newId = 'session-22222222-2222-2222-2222-222222222222';
const file = 'sessions/example/' + oldId + '/session.v4.jsonl';
const encode = count => Buffer.from([{ type: 'session', version: 4, id: oldId }, ...Array.from({ length: count }, (_, seq) =>
  ({ type: seq % 2 ? 'turn/end' : 'turn/start', seq, time: seq + 1, data: { turn: Math.floor(seq / 2) + 1 } }))].map(JSON.stringify).join('\n') + '\n');

test('only pre-existing unchecked sessions are blocked, with host admission checked before any side effect', async () => {
  const config = { remote: 'fixture', enabled: true, autoPullOnStart: true };
  const guard = createSendGuard({ loadConfig: () => config, localSessionIds: () => new Set([oldId]) });
  const calls = [], controller = { prompt(request) { calls.push(request); return 'accepted'; } };
  const original = controller.prompt, restore = protectPrompt(controller, guard);
  assert.equal(guard.check(oldId).allowed, false); assert.equal(guard.check(newId).allowed, true);
  for (const mode of ['queue', 'steer']) assert.throws(() => controller.prompt({ sessionId: oldId, mode, content: [{ type: 'image' }] }), /消息未发送/);
  assert.equal(calls.length, 0);
  assert.equal(controller.prompt({ sessionId: newId }), 'accepted');
  guard.verify([oldId]); assert.equal(controller.prompt({ sessionId: oldId }), 'accepted');
  guard.require([oldId]); assert.equal(guard.check(oldId).allowed, false);
  config.remote = 'another'; assert.equal(guard.check(oldId).allowed, false);
  config.enabled = false; assert.equal(guard.check(oldId).allowed, true);
  restore(); assert.equal(controller.prompt, original);
});

test('real Git remote update is applied and verified before old-session sends are released, independent of project failure', { timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-send-gate-')); t.after(() => removeFixture(root));
  const remote = path.join(root, 'remote.git'); execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  const make = name => {
    const home = path.join(root, name); fs.mkdirSync(home);
    const e = attachFixturePersistence(new SyncEngine(home, { remote, autoRepo: false, workspaceSync: false, enabled: true, autoPullOnStart: true }));
    e.verifyPrivateRemote = async () => ({ ok: true }); return e;
  };
  const a = make('a'), b = make('b');
  fs.mkdirSync(path.dirname(path.join(a.home, file)), { recursive: true }); fs.writeFileSync(path.join(a.home, file), encode(2));
  assert.equal((await a.syncOnce('seed', { forceCommit: true })).error, undefined);
  assert.equal((await b.syncOnce('seed', { forceCommit: true })).error, undefined);
  b.sendGuard = createSendGuard(b);
  assert.equal(b.sendGuard.check(oldId).allowed, false);
  const ignoreFile = path.join(b.home, '.gitignore'), originalIgnore = fs.readFileSync(ignoreFile, 'utf8');
  fs.writeFileSync(ignoreFile, originalIgnore + '\n/sessions/example/' + oldId + '/\n');
  assert.equal(b.sendGuard.check(oldId).allowed, true, 'explicitly local-only originals do not wait for inbound sync');
  fs.writeFileSync(ignoreFile, originalIgnore);
  assert.equal(b.sendGuard.check(oldId).allowed, false, 'removing exclusion restores the startup check');
  assert.equal(b.sendGuard.check(newId).allowed, true);
  fs.writeFileSync(path.join(a.home, file), encode(4)); assert.equal((await a.syncOnce('append', { forceCommit: true })).error, undefined);
  const persistence = b.ctx.sessionPersistence, open = persistence.open;
  persistence.open = async () => { const error = new Error('fixture owned'); error.name = 'SessionAlreadyOwnedError'; throw error; };
  const pending = await b.syncOnce('startup', { forceCommit: true });
  assert.equal(pending.downloadPending, true, JSON.stringify(pending));
  assert.equal(b.sendGuard.check(oldId).allowed, false);
  assert.deepEqual(fs.readFileSync(path.join(b.home, file)), encode(2));
  persistence.open = open;
  b.syncAllWorkspaces = async () => ({ errors: [{ id: 'unrelated', error: 'fixture project upload' }] });
  const applied = await b.syncOnce('startup', { forceCommit: true });
  assert.equal(applied.needsReview, undefined); assert.equal(applied.workspaces.errors.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(b.home, file)), encode(4));
  assert.equal(b.sendGuard.check(oldId).allowed, true);
});
