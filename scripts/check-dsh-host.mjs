// Optional native host smoke test. Usage: node scripts/check-dsh-host.mjs <dsh-package-dir>
// Uses two temporary DSH homes, no user configuration or external sync remote.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dshRoot = path.resolve(process.argv[2]);
const repo = fileURLToPath(new URL('..', import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-native-'));
const children = new Set();
const stop = child => {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
  } else child.kill('SIGTERM');
};
async function boot(home) {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const child = spawn(process.execPath, [path.join(dshRoot, 'lib/bin.js'), 'web', '--no-open', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: home, env: { ...process.env, DSH_HOME: home }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let log = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log += data; });
  const request = async (endpoint, body) => {
    const response = await fetch(`http://127.0.0.1:${port}/dsh-sync/api/${endpoint}`, {
      method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(3000),
    });
    return response.json();
  };
  // A fresh profile may need more than 20 seconds to initialize on Windows.
  for (let i = 0; i < 240; i++) {
    try { const status = await request('status'); if (status.ok) return { child, request, status }; } catch {}
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  fs.writeFileSync(path.join(home, 'smoke-boot.log'), log);
  throw new Error(`Native host failed; inspect ${path.join(home, 'smoke-boot.log')}`);
}
try {
  for (const device of ['a', 'b']) {
    const home = path.join(root, device);
    const profile = path.join(home, 'profiles/web');
    const installed = path.join(profile, 'node_modules/@dpskk2/dsh-chatsync');
    fs.mkdirSync(path.dirname(installed), { recursive: true });
    fs.symlinkSync(repo, installed, process.platform === 'win32' ? 'junction' : 'dir');
    const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
    fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ name: 'chatsync-test-profile', private: true, dependencies: { '@dpskk2/dsh-chatsync': version }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dpskk2/dsh-chatsync'] } } }));
    fs.writeFileSync(path.join(profile, 'cordis.yml'), '[]\n');
    fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), '[]\n');
    fs.writeFileSync(path.join(home, 'dsh-sync.json'), JSON.stringify({ mode: 'manual', autoRepo: false, remote: '', workspaceSync: false, autoPullOnStart: false, autoPushOnExit: false, patches: false }));
    let host = await boot(home);
    assert.equal(host.status.mode, 'manual');
    assert.equal(host.status.restartAvailable, false);
    assert.equal((await host.request('config', { mode: 'auto' })).ok, true);
    assert.equal((await host.request('status')).auto, true);
    stop(host.child);
    host = await boot(home);
    assert.equal(host.status.mode, 'auto');
    assert.equal(host.status.auto, true);
    assert.equal((await host.request('config', { mode: 'manual' })).ok, true);
    stop(host.child);
    console.log(`DSH native host ${device}: mount, config, restart persistence passed`);
  }
} finally {
  for (const child of children) stop(child);
  // Keep temporary evidence for inspection; no user data is copied here.
  console.log(`Native host evidence: ${root}`);
}
