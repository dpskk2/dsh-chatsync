import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { hostFileLimit, oversizedNewFiles } from '../lib/host-limits.js';
import { SyncEngine } from '../lib/sync.js';
import { removeFixture } from './helpers/fixture-cleanup.mjs';

test('only documented per-file limits are applied', () => {
  assert.deepEqual(hostFileLimit('https://github.com/a/dsh-sync.git'), {
    bytes: 100 * 1024 * 1024,
    label: 'GitHub 100 MB',
  });
  assert.equal(hostFileLimit('https://gitee.com/a/b.git'), null);
  assert.equal(hostFileLimit(''), null);
});

test('only new files over the limit are left out; shared files and session logs always go', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-host-limit-'));
  t.after(() => removeFixture(home));
  const put = (file, bytes) => {
    fs.mkdirSync(path.dirname(path.join(home, file)), { recursive: true });
    fs.writeFileSync(path.join(home, file), Buffer.alloc(bytes));
  };
  put('attachments/new-big.bin', 20);
  put('attachments/shared-big.bin', 20);
  put('attachments/small.bin', 5);
  put('sessions/p/s-1/log.jsonl', 20);
  const names = [
    'attachments/new-big.bin',
    'attachments/shared-big.bin',
    'attachments/small.bin',
    'sessions/p/s-1/log.jsonl',
  ];
  const skipped = oversizedNewFiles(home, names, new Set(['attachments/shared-big.bin']), { bytes: 10 });
  assert.deepEqual(skipped, [{ file: 'attachments/new-big.bin', size: 20 }]);
  assert.deepEqual(oversizedNewFiles(home, names, new Set(), null), []);
});

test(
  'a new project file over the GitHub limit stays local while the rest is committed',
  { timeout: 60000 },
  async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-host-limit-ws-'));
    t.after(() => removeFixture(root));
    const home = path.join(root, 'home'),
      project = path.join(root, 'project'),
      remote = path.join(root, 'remote.git');
    fs.mkdirSync(home);
    fs.mkdirSync(project);
    execFileSync('git', ['init', '--quiet', '--bare', remote]);
    const engine = new SyncEngine(home, { remote, autoRepo: false });
    const ws = { id: 'limit', title: 'Limit project', path: project };
    engine.workspaces = () => [ws];
    await engine.ensureWorkspaceMirror(ws.id, project, engine.loadConfig());
    const gitdir = engine.workspaceGitDir(ws.id);
    fs.writeFileSync(path.join(project, 'note.txt'), 'small\n');
    // A sparse file: over 100 MB on paper, nothing on disk.
    const big = path.join(project, 'video.mp4');
    fs.closeSync(fs.openSync(big, 'w'));
    fs.truncateSync(big, 100 * 1024 * 1024 + 1);
    engine._skippedLarge = [];
    const cfg = { ...engine.loadConfig(), remote: 'https://github.com/a/b.git' };
    assert.equal(await engine.commitWorkspaceIfDirty(gitdir, project, cfg, true), 'committed');
    const tree = execFileSync('git', ['--git-dir=' + gitdir, 'ls-tree', '--name-only', 'HEAD'], { encoding: 'utf8' });
    assert.deepEqual(tree.trim().split('\n'), ['note.txt']);
    assert.deepEqual(engine._skippedLarge, [
      { file: 'project/video.mp4', size: 100 * 1024 * 1024 + 1, limit: 'GitHub 100 MB' },
    ]);
    assert.equal(fs.statSync(big).size, 100 * 1024 * 1024 + 1);
    // Only that file changed: nothing to commit, and still nothing uploaded for it.
    fs.rmSync(path.join(project, 'note.txt'));
    execFileSync('git', ['--git-dir=' + gitdir, '--work-tree=' + project, 'rm', '--quiet', '--cached', 'note.txt']);
    execFileSync('git', ['--git-dir=' + gitdir, '--work-tree=' + project, 'commit', '--quiet', '-m', 'drop note'], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'f',
        GIT_AUTHOR_EMAIL: 'f@x',
        GIT_COMMITTER_NAME: 'f',
        GIT_COMMITTER_EMAIL: 'f@x',
      },
    });
    assert.equal(await engine.commitWorkspaceIfDirty(gitdir, project, cfg, true), 'clean');
  },
);
