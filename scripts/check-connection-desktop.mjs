// Isolated Desktop API acceptance. GitHub requests only inspect an existing repository.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { profile, bootHost, stopHost, repo } from './native-fixture.mjs';
import { parseSyncRemote } from '../lib/remote.js';

const installation = path.join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness');
if (!process.versions.electron) {
  const child = spawn(path.join(installation, 'DeepSeek Harness.exe'), ['--expose-internals', fileURLToPath(import.meta.url)],
    { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exitCode = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
} else {
  const output = path.join(repo, 'outputs/backup-connection-20261023');
  fs.mkdirSync(output, { recursive: true });
  const home = path.join(output, 'native-home-' + Date.now());
  const personalConfig = path.join(process.env.USERPROFILE, '.dsh/dsh-sync.json');
  const before = fs.readFileSync(personalConfig);
  const { remote } = JSON.parse(before.toString('utf8').replace(/^\uFEFF/, ''));
  assert.ok(remote, 'Read-only proof requires an existing configured private repository');
  profile(home, [], 'desktop');
  const isolatedConfig = path.join(home, 'dsh-sync.json');
  fs.writeFileSync(isolatedConfig, JSON.stringify({ ...JSON.parse(fs.readFileSync(isolatedConfig)), enabled: false, lifecycleAutomation: 1 }));
  let host;
  const proof = { complete: false, isolated: true, repositoryCreated: false, syncRun: false, checks: [] };
  try {
    host = await bootHost('', home, '/dsh-sync/api/status', { desktopRuntime: path.join(installation, 'resources/app.asar/dsh') });
    const status = await host.request('/dsh-sync/api/status');
    assert.equal(status.hostKind, 'desktop');
    proof.buildRevision = status.buildRevision;
    const saved = await host.request('/dsh-sync/api/connection', { remote, expectedRemote: '' });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(saved.config.remote, remote); assert.equal(saved.config.autoRepo, false);
    proof.checks.push('Real Desktop connection endpoint verifies existing PRIVATE repository and write permission via GitHub');
    const configBeforeFailure = fs.readFileSync(path.join(home, 'dsh-sync.json'));
    const missing = await host.request('/dsh-sync/api/connection', {
      remote: 'https://github.com/' + parseSyncRemote(remote).owner + '/chatsync-missing-connection-' + Date.now() + '.git', expectedRemote: remote,
    });
    assert.equal(missing.ok, false); assert.match(missing.error, /无法访问/);
    assert.deepEqual(fs.readFileSync(path.join(home, 'dsh-sync.json')), configBeforeFailure);
    proof.checks.push('Unavailable repository rejected without changing configuration or creating a repository');
    const defaults = await host.request('/dsh-sync/api/connection', { remote: '', expectedRemote: remote });
    assert.equal(defaults.ok, true, JSON.stringify(defaults));
    assert.equal(defaults.config.remote, ''); assert.equal(defaults.config.autoRepo, true);
    assert.equal((await host.request('/dsh-sync/api/config')).config.automatic, false);
    assert.equal(fs.existsSync(path.join(home, '.git')), false);
    proof.checks.push('Blank enables default setup without starting synchronization or initializing a Git repository');
    assert.deepEqual(fs.readFileSync(personalConfig), before);
    proof.personalConfigSha256 = createHash('sha256').update(before).digest('hex');
    proof.personalConfigurationUnchanged = true;
    proof.complete = true;
  } catch (error) { proof.error = error.stack; process.exitCode = 1; }
  finally {
    if (host) { fs.writeFileSync(path.join(output, 'native-host.log'), host.readLog()); stopHost(host.child); }
    fs.writeFileSync(path.join(output, 'native-proof.json'), JSON.stringify(proof, null, 2));
  }
  console.log(JSON.stringify(proof, null, 2));
}
