// Real installed Desktop Host shutdown and production exit worker. Synthetic
// home/local Git only; NODE_OPTIONS replaces private visibility only in fixture.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { profile, bootHost, stopHost, repo } from './native-fixture.mjs';
import { SyncEngine } from '../lib/sync.js';
import { readSyncStatus } from '../lib/session-safety.js';
import { acceptFixturePreviews } from '../tests/helpers/reviewed-sync.mjs';

const installation = path.join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness');
const output =
  process.env.DSH_VALIDATION_OUTPUT ||
  path.join(repo, 'outputs', 'lifecycle-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(output, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (!process.versions.electron) {
  const child = spawn(
    path.join(installation, 'DeepSeek Harness.exe'),
    ['--expose-internals', fileURLToPath(import.meta.url)],
    { windowsHide: true, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
  );
  const timer = setTimeout(() => stopHost(child), 240000);
  const code = await new Promise((r, j) => {
    child.once('exit', r);
    child.once('error', j);
  });
  clearTimeout(timer);
  process.exitCode = code ?? 1;
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-lifecycle-desktop-'));
  const home = path.join(root, 'home'),
    remote = path.join(root, 'remote.git');
  const runtime = path.join(installation, 'resources/app.asar/dsh');
  const dshRoot = path.join(runtime, 'node_modules/@deepseek-ai/dsh');
  const resolver = createRequire(path.join(dshRoot, 'lib/bin.js'));
  const llm = pathToFileURL(resolver.resolve('@deepseek-ai/dsh-llm')).href;
  const profileRoot = profile(home, ['@chatsync/lifecycle-fixture'], 'desktop');
  execFileSync('git', ['init', '--bare', remote], { windowsHide: true, stdio: 'ignore' });
  const bootstrap = path.join(root, 'bootstrap.mjs');
  fs.writeFileSync(
    bootstrap,
    `import {SyncEngine} from ${JSON.stringify(pathToFileURL(path.join(repo, 'lib/sync.js')).href)};
const original=SyncEngine.prototype.verifyPrivateRemote;
SyncEngine.prototype.verifyPrivateRemote=function(remote){return remote===${JSON.stringify(remote)}&&this.home.startsWith(${JSON.stringify(root)})?Promise.resolve({ok:true}):original.call(this,remote);};
`,
  );
  const driver = path.join(profileRoot, 'node_modules/@chatsync/lifecycle-fixture');
  fs.mkdirSync(driver, { recursive: true });
  fs.writeFileSync(
    path.join(driver, 'package.json'),
    JSON.stringify({
      name: '@chatsync/lifecycle-fixture',
      version: '1.0.0',
      type: 'module',
      main: './index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }),
  );
  fs.writeFileSync(
    path.join(driver, 'cordis.patch.yml'),
    '- insert:\n    - id: lifecycle-fixture\n      name: "@chatsync/lifecycle-fixture"\n',
  );
  fs.writeFileSync(
    path.join(driver, 'index.js'),
    `import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createUserMessage} from ${JSON.stringify(llm)};
export const inject=['webServer','sessions','sessionPersistence'];
export function apply(ctx){ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/lifecycle-fixture/create',handler:async(req,res)=>{
try{const session=ctx.sessions.prepare('session-'+randomUUID(),{meta:{cwd:path.join(process.env.DSH_HOME,'project')}});
const writer=await ctx.sessionPersistence.create(session.header);const detach=ctx.sessions.enter(session);ctx.effect(()=>detach);ctx.sessions.announce(session);
session.append('turn/start',{turn:1});session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'synthetic lifecycle message'}]}),{surfaceOp:'append'});session.append('turn/end',{turn:1,reason:{kind:'completed'}});
await ctx.sessions.flush(session);await writer.close();res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,id:session.id}));
}catch(e){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:e.message}));}}}));}
`,
  );
  const cfg = {
    autoRepo: false,
    remote,
    workspaceSync: false,
    autoRestartAfterRepair: false,
    patches: false,
    contentScope: { sessions: true, attachments: false, settings: false },
    enabled: false,
    autoPullOnStart: false,
    autoPushOnExit: false,
  };
  const write = () => fs.writeFileSync(path.join(home, 'dsh-sync.json'), JSON.stringify(cfg));
  write();
  const original = SyncEngine.prototype.verifyPrivateRemote;
  SyncEngine.prototype.verifyPrivateRemote = function (value) {
    return value === remote && this.home.startsWith(root) ? Promise.resolve({ ok: true }) : original.call(this, value);
  };
  const boot = () =>
    bootHost(dshRoot, home, '/dsh-sync/api/status', {
      desktopRuntime: runtime,
      env: {
        HOME: path.join(root, 'user'),
        USERPROFILE: path.join(root, 'user'),
        NODE_OPTIONS: '--import=' + pathToFileURL(bootstrap).href,
      },
    });
  let host;
  const close = async () => {
    const current = host;
    let complete = false;
    current.child.on('message', m => {
      if (m?.type === 'shutdown-complete') complete = true;
    });
    current.child.send({ type: 'shutdown' });
    for (let i = 0; i < 120 && current.child.exitCode === null; i++) await sleep(250);
    fs.appendFileSync(path.join(output, 'lifecycle-host.log'), current.readLog());
    assert.equal(current.child.exitCode, 0, 'Host did not complete a normal shutdown');
    assert.equal(complete, true);
    host = undefined;
  };
  const remoteHead = () => {
    try {
      return execFileSync('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'], {
        windowsHide: true,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return null;
    }
  };
  const awaitExit = async () => {
    for (let i = 0; i < 240; i++) {
      const s = readSyncStatus(home);
      if (s?.source === 'exit') return s;
      await sleep(250);
    }
    throw Error('No completed exit-worker status');
  };
  const evidence = {
    root,
    physicalMachines: 1,
    dshVersion: JSON.parse(fs.readFileSync(path.join(dshRoot, 'package.json'))).version,
    electron: process.versions.electron,
    node: process.versions.node,
    remote: 'local bare Git; fixture-only private-visibility substitution',
    electronWindowOpened: false,
    checks: [],
  };
  try {
    host = await boot();
    const baseline = await host.request('/lifecycle-fixture/create', {});
    assert.equal(baseline.ok, true, JSON.stringify(baseline));
    await close();
    const engine = acceptFixturePreviews(new SyncEngine(home));
    const seed = await engine.syncOnce('fixture-seed', { forceCommit: true, offlineApply: true });
    assert.equal(seed.error, undefined, JSON.stringify(seed));
    const seedHead = remoteHead();
    assert.ok(seedHead);
    Object.assign(cfg, {
      enabled: true,
      autoPullOnStart: true,
      autoPushOnExit: true,
      mode: 'auto',
      intervalSeconds: 30,
      eventDebounceSeconds: 5,
    });
    write();
    host = await boot();
    let ready;
    for (let i = 0; i < 120; i++) {
      ready = await host.request('/dsh-sync/api/status');
      if (ready.startup.phase !== 'running') break;
      await sleep(250);
    }
    assert.equal(ready.startup.phase, 'ready', JSON.stringify(ready.startup));
    evidence.checks.push('Configured real Desktop Host finishes startup sync before use');
    // Startup may legitimately commit ignore-rule maintenance. Editing must be
    // compared with the completed startup, not the earlier seed snapshot.
    const before = remoteHead();
    assert.ok(before);
    evidence.seedCommit = seedHead;
    evidence.startupCommit = before;
    const added = await host.request('/lifecycle-fixture/create', {});
    assert.equal(added.ok, true, JSON.stringify(added));
    // Legacy short interval and debounce values cannot trigger a save.
    await sleep(31000);
    assert.equal(remoteHead(), before);
    const duringEditing = execFileSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main'], {
      windowsHide: true,
      encoding: 'utf8',
    });
    assert.ok(!duringEditing.includes(added.id), 'Editing uploaded the new session before exit');
    evidence.checks.push(
      'Editing for 31 seconds leaves the post-startup commit unchanged and the new session absent remotely despite legacy interval/debounce',
    );
    const at = Date.now();
    await close();
    const status = await awaitExit();
    assert.equal(status.result.error, undefined, JSON.stringify(status));
    assert.equal(status.result.pushed, true, JSON.stringify(status));
    assert.notEqual(remoteHead(), before);
    const listed = execFileSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main'], {
      windowsHide: true,
      encoding: 'utf8',
    });
    assert.ok(listed.includes(added.id), 'New host-written session is absent from remote');
    evidence.exitDurationMs = Date.now() - at;
    evidence.exitStatus = status;
    evidence.remoteCommit = remoteHead();
    evidence.checks.push(
      'Official shutdown IPC → shutdown-complete → Host exit 0 → detached production exit worker uploads host-written session and records success',
    );
    // Failed uploads retain the actual error for the next launch.
    Object.assign(cfg, { autoPullOnStart: false });
    write();
    host = await boot();
    const later = await host.request('/lifecycle-fixture/create', {});
    assert.equal(later.ok, true);
    fs.renameSync(remote, remote + '.unavailable');
    const start = Date.now();
    await close();
    const failure = await awaitExit();
    assert.ok(failure.at >= start, 'Read an earlier exit result');
    assert.ok(failure.result.error, JSON.stringify(failure));
    evidence.failureStatus = failure;
    evidence.checks.push(
      'Unavailable remote after normal close records failure instead of false success; local session remains',
    );
    evidence.ok = true;
    fs.writeFileSync(path.join(output, 'lifecycle-desktop.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ ok: true, root, checks: evidence.checks, exitDurationMs: evidence.exitDurationMs }));
  } catch (e) {
    evidence.ok = false;
    evidence.error = e.message;
    fs.writeFileSync(path.join(output, 'lifecycle-desktop.json'), JSON.stringify(evidence, null, 2));
    console.error(JSON.stringify({ ok: false, root, error: e.message }));
    process.exitCode = 1;
  } finally {
    if (host) stopHost(host.child);
  }
}
