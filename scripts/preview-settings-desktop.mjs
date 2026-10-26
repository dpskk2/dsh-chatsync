// Isolated installed Desktop Host with the current source and genuine first-run defaults.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { profile, bootHost, stopHost, repo } from './native-fixture.mjs';

const installation = path.join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness');
const output = path.join(repo, 'outputs/settings-ui-20261022');
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
  process.on('SIGINT', () => stopHost(child));
  process.exitCode = await new Promise(resolve => child.on('exit', resolve));
} else {
  const home = path.join(output, 'fresh-desktop-home-' + Date.now());
  if (fs.existsSync(home))
    throw new Error('Preview home already exists; preserve it and choose a new output directory.');
  profile(home, [], 'desktop');
  fs.unlinkSync(path.join(home, 'dsh-sync.json')); // The fixture helper's overrides must not mask DEFAULT_CONFIG.
  const runtime = path.join(installation, 'resources/app.asar/dsh');
  const host = await bootHost('', home, '/dsh-sync/api/status', { desktopRuntime: runtime });
  const evidence = {
    url: host.url,
    openUrl: host.openUrl,
    home,
    hostPid: host.child.pid,
    status: await host.request('/dsh-sync/api/status'),
    config: await host.request('/dsh-sync/api/config'),
  };
  fs.writeFileSync(path.join(output, 'fresh-desktop.json'), JSON.stringify(evidence, null, 2));
  console.log(
    JSON.stringify({ url: host.url, home, hostKind: evidence.status.hostKind, build: evidence.status.buildRevision }),
  );
  const shutdown = () => {
    fs.writeFileSync(path.join(output, 'desktop-host.log'), host.readLog());
    stopHost(host.child);
    process.exit();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  host.child.on('exit', () => process.exit());
}
