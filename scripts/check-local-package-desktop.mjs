// Exercise the actual packed plugin in an isolated installed Desktop Host.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { profile, bootHost, stopHost, repo } from './native-fixture.mjs';
import { digest } from '../lib/recovery.js';

const [packageArg, outputArg] = process.argv.slice(2);
if (!packageArg || !outputArg || process.argv.length !== 4) throw new Error('Usage: node scripts/check-local-package-desktop.mjs <package.tgz> <new outputs directory>');
const packageFile = path.resolve(packageArg), output = path.resolve(outputArg);
for (const target of [packageFile, output]) if (!target.startsWith(path.join(repo, 'outputs') + path.sep)) throw new Error('Keep package and evidence under outputs/');
const installation = path.join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness');
if (!process.versions.electron) {
  const child = spawn(path.join(installation, 'DeepSeek Harness.exe'), ['--expose-internals', fileURLToPath(import.meta.url), packageFile, output],
    { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  const timeout = setTimeout(() => stopHost(child), 120000);
  child.once('error', error => { console.error(error.message); });
  process.exitCode = await new Promise(resolve => child.once('close', code => resolve(code ?? 1)));
  clearTimeout(timeout);
} else {
  if (fs.existsSync(output)) throw new Error('Use a new evidence directory');
  fs.mkdirSync(output, { recursive: true });
  const home = path.join(output, 'isolated-home'), extraction = path.join(output, 'unpacked');
  fs.mkdirSync(extraction); execFileSync('tar', ['-xf', packageFile, '-C', extraction], { windowsHide: true });
  const packedRoot = path.join(extraction, 'package'), packed = JSON.parse(fs.readFileSync(path.join(packedRoot, 'package.json')));
  const source = JSON.parse(fs.readFileSync(path.join(repo, 'package.json')));
  assert.equal(packed.version, source.version); assert.equal(packed.chatsyncBuild, source.chatsyncBuild);
  let verifiedRuntimeFiles = 0;
  for (const relative of fs.readdirSync(path.join(repo, 'lib'), { recursive: true })) {
    const own = path.join(repo, 'lib', relative); if (!fs.statSync(own).isFile()) continue;
    let expected = fs.readFileSync(own);
    if (packed.name === 'chatsync' && ['client.js', 'updates.js'].includes(relative)) expected = Buffer.from(expected.toString().replaceAll('@dpskk2/dsh-chatsync', 'chatsync').replaceAll('@dpskk2%2Fdsh-chatsync', 'chatsync'));
    assert.deepEqual(fs.readFileSync(path.join(packedRoot, 'lib', relative)), expected, relative); verifiedRuntimeFiles++;
  }
  // The fixture helper generates a source junction; replace only that verified junction.
  const profileRoot = profile(home, [], 'desktop'), sourceLink = path.join(profileRoot, 'node_modules', source.name);
  assert.ok(fs.lstatSync(sourceLink).isSymbolicLink()); fs.rmdirSync(sourceLink);
  const destination = path.join(profileRoot, 'node_modules', packed.name); fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(packedRoot, destination, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(profileRoot, 'package.json')));
  manifest.dependencies = { [packed.name]: packed.version };
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.map(name => name === source.name ? packed.name : name);
  fs.writeFileSync(path.join(profileRoot, 'package.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(home, 'dsh-sync.json'), JSON.stringify({ autoRepo: false, remote: '', workspaceSync: false, patches: false }));
  // Valid native expression, not just a parser fixture. No environment secrets involved.
  fs.writeFileSync(path.join(profileRoot, 'cordis.patch.yml'), '- id: ui-theme\n  config:\n    fontSize: !!js 18 + 1\n');
  const backup = path.join(home, '.chatsync-local/config-history/synthetic.json'); fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.writeFileSync(backup, '{"synthetic":"backup"}'); fs.utimesSync(backup, new Date(0), new Date(0));
  const attachment = path.join(home, 'attachments/synthetic.txt'); fs.mkdirSync(path.dirname(attachment), { recursive: true }); fs.writeFileSync(attachment, 'keep synthetic attachment');
  const oldView = path.join(home, '.chatsync-local/main-views/old-synthetic'), oldTree = path.join(oldView, 'tree');
  const localRemote = path.join(output, 'synthetic-remote.git'); fs.mkdirSync(oldView, { recursive: true });
  const git = (args, cwd = output) => execFileSync('git', args, { cwd, windowsHide: true, stdio: 'pipe' });
  git(['init', '--bare', '-b', 'main', localRemote]); git(['clone', localRemote, oldTree]);
  git(['config', 'user.name', 'Synthetic Fixture'], oldTree); git(['config', 'user.email', 'fixture@example.invalid'], oldTree);
  fs.writeFileSync(path.join(oldTree, 'synthetic.txt'), 'historical synthetic snapshot');
  git(['add', '.'], oldTree); git(['commit', '-m', 'synthetic snapshot'], oldTree); git(['push', '-u', 'origin', 'main'], oldTree);
  const runtime = path.join(installation, 'resources/app.asar/dsh');
  const evidence = { version: packed.version, build: packed.chatsyncBuild, packageName: packed.name, packageSha256: digest(fs.readFileSync(packageFile)),
    verifiedRuntimeFiles, physicalMachines: 1, githubUsed: false, nativeDesktopWindow: false,
    runtime: { electron: process.versions.electron, node: process.versions.node,
      dsh: JSON.parse(fs.readFileSync(path.join(runtime, 'node_modules/@deepseek-ai/dsh/package.json'))).version }, checks: [] };
  let host;
  try {
    host = await bootHost('', home, '/dsh-sync/api/status', { desktopRuntime: runtime, env: { HOME: path.join(output, 'user'), USERPROFILE: path.join(output, 'user') } });
    const status = await host.request('/dsh-sync/api/status');
    assert.equal(status.currentVersion, packed.version); assert.equal(status.buildRevision, packed.chatsyncBuild); assert.equal(status.hostKind, 'desktop');
    assert.equal(status.autoConfigured, true); assert.equal(status.startup.required, false);
    evidence.checks.push('Actual candidate package loaded through Desktop IPC; native expression accepted; fresh configuration enables automation without creating a remote');
    assert.equal((await host.request('/dsh-sync/api/local-storage/policy', { retentionDays: 0 })).ok, true);
    const repositoryScan = await host.request('/dsh-sync/api/local-storage/scan'); assert.equal(repositoryScan.ok, true);
    const oldItem = repositoryScan.items.find(row => row.path === oldView); assert.equal(oldItem.protected, false, JSON.stringify(repositoryScan));
    const oldPreview = await host.request('/dsh-sync/api/local-storage/preview', { ids: [oldItem.id] }); assert.equal(oldPreview.ok, true);
    assert.equal((await host.request('/dsh-sync/api/local-storage/apply', { token: oldPreview.token, confirm: true })).ok, false);
    const oldApplied = await host.request('/dsh-sync/api/local-storage/apply', { token: oldPreview.token, confirm: true, confirmSeparate: true });
    assert.equal(oldApplied.ok, true, JSON.stringify(oldApplied)); assert.equal(fs.existsSync(oldView), false);
    git(['--git-dir', localRemote, 'fsck', '--full']);
    evidence.checks.push('Public API removes only separately confirmed obsolete synthetic Git view, including readonly objects; original bare repository passes fsck');
    const scan = await host.request('/dsh-sync/api/local-storage/scan'); assert.equal(scan.ok, true);
    const item = scan.items.find(row => row.path === backup); assert.equal(item.protected, false, JSON.stringify(scan));
    const preview = await host.request('/dsh-sync/api/local-storage/preview', { ids: [item.id] }); assert.equal(preview.ok, true);
    assert.equal((await host.request('/dsh-sync/api/local-storage/apply', { token: preview.token })).ok, false);
    assert.equal(fs.existsSync(backup), true);
    const applied = await host.request('/dsh-sync/api/local-storage/apply', { token: preview.token, confirm: true }); assert.equal(applied.ok, true);
    assert.equal(fs.existsSync(backup), false); assert.equal(fs.readFileSync(attachment, 'utf8'), 'keep synthetic attachment');
    evidence.checks.push('Public storage API classifies synthetic backup, previews exact deletion, refuses missing confirmation and removes only selected bytes');
    assert.equal((await host.request('/dsh-sync/api/local-storage/policy', { retentionDays: 90 })).ok, true);
    fs.writeFileSync(path.join(output, 'host-first.log'), host.readLog()); stopHost(host.child); host = undefined;
    host = await bootHost('', home, '/dsh-sync/api/status', { desktopRuntime: runtime, env: { HOME: path.join(output, 'user'), USERPROFILE: path.join(output, 'user') } });
    assert.equal((await host.request('/dsh-sync/api/local-storage/scan')).policy.retentionDays, 90);
    assert.equal((await host.request('/dsh-sync/api/status')).currentVersion, source.version);
    evidence.checks.push('Cold restart reads the candidate version and saved retention policy; synthetic attachment remains intact');
    fs.writeFileSync(path.join(output, 'host-restarted.log'), host.readLog());
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ok: true, ...evidence }, null, 2));
    console.log(JSON.stringify({ ok: true, output, ...evidence }, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ok: false, ...evidence, error: error.message, stack: error.stack }, null, 2));
    console.error(error); process.exitCode = 1;
  } finally { if (host) stopHost(host.child); }
}
