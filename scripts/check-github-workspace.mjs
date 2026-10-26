// Real GitHub transport, generated project files, one physical Windows machine.
// Usage: node scripts/check-github-workspace.mjs <dedicated-private-test-repo-url>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SyncEngine } from '../lib/sync.js';
import { parseSyncRemote } from '../lib/remote.js';
import { acceptFixturePreviews } from '../tests/helpers/reviewed-sync.mjs';

const remote = process.argv[2],
  parsed = parseSyncRemote(remote);
assert.ok(
  parsed?.provider === 'github' && /^https:\/\/github\.com\//.test(remote) && /^chatsync-acceptance-/.test(parsed.repo),
  'A dedicated HTTPS GitHub chatsync-acceptance-* test repository is required',
);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-github-workspace-'));
const branch = 'acceptance-workspace-' + randomUUID().slice(0, 8);
const result = {
  physicalMachines: 1,
  realGitHub: true,
  nativeHost: false,
  syntheticDataOnly: true,
  remote,
  branch,
  checks: [],
};
const checkpoint = text => {
  result.checks.push(text);
  console.log(text);
};
try {
  const probe = new SyncEngine(root, { autoRepo: false, remote });
  assert.equal((await probe.ghLogin())?.toLowerCase(), parsed.owner.toLowerCase());
  const view = await probe.gh(['repo', 'view', parsed.fullName, '--json', 'nameWithOwner,visibility,description']);
  assert.equal(probe.ok(view), true);
  const metadata = JSON.parse(view.out);
  assert.equal(metadata.nameWithOwner.toLowerCase(), parsed.fullName.toLowerCase());
  assert.equal(metadata.visibility, 'PRIVATE');
  assert.match(metadata.description || '', /ChatSync synthetic acceptance/);
  assert.equal((await probe.verifyPrivateRemote(remote)).ok, true);
  checkpoint('Production GitHub authorization confirms an owned private acceptance repository');
  const homeA = path.join(root, 'home-a'),
    homeB = path.join(root, 'home-b');
  const baseA = path.join(root, 'projects-a'),
    baseB = path.join(root, 'projects-b');
  const projectA = path.join(baseA, 'example'),
    projectB = path.join(baseB, 'example');
  const workspaceId = randomUUID();
  fs.mkdirSync(path.join(homeA, 'storages'), { recursive: true });
  fs.mkdirSync(homeB, { recursive: true });
  fs.mkdirSync(projectA, { recursive: true });
  fs.writeFileSync(path.join(projectA, 'note.txt'), 'workspace content\n');
  fs.writeFileSync(path.join(homeA, '.credentials.yaml'), 'fixture-only: excluded\n');
  fs.writeFileSync(
    path.join(homeA, 'storages', 'workspace.json'),
    JSON.stringify({ tables: { workspaces: { [workspaceId]: { path: projectA, title: 'example' } } } }),
  );
  const make = (home, workspaceBase) =>
    acceptFixturePreviews(
      new SyncEngine(home, {
        remote,
        branch,
        autoRepo: false,
        workspaceSync: true,
        workspaceBase,
        patches: false,
        mode: 'manual',
        autoRestartAfterRepair: false,
        autoPushOnExit: false,
      }),
    );
  const a = make(homeA, baseA),
    b = make(homeB, baseB);
  const synchronize = async engine => {
    const value = await engine.syncOnce('github-workspace-acceptance', { forceCommit: true });
    assert.equal(value.error, undefined, JSON.stringify(value));
    assert.equal(value.workspaces.errors.length, 0, JSON.stringify(value.workspaces));
    return value;
  };
  assert.equal((await synchronize(a)).workspaces.pushed, 1);
  await synchronize(b);
  assert.equal(fs.readFileSync(path.join(projectB, 'note.txt'), 'utf8'), 'workspace content\n');
  assert.equal(fs.existsSync(path.join(homeB, '.credentials.yaml')), false);
  const credentialTree = await a.git(['ls-tree', '--name-only', 'HEAD', '--', '.credentials.yaml']);
  assert.equal(a.ok(credentialTree), true);
  assert.equal(credentialTree.out.trim(), '');
  checkpoint('A uploads project files; B restores under its own distinct base; local credentials are excluded');

  fs.writeFileSync(path.join(projectA, 'note.txt'), 'edit on A\n');
  fs.writeFileSync(path.join(projectB, 'note.txt'), 'edit on B\n');
  await synchronize(a);
  const conflict = await synchronize(b);
  assert.equal(conflict.workspaces.backups.length, 1);
  assert.equal(conflict.workspaces.backups[0].pushed, true);
  const record = b.recovery.list().find(r => r.kind === 'ws' && r.path === 'note.txt');
  assert.ok(record);
  const preview = b.recoveryPreview(record.id);
  assert.equal(preview.local.text, 'edit on B\n');
  assert.equal(preview.remote.text, 'edit on A\n');
  assert.equal(preview.canRestore, true);
  await synchronize(a);
  assert.equal(fs.readFileSync(path.join(projectA, 'note.txt'), 'utf8'), 'edit on B\n');
  checkpoint('Parallel edits retain both originals and publish a recovery backup on real GitHub');

  fs.writeFileSync(path.join(projectB, 'unrelated.txt'), 'untouched\n');
  const restored = await b.restoreRecovery(record.id, 'remote', preview.currentHash);
  assert.equal(restored.ok, true);
  assert.equal(fs.readFileSync(path.join(projectB, 'unrelated.txt'), 'utf8'), 'untouched\n');
  assert.equal(b.recoveryPreview(restored.backupId).local.text, 'edit on B\n');
  await synchronize(b);
  await synchronize(a);
  assert.equal(fs.readFileSync(path.join(projectA, 'note.txt'), 'utf8'), 'edit on A\n');
  checkpoint('Selected recovery preserves unrelated files and propagates the restored content to A');

  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const unavailableProxy = 'http://127.0.0.1:' + server.address().port;
  await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(projectB, 'pending.txt'), 'retry after connection failure\n');
  b.overrides.proxy = unavailableProxy;
  // Inherited NO_PROXY or Git http.proxy may otherwise bypass the deliberately
  // unavailable test proxy. Force this route only during fault injection; the
  // real Git subprocess must fail, rather than returning a simulated result.
  const transport = b._spawn.bind(b),
    priorNoProxy = b._gitEnv.NO_PROXY,
    priorNoProxyLower = b._gitEnv.no_proxy;
  b._gitEnv.NO_PROXY = '';
  b._gitEnv.no_proxy = '';
  b._spawn = (command, args, ...options) =>
    transport(
      command,
      command === 'git'
        ? ['-c', 'http.proxy=' + unavailableProxy, '-c', 'http.' + remote + '.proxy=' + unavailableProxy, ...args]
        : args,
      ...options,
    );
  let failed;
  try {
    const route = await b.git(['config', '--get-urlmatch', 'http.proxy', remote]);
    assert.equal(b.ok(route), true);
    assert.equal(
      route.out.trim(),
      unavailableProxy,
      'Fault injection must override more-specific inherited proxy settings',
    );
    failed = await b.syncOnce('github-workspace-fault', { forceCommit: true });
  } finally {
    b._spawn = transport;
    delete b.overrides.proxy;
    if (priorNoProxy === undefined) delete b._gitEnv.NO_PROXY;
    else b._gitEnv.NO_PROXY = priorNoProxy;
    if (priorNoProxyLower === undefined) delete b._gitEnv.no_proxy;
    else b._gitEnv.no_proxy = priorNoProxyLower;
  }
  assert.ok(failed.error || failed.workspaces.errors.length, JSON.stringify(failed));
  assert.equal(fs.readFileSync(path.join(projectB, 'pending.txt'), 'utf8'), 'retry after connection failure\n');
  assert.equal(fs.existsSync(path.join(projectA, 'pending.txt')), false);
  await synchronize(b);
  await synchronize(a);
  assert.equal(fs.readFileSync(path.join(projectA, 'pending.txt'), 'utf8'), 'retry after connection failure\n');
  checkpoint('Actual Git connection failure via an unavailable fixture proxy preserves edits; retry transfers them');

  const workspaceBranch = a.workspaceBranchOf(a.loadConfig(), workspaceId);
  const head = await a.rev(workspaceBranch, a.workspaceGitDir(workspaceId), projectA);
  assert.match(head || '', /^[0-9a-f]{40,64}$/);
  const ref = await a.gh([
    'api',
    'repos/' + parsed.fullName + '/git/ref/heads/' + workspaceBranch,
    '--jq',
    '.object.sha',
  ]);
  assert.equal(a.ok(ref), true);
  assert.equal(ref.out.trim(), head);
  result.workspace = { id: workspaceId, branch: workspaceBranch, commit: head, baseA, baseB };
  result.homes = [homeA, homeB];
  checkpoint('GitHub API reads the same workspace commit as the verified local transport');
  fs.writeFileSync(path.join(root, 'acceptance.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: true, evidence: root, branch, workspaceBranch }));
} catch (error) {
  fs.writeFileSync(
    path.join(root, 'acceptance-failed.json'),
    JSON.stringify({ ...result, error: error.message }, null, 2),
  );
  throw error;
} finally {
  console.log('Evidence retained: ' + root);
}
