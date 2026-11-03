import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeGitFailure, pushFailure } from '../lib/git-failure.js';
import { syncIssues } from '../lib/diagnostics.js';
import { SyncEngine } from '../lib/sync.js';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-git-failure-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return new SyncEngine(home, { autoRepo: false, workspaceSync: false });
}

test('a transfer that keeps reporting progress outlives its no-progress timeout', { timeout: 15000 }, async t => {
  const engine = fixture(t);
  // Reports progress every 200 ms for 1.5 s, three times longer than the 500 ms limit.
  const code =
    'let n=0;const t=setInterval(()=>{process.stderr.write("Writing objects "+(++n)+" ");if(n===8){clearInterval(t);}},200);';
  const chunks = [];
  const result = await engine._spawn(process.execPath, ['-e', code], 500, { onProgress: d => chunks.push(d) });
  assert.equal(result.timedOut, undefined);
  assert.equal(result.code, 0);
  assert.ok(chunks.length > 0);
});

test(
  'a transfer that stops reporting progress is stopped and says how long it stalled',
  { timeout: 15000 },
  async t => {
    const engine = fixture(t);
    const code = 'process.stderr.write("Writing objects 1 ");setInterval(()=>{},1000);';
    const result = await engine._spawn(process.execPath, ['-e', code], 500, { onProgress: () => {} });
    assert.equal(result.timedOut, true);
    assert.equal(result.stalledMs, 500);
    const failure = describeGitFailure(result, 'push');
    assert.equal(failure.kind, 'stalled');
    assert.equal(failure.retry, false);
    assert.equal(failure.reason, '上传 1 分钟无进展，已停止');
    assert.match(failure.action, /代理/);
  },
);

test('commands without progress keep a plain wall-clock timeout', { timeout: 15000 }, async t => {
  const engine = fixture(t);
  const code = 'setInterval(()=>process.stderr.write("x"),100);';
  const result = await engine._spawn(process.execPath, ['-e', code], 500);
  assert.equal(result.timedOut, true);
  assert.equal(result.stalledMs, undefined);
});

test('git failures are classified into categories with a next step', () => {
  const cases = [
    ["fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com", 'network', true],
    ["fatal: unable to access 'https://github.com/a/b.git/': Failed to connect to 127.0.0.1 port 7890", 'proxy', true],
    ['error: RPC failed; HTTP 413 curl 22 The requested URL returned error: 413', 'request-too-large', false],
    [
      "remote: error: File sessions/x/log.jsonl is 120.00 MB; this exceeds GitHub's file size limit of 100.00 MB\nremote: error: GH001: Large files detected.",
      'too-large',
      false,
    ],
    [' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs', 'rejected', false],
    [
      'remote: Permission to a/b.git denied to c.\nfatal: unable to access: The requested URL returned error: 403',
      'auth',
      false,
    ],
    ["remote: Repository not found.\nfatal: repository 'https://github.com/a/b.git/' not found", 'not-found', false],
    [' ! [remote rejected] main -> main (protected branch hook declined)', 'protected', false],
    ['fatal: write error: No space left on device', 'disk', false],
    ['fatal: something new', 'other', true],
  ];
  for (const [err, kind, retry] of cases) {
    const failure = describeGitFailure({ code: 128, err }, 'push');
    assert.equal(failure.kind, kind, err);
    assert.equal(failure.retry, retry, err);
    assert.ok(failure.title && failure.reason && failure.action, err);
  }
  assert.equal(describeGitFailure({ code: -1, err: 'spawn git ENOENT' }, 'push').kind, 'git-missing');
  assert.equal(describeGitFailure({ code: null, timedOut: true, err: '' }, 'push').kind, 'too-slow');
});

test('git detail drops progress lines and hides credentials', () => {
  const failure = describeGitFailure(
    {
      code: 128,
      err:
        'Enumerating objects: 279, done.\nWriting objects:  53% (148/279), 51.73 MiB | 285.00 KiB/s\r' +
        "fatal: unable to access 'https://user:ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/a/b.git/': Recv failure: Connection was reset",
    },
    'push',
  );
  assert.equal(failure.kind, 'network');
  assert.equal(failure.detail.length, 1);
  assert.doesNotMatch(failure.detail[0], /ghp_|user:/);
});

test('sync issues show the category and reason instead of a bare "push"', () => {
  const result = {
    committed: true,
    pushed: false,
    ...pushFailure({ code: null, timedOut: true, stalledMs: 180000, err: 'Writing objects: 53%' }),
  };
  const [issue] = syncIssues(result);
  assert.equal(issue.code, 'SYNC_PUSH_STALLED');
  assert.equal(issue.category, '传输停滞');
  assert.equal(issue.reason, '上传 3 分钟无进展，已停止');
  assert.notEqual(issue.reason, 'push');
  // Pauses for review or privacy are not Git failures and keep their own messages.
  assert.deepEqual(pushFailure({ code: 1, err: '同步已暂停，等待确认预览', paused: true }), { error: 'push' });
});
