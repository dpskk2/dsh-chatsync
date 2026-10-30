// Moving the sync repository to another host (issue #12): what "更换同步仓库"
// carries over today, with local bare repositories standing in for two hosts.
import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';
import { writeSyncConfig } from '../lib/config-file.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';
import { attachFixturePersistence } from './helpers/session-persistence.mjs';

const rel = 'sessions/example/session-22222222-2222-2222-2222-222222222222/session.jsonl';
const header = { type: 'session', version: 4, id: 'session-22222222-2222-2222-2222-222222222222' };
const event = (seq, value) => ({ type: 'event', seq, time: seq, data: { value } });
const encode = rows => rows.map(JSON.stringify).join('\n') + '\n';

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-remote-switch-'));
  t.after(() => removeFixture(root));
  const bare = name => {
    const dir = path.join(root, name);
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', dir]);
    return dir;
  };
  const make = (name, remote) => {
    const home = path.join(root, name);
    fs.mkdirSync(home);
    writeSyncConfig(path.join(home, 'dsh-sync.json'), {
      remote,
      autoRepo: false,
      workspaceSync: false,
      mode: 'manual',
    });
    const engine = acceptFixturePreviews(attachFixturePersistence(new SyncEngine(home)));
    engine.verifyPrivateRemote = async () => ({ ok: true });
    return engine;
  };
  const write = (engine, rows) => {
    fs.mkdirSync(path.dirname(path.join(engine.home, rel)), { recursive: true });
    fs.writeFileSync(path.join(engine.home, rel), encode(rows));
  };
  const heads = remote =>
    execFileSync('git', ['for-each-ref', '--format=%(refname)', 'refs/heads'], { cwd: remote, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .sort();
  const sync = async engine => {
    const result = await engine.syncOnce('test', { forceCommit: true });
    assert.equal(result.error, undefined, JSON.stringify(result));
    return result;
  };
  return { root, bare, make, write, heads, sync };
}

test(
  'switching both computers to a mirrored repository on another host keeps syncing',
  { timeout: 180_000 },
  async t => {
    const { root, bare, make, write, heads, sync } = setup(t);
    const oldHost = bare('old.git');
    const a = make('a', oldHost),
      b = make('b', oldHost);
    const base = [header, ...Array.from({ length: 4 }, (_, seq) => event(seq, 'base'))];
    write(a, base);
    await sync(a);
    await sync(b);
    assert.equal(fs.readFileSync(path.join(b.home, rel), 'utf8'), encode(base));
    // An extra branch the computers do not download, standing in for backups and archives.
    execFileSync('git', ['branch', 'backup/kept', 'main'], { cwd: oldHost });

    // Server-to-server copy of every branch into an empty repository on the new host.
    const newHost = bare('new.git');
    const copy = path.join(root, 'copy.git');
    execFileSync('git', ['clone', '-q', '--bare', oldHost, copy]);
    execFileSync('git', ['push', '-q', newHost, 'refs/heads/*:refs/heads/*'], { cwd: copy });
    assert.deepEqual(heads(newHost), heads(oldHost));
    const oldTip = execFileSync('git', ['rev-parse', 'main'], { cwd: oldHost, encoding: 'utf8' });

    writeSyncConfig(a.configPath(), { remote: newHost });
    const appended = [...base, event(4, 'after move on A')];
    write(a, appended);
    await sync(a);
    assert.equal(execFileSync('git', ['rev-parse', 'main'], { cwd: oldHost, encoding: 'utf8' }), oldTip);

    writeSyncConfig(b.configPath(), { remote: newHost });
    await sync(b);
    assert.equal(fs.readFileSync(path.join(b.home, rel), 'utf8'), encode(appended));
    assert.ok(heads(newHost).includes('refs/heads/backup/kept'));
  },
);

test('switching to an empty repository uploads only what this computer has', { timeout: 180_000 }, async t => {
  const { bare, make, write, heads, sync } = setup(t);
  const oldHost = bare('old.git');
  const a = make('a', oldHost);
  const rows = [header, event(0, 'only content')];
  write(a, rows);
  await sync(a);
  execFileSync('git', ['branch', 'backup/kept', 'main'], { cwd: oldHost });
  const oldCommits = execFileSync('git', ['rev-list', '--count', 'main'], { cwd: oldHost, encoding: 'utf8' });

  const newHost = bare('new.git');
  writeSyncConfig(a.configPath(), { remote: newHost });
  await sync(a);
  assert.equal(fs.readFileSync(path.join(a.home, rel), 'utf8'), encode(rows));
  assert.ok(
    execFileSync('git', ['show', 'main:' + rel], { cwd: newHost, encoding: 'utf8' }).includes('only content'),
    'current content reaches the new repository',
  );
  // Branches this computer never downloaded stay behind on the old host.
  assert.ok(!heads(newHost).includes('refs/heads/backup/kept'));
  assert.ok(heads(oldHost).includes('refs/heads/backup/kept'));
  assert.equal(execFileSync('git', ['rev-list', '--count', 'main'], { cwd: oldHost, encoding: 'utf8' }), oldCommits);
});
