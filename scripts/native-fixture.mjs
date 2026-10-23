// Optional real DSH fixture. All process/data changes stay in its named temp root.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const repo = fileURLToPath(new URL('..', import.meta.url));
export function profile(home, extraBundles = [], kind = 'web') {
  if (!['web', 'desktop'].includes(kind)) throw new Error('Unknown isolated profile kind');
  const root = path.join(home, 'profiles', kind);
  const link = path.join(root, 'node_modules/@dpskk2/dsh-chatsync');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(repo, link, process.platform === 'win32' ? 'junction' : 'dir');
  const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'chatsync-isolated-test', private: true,
    dependencies: { '@dpskk2/dsh-chatsync': version }, dsh: { profile: { bundles:
      ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...extraBundles, '@dpskk2/dsh-chatsync'] } } }));
  for (const file of ['cordis.yml', 'cordis.patch.yml']) fs.writeFileSync(path.join(root, file), '[]\n');
  fs.writeFileSync(path.join(home, 'dsh-sync.json'), JSON.stringify({ mode: 'manual', autoRepo: false, remote: '',
    workspaceSync: false, autoRestartAfterRepair: false, autoPullOnStart: false, autoPushOnExit: false, patches: false }));
  return root;
}
export function stopHost(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
  } else child.kill('SIGTERM');
}
export async function bootHost(dshRoot, home, readyEndpoint = '/dsh-sync/api/status', options = {}) {
  if (options.desktopRuntime) return bootDesktopHost(options.desktopRuntime, home, readyEndpoint, options);
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const child = spawn(process.execPath, [path.join(dshRoot, 'lib/bin.js'), 'web', '--no-open', '--host', '127.0.0.1', '--port', String(port)],
    { cwd: home, env: { ...process.env, ...options.env, DSH_HOME: home }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log += chunk; });
  const url = `http://127.0.0.1:${port}`;
  const request = async (endpoint, body) => {
    const response = await fetch(url + endpoint, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    const bodyText = await response.text();
    try { return JSON.parse(bodyText); }
    catch { throw new Error(endpoint + ' returned HTTP ' + response.status + ' with non-JSON response'); }
  };
  for (let i = 0; i < 240; i++) {
    try { const status = await request(readyEndpoint); if (status.ok) return { child, url, request, home, readLog: () => log }; } catch {}
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  fs.writeFileSync(path.join(home, 'boot.log'), log);
  stopHost(child);
  throw new Error('Isolated host failed; inspect ' + path.join(home, 'boot.log'));
}

// Uses the installed Desktop Host entry and its IPC handshake, without launching
// the Electron window or touching the user's daily profile. Run from Electron's
// Node mode when runtimeDir is inside app.asar.
async function bootDesktopHost(runtimeDir, home, readyEndpoint, options) {
  if (!process.versions.electron) throw new Error('Desktop ASAR acceptance requires the bundled Electron Node runtime');
  const entry = path.join(runtimeDir, 'node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js');
  const supportDir = path.basename(path.dirname(runtimeDir)) === 'app.asar'
    ? path.join(path.dirname(path.dirname(runtimeDir)), 'runtime') : path.join(path.dirname(runtimeDir), 'runtime');
  const child = spawn(process.execPath, ['--expose-internals', entry, runtimeDir, path.join(home, 'profiles/desktop'),
    path.join(supportDir, 'primary-runtime')], {
    cwd: home, env: { ...process.env, ...options.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let log = '', ready, fatal;
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log += chunk; });
  child.on('message', message => {
    if (message?.type === 'ready') ready = message;
    if (message?.type === 'fatal') fatal = message.message;
  });
  child.on('error', error => { fatal = error.message; });
  for (let i = 0; i < 240 && !ready && !fatal && child.exitCode === null; i++) await new Promise(resolve => setTimeout(resolve, 250));
  if (ready) {
    const authenticated = new URL(ready.url);
    if (authenticated.hostname !== '127.0.0.1' || authenticated.protocol !== 'http:') {
      stopHost(child); throw new Error('Desktop Host reported an unexpected endpoint');
    }
    const url = authenticated.origin;
    const request = async (endpoint, body) => {
      const response = await fetch(url + endpoint, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90000) });
      const text = await response.text();
      try { return JSON.parse(text); } catch { throw new Error(endpoint + ' returned HTTP ' + response.status + ' with non-JSON response'); }
    };
    try {
      const status = await request(readyEndpoint);
      if (status.ok) return { child, url, openUrl: ready.url, request, home, readLog: () => log, kind: 'desktop' };
    } catch (error) { fatal = error.message; }
  }
  fs.writeFileSync(path.join(home, 'boot.log'), log + '\n' + (fatal || 'Desktop IPC readiness timed out'));
  stopHost(child);
  throw new Error('Isolated Desktop Host failed; inspect ' + path.join(home, 'boot.log'));
}
