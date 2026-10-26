import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { redactedSessionSource } from '../lib/privacy-copy.js';
import { parseSessionLog } from '../lib/merge.js';
import { ignoredScopePaths } from '../lib/scope.js';
import { SyncEngine } from '../lib/sync.js';
import { acceptFixturePreviews } from './helpers/reviewed-sync.mjs';

const id = 'session-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const file = 'sessions/project/' + id + '/session.v3.jsonl';
test('redaction preserves the original bytes, sequence and event structure for a separate import', () => {
  const token = 'sk-' + 'T'.repeat(32),
    short = '12345678';
  const original = Buffer.from(
    [
      { type: 'session', data: { id, version: 3, cwd: 'C:/project' } },
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      {
        seq: 1,
        type: 'tool/result',
        data: {
          message: { content: [{ type: 'text', text: 'API_KEY: ' + token + '\nshort key: ' + short }] },
          meta: { raw: token },
        },
      },
      { seq: 2, type: 'turn/end', data: { turn: 1 } },
    ]
      .map(r => JSON.stringify(r))
      .join('\n') + '\n',
  );
  const before = Buffer.from(original);
  const result = redactedSessionSource(file, original, { additionalValues: [short] });
  assert.deepEqual(original, before);
  assert.ok(result.replacements >= 3);
  assert.ok(!result.source.includes(token));
  assert.ok(!result.source.includes(short));
  const decoded = parseSessionLog(result.source);
  assert.equal(decoded.length, 4);
  assert.deepEqual(
    decoded.slice(1).map(r => r.seq),
    [0, 1, 2],
  );
  assert.equal(decoded[2].data.message.content[0].text, 'API_KEY: [已脱敏]\nshort key: [已脱敏]');
});
test('redaction refuses corrupt originals and a source without detected content', () => {
  assert.throws(() => redactedSessionSource(file, Buffer.from('broken')), /原件日志无效/);
  const safe = Buffer.from(JSON.stringify({ type: 'session', data: { id, version: 3, cwd: 'C:/project' } }) + '\n');
  assert.throws(() => redactedSessionSource(file, safe), /未找到/);
});
test('ignore rules protect tracked sessions in a live tree without its own Git repository', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-ignore-source-'));
  t.after(() => removeFixture(root));
  const home = path.join(root, 'home'),
    mirror = path.join(root, 'mirror');
  fs.mkdirSync(home);
  fs.mkdirSync(mirror);
  execFileSync('git', ['init', mirror], { stdio: 'ignore' });
  fs.mkdirSync(path.join(mirror, path.dirname(file)), { recursive: true });
  fs.writeFileSync(path.join(mirror, file), 'remote original');
  execFileSync('git', ['-C', mirror, 'add', '.'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(home, '.gitignore'), 'sessions/*/' + id + '/\n');
  const engine = new SyncEngine(home);
  engine._transport = new SyncEngine(mirror);
  const ignored = await ignoredScopePaths(engine, mirror, [file, 'settings.yaml']);
  assert.deepEqual([...ignored], [file]);
  assert.equal(fs.existsSync(path.join(home, '.git')), false);
  assert.equal(fs.readFileSync(path.join(mirror, file), 'utf8'), 'remote original');
});

test(
  'scoped sync never exports an ignored local secret or imports over its local original',
  { timeout: 60000 },
  async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-ignore-roundtrip-'));
    t.after(() => removeFixture(root));
    const remote = path.join(root, 'remote.git'),
      seed = path.join(root, 'seed'),
      home = path.join(root, 'home');
    const git = (args, cwd) =>
      execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
    git(['init', '--bare', remote]);
    git(['clone', remote, seed]);
    git(['config', 'user.name', 'fixture'], seed);
    git(['config', 'user.email', 'fixture@invalid'], seed);
    fs.writeFileSync(path.join(seed, 'local-only.txt'), 'old remote safe text');
    git(['add', '.'], seed);
    git(['commit', '-m', 'safe baseline'], seed);
    git(['branch', '-M', 'main'], seed);
    git(['push', 'origin', 'main'], seed);
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, '.gitignore'), 'local-only.txt\n');
    const local = Buffer.from('sk-' + 'Z'.repeat(32));
    fs.writeFileSync(path.join(home, 'local-only.txt'), local);
    const engine = acceptFixturePreviews(
      new SyncEngine(home, { remote, branch: 'main', autoRepo: false, workspaceSync: false }),
    );
    engine.verifyPrivateRemote = async () => ({ ok: true });
    const result = await engine.syncOnce('ignore-roundtrip', { forceCommit: true });
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.deepEqual(fs.readFileSync(path.join(home, 'local-only.txt')), local);
    assert.equal(git(['--git-dir=' + remote, 'show', 'main:local-only.txt']), 'old remote safe text');
  },
);
