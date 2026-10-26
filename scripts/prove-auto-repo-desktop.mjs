// Real GitHub proof: two isolated Desktop Hosts, only synthetic content, no personal sync repo.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { profile, bootHost, stopHost, repo } from './native-fixture.mjs';
import { SyncEngine } from '../lib/sync.js';

const installation = path.join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness');
const output = path.join(repo, 'outputs/settings-ui-20261022/github-proof');
fs.mkdirSync(output, { recursive: true });
if (!process.versions.electron) {
  const child = spawn(
    path.join(installation, 'DeepSeek Harness.exe'),
    ['--expose-internals', fileURLToPath(import.meta.url)],
    {
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
    },
  );
  process.exitCode = await new Promise(resolve => child.on('exit', resolve));
} else {
  const proof = {
    complete: false,
    physicalMachines: 1,
    hostKind: 'desktop',
    node: process.versions.node,
    syntheticOnly: true,
    defaultBranch: 'main',
    checks: [],
    runs: [],
  };
  const id = randomUUID().slice(0, 8),
    repoName = 'chatsync-acceptance-auto-20261022-' + id;
  const homes = ['a', 'b'].map(name => path.join(output, id, name));
  const probe = new SyncEngine(path.join(output, id, 'probe'), { autoRepo: false });
  let host;
  const save = () => fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(proof, null, 2));
  const gh = async args => {
    const r = await probe.gh(args);
    assert.equal(r.code, 0, r.err);
    return JSON.parse(r.out);
  };
  const missing = async full => {
    const r = await probe.gh(['repo', 'view', full, '--json', 'visibility']);
    assert.notEqual(r.code, 0, 'dedicated proof repository must not preexist');
    assert.match(r.err, /not found|could not resolve|404/i);
  };
  try {
    const owner = await probe.ghLogin();
    assert.ok(owner, 'GitHub CLI must already be authorized');
    const full = owner + '/' + repoName;
    proof.repository = full;
    proof.url = 'https://github.com/' + full;
    await missing(full);
    proof.checks.push('Dedicated repository absent before setup');
    for (const home of homes) {
      profile(home, [], 'desktop');
      fs.writeFileSync(path.join(home, 'dsh-sync.json'), JSON.stringify({ repoName }));
    }
    const text = 'ChatSync synthetic automatic repository proof, 2026-10-22, ' + id + '\n';
    fs.mkdirSync(path.join(homes[0], 'attachments'), { recursive: true });
    fs.writeFileSync(path.join(homes[0], 'attachments/chatsync-proof.txt'), text);
    proof.expectedSha256 = createHash('sha256').update(text).digest('hex');
    const boot = home =>
      bootHost('', home, '/dsh-sync/api/status', { desktopRuntime: path.join(installation, 'resources/app.asar/dsh') });
    const sync = async label => {
      let approval;
      for (let i = 0; i < 12; i++) {
        const r = await host.request('/dsh-sync/api/run', approval ? { approval } : {});
        proof.runs.push({ label, attempt: i + 1, response: r });
        save();
        if (r.detail?.needsReview) {
          assert.ok(r.detail.review?.id);
          approval = r.detail.review.id;
          continue;
        }
        assert.equal(r.ok, true, JSON.stringify(r));
        return r;
      }
      throw new Error('Synthetic review did not stabilize');
    };
    host = await boot(homes[0]);
    proof.desktopA = await host.request('/dsh-sync/api/status');
    assert.equal(proof.desktopA.hostKind, 'desktop');
    const initial = await host.request('/dsh-sync/api/config');
    assert.equal(initial.config.remote, '');
    assert.equal(initial.config.autoRepo, true);
    assert.equal(initial.config.automatic, false);
    const saved = await host.request('/dsh-sync/api/config', { remote: '', autoRepo: true });
    assert.equal(saved.ok, true);
    await missing(full);
    proof.checks.push('Real config Save succeeds without creating a repository');
    save();
    await sync('A first synchronization');
    const meta = await gh(['repo', 'view', full, '--json', 'nameWithOwner,visibility,url,defaultBranchRef']);
    assert.equal(meta.visibility, 'PRIVATE');
    assert.equal(meta.defaultBranchRef.name, 'main');
    proof.metadata = meta;
    assert.equal((await host.request('/dsh-sync/api/config')).config.remote, 'https://github.com/' + full + '.git');
    const remoteFile = await gh(['api', 'repos/' + full + '/contents/attachments/chatsync-proof.txt?ref=main']);
    assert.equal(Buffer.from(remoteFile.content, 'base64').toString(), text);
    proof.checks.push(
      'First sync created a PRIVATE GitHub repository, stored its address and uploaded the exact synthetic text',
    );
    fs.writeFileSync(path.join(output, 'desktop-a.log'), host.readLog());
    stopHost(host.child);
    host = undefined;
    host = await boot(homes[1]);
    proof.desktopB = await host.request('/dsh-sync/api/status');
    assert.equal(proof.desktopB.remote, '');
    assert.equal(proof.desktopB.hostKind, 'desktop');
    await sync('B reuses repository and downloads');
    const actual = fs.readFileSync(path.join(homes[1], 'attachments/chatsync-proof.txt'));
    assert.equal(createHash('sha256').update(actual).digest('hex'), proof.expectedSha256);
    assert.equal((await host.request('/dsh-sync/api/config')).config.remote, 'https://github.com/' + full + '.git');
    proof.checks.push(
      'Second isolated Desktop Host kept address empty, reused the same private repository and downloaded identical bytes',
    );
    const final = await gh(['repo', 'view', full, '--json', 'visibility,defaultBranchRef']);
    assert.equal(final.visibility, 'PRIVATE');
    proof.complete = true;
    save();
    console.log(JSON.stringify({ complete: true, url: proof.url, sha256: proof.expectedSha256, checks: proof.checks }));
  } catch (error) {
    proof.error = error.stack;
    save();
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (host) {
      fs.writeFileSync(path.join(output, 'desktop-b.log'), host.readLog());
      stopHost(host.child);
    }
  }
}
