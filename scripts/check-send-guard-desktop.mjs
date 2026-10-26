// Installed Desktop services with synthetic data. No personal sync repository.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { profile, bootHost, stopHost, repo } from './native-fixture.mjs';
const installation = path.join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness');
if (!process.versions.electron) {
  const child = spawn(
    path.join(installation, 'DeepSeek Harness.exe'),
    ['--expose-internals', fileURLToPath(import.meta.url)],
    { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
} else {
  const out = path.join(repo, 'outputs/implicit-startup-20261022'),
    home = path.join(out, 'native-home-' + Date.now());
  const root = profile(home, ['@chatsync/send-fixture'], 'desktop');
  const driver = path.join(root, 'node_modules/@chatsync/send-fixture');
  fs.mkdirSync(driver, { recursive: true });
  fs.writeFileSync(
    path.join(driver, 'package.json'),
    JSON.stringify({
      name: '@chatsync/send-fixture',
      version: '1.0.0',
      type: 'module',
      main: './index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }),
  );
  fs.writeFileSync(
    path.join(driver, 'cordis.patch.yml'),
    '- insert:\n    - id: send-fixture\n      name: "@chatsync/send-fixture"\n',
  );
  const syncURL = pathToFileURL(path.join(root, 'node_modules/@dpskk2/dsh-chatsync/lib/sync.js')).href;
  const id = 'session-11111111-1111-1111-1111-111111111111',
    fresh = 'session-22222222-2222-2222-2222-222222222222';
  fs.writeFileSync(
    path.join(driver, 'index.js'),
    `
import fs from 'node:fs'; import path from 'node:path';
import { SyncEngine } from ${JSON.stringify(syncURL)};
export const inject=['webServer','sessions','sessionPersistence','sessionController'];
export function apply(ctx) {
 let engine, finish, admissions=0;
 SyncEngine.prototype._syncOnce = async function() { engine=this; return await new Promise(resolve=>{finish=resolve;}); };
 ctx.sessionController.prompt = async request => { admissions++; return {accepted:true}; };
 const reply=(res,value)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/fixture/seed',handler:async(req,res)=>{
  const cwd=path.join(process.env.DSH_HOME,'project'); fs.mkdirSync(cwd,{recursive:true});
  const session=ctx.sessions.prepare(${JSON.stringify(id)},{meta:{cwd}});
  const writer=await ctx.sessionPersistence.create(session.header); await writer.flush(); await writer.close(); reply(res,{ok:true});
 }}));
 ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/fixture/check',handler:async(req,res)=>{
  const target=new URL(req.url,'http://fixture').searchParams.get('id');
  try { const value=await ctx.sessionController.prompt({sessionId:target,mode:'queue',content:[{type:'text',text:'synthetic'}]}); reply(res,{ok:true,value,admissions}); }
  catch(error) { reply(res,{ok:false,error:error.message,admissions}); }
 }}));
 ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/fixture/complete',handler:async(req,res)=>{
  try { engine.sendGuard.verify([${JSON.stringify(id)}]); finish({verifiedSessionIds:[${JSON.stringify(id)}]}); reply(res,{ok:true}); }
  catch(error) { reply(res,{ok:false,error:error.stack,engine:!!engine}); }
 }}));
}
`,
  );
  const runtime = path.join(installation, 'resources/app.asar/dsh');
  let host;
  const evidence = {
    checks: [],
    hostKind: 'desktop',
    node: process.versions.node,
    electron: process.versions.electron,
    boundary:
      'Actual Desktop service interception and persistence; startup remains pending; prompt admission stub; release-after-apply is covered by the real Git regression, not this host fixture.',
  };
  try {
    host = await bootHost(null, home, '/dsh-sync/api/status', { desktopRuntime: runtime });
    assert.equal((await host.request('/fixture/seed')).ok, true);
    stopHost(host.child);
    await new Promise(resolve => (host.child.exitCode !== null ? resolve() : host.child.once('exit', resolve)));
    const cfgPath = path.join(home, 'dsh-sync.json'),
      cfg = JSON.parse(fs.readFileSync(cfgPath));
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        ...cfg,
        enabled: true,
        remote: 'https://github.com/example/synthetic-fixture.git',
        autoPullOnStart: true,
      }),
    );
    host = await bootHost(null, home, '/dsh-sync/api/status', { desktopRuntime: runtime });
    assert.equal((await host.request('/dsh-sync/api/startup')).startup.phase, 'running');
    assert.equal((await host.request('/dsh-sync/api/send-check', { sessionId: id })).allowed, false);
    const rejected = await host.request('/fixture/check?id=' + id);
    assert.equal(rejected.ok, false, JSON.stringify(rejected));
    assert.match(rejected.error, /消息未发送/);
    assert.equal(rejected.admissions, 0);
    evidence.checks.push('Real Cordis service blocks unchecked old-session prompt before admission');
    assert.equal((await host.request('/fixture/check?id=' + fresh)).ok, true);
    evidence.checks.push('New session remains usable while startup is running');
    evidence.ok = true;
  } catch (error) {
    evidence.ok = false;
    evidence.error = error.stack;
    if (host) fs.writeFileSync(path.join(out, 'native-host.log'), host.readLog());
    throw error;
  } finally {
    if (host) stopHost(host.child);
    fs.writeFileSync(path.join(out, 'native-send-guard.json'), JSON.stringify(evidence, null, 2));
  }
  console.log(JSON.stringify(evidence));
}
