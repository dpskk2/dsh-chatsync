// Actual installed Desktop Host, isolated profiles, synthetic data, no Electron UI.
// Usage: node scripts/check-dsh-desktop.mjs [Desktop installation directory] [--github-real <dedicated-test-repo-url>]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { profile, bootHost, stopHost, repo } from './native-fixture.mjs';
import { SyncEngine } from '../lib/sync.js';
import { digest } from '../lib/recovery.js';
import { assertDshClosed } from '../lib/session-repair.js';
import { parseSyncRemote } from '../lib/remote.js';
import { scopeMirrorPath } from '../lib/scope.js';
import { acceptFixturePreviews } from '../tests/helpers/reviewed-sync.mjs';

if (process.platform !== 'win32') throw new Error('This acceptance requires Windows and an installed Desktop runtime');
const args = process.argv.slice(2);
const installation = path.resolve(args[0] && !args[0].startsWith('--') ? args.shift() : path.join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness'));
if (args.length && (args.length !== 2 || args[0] !== '--github-real')) throw new Error('Unknown Desktop acceptance arguments');
const githubRemote = args[0] === '--github-real' ? args[1] : null;
const githubRepository = githubRemote && parseSyncRemote(githubRemote);
if (githubRemote && (!githubRepository || githubRepository.provider !== 'github'
    || !githubRemote.startsWith('https://github.com/') || !/^chatsync-acceptance-/.test(githubRepository.repo))) {
  throw new Error('--github-real requires a dedicated HTTPS GitHub chatsync-acceptance-* repository');
}
if (!process.versions.electron) {
  const child = spawn(path.join(installation, 'DeepSeek Harness.exe'), ['--expose-internals', fileURLToPath(import.meta.url), installation, ...args],
    { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  // Only this invocation's owned process tree is stopped on timeout or interruption.
  const timeout = setTimeout(() => { stopHost(child); process.exitCode = 1; }, 8 * 60 * 1000);
  process.once('SIGINT', () => { stopHost(child); process.exitCode = 1; });
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  clearTimeout(timeout); process.exitCode = code ?? 1;
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-desktop-native-'));
  const runtimeDir = path.join(installation, 'resources/app.asar/dsh');
  const dshRoot = path.join(runtimeDir, 'node_modules/@deepseek-ai/dsh');
  const resolver = createRequire(path.join(dshRoot, 'lib/bin.js'));
  const moduleURL = name => pathToFileURL(resolver.resolve(name)).href;
  const evidence = { physicalMachines: 1, hostKind: 'desktop', electronVersion: process.versions.electron,
    nodeVersion: process.versions.node, dshVersion: JSON.parse(fs.readFileSync(path.join(dshRoot, 'package.json'), 'utf8')).version,
    remote: githubRemote || 'local bare Git; private-repository validator substituted only in acceptance',
    concurrentHosts: false, electronWindowOpened: false, checks: [] };
  let host;
  const homes = ['a', 'b'].map(name => path.join(root, name));
  try {
    const remote = githubRemote || path.join(root, 'remote.git');
    const branch = githubRemote ? 'acceptance-desktop-' + randomUUID().slice(0, 12) : 'main';
    if (!githubRemote) execFileSync('git', ['init', '--bare', remote], { windowsHide: true, stdio: 'ignore' });
    else {
      const probe = new SyncEngine(root, { remote, autoRepo: false });
      assert.equal((await probe.ghLogin())?.toLowerCase(), githubRepository.owner.toLowerCase());
      const response = await probe.gh(['repo','view',githubRepository.fullName,'--json','nameWithOwner,visibility,description']);
      assert.equal(probe.ok(response), true);
      const metadata = JSON.parse(response.out);
      assert.equal(metadata.nameWithOwner.toLowerCase(), githubRepository.fullName.toLowerCase());
      assert.equal(metadata.visibility, 'PRIVATE'); assert.match(metadata.description || '', /ChatSync synthetic acceptance/);
      assert.equal((await probe.verifyPrivateRemote(remote)).ok, true);
      probe.applyProxyEnv(probe.loadConfig());
      const refs = await probe.git(['-c','credential.helper=','-c','credential.helper=!gh auth git-credential','ls-remote','--heads',remote,'refs/heads/'+branch]);
      assert.equal(probe.ok(refs), true); assert.equal(refs.out.trim(), '');
      evidence.branch = branch;
      evidence.checks.push('Real GitHub API verifies dedicated private test repository ownership; new acceptance branch is empty; production validator retained');
    }
    for (const home of homes) {
      const profileRoot = profile(home, ['@chatsync/desktop-fixture'], 'desktop');
      const driver = path.join(profileRoot, 'node_modules/@chatsync/desktop-fixture');
      fs.mkdirSync(driver, { recursive: true });
      fs.writeFileSync(path.join(driver, 'package.json'), JSON.stringify({ name: '@chatsync/desktop-fixture', version: '1.0.0',
        type: 'module', main: './index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }));
      fs.writeFileSync(path.join(driver, 'cordis.patch.yml'), '- insert:\n    - id: chatsync-desktop-fixture\n      name: "@chatsync/desktop-fixture"\n');
      fs.writeFileSync(path.join(driver, 'index.js'), `
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createUserMessage } from ${JSON.stringify(moduleURL('@deepseek-ai/dsh-llm'))};
import { RecoveryStore } from ${JSON.stringify(pathToFileURL(path.join(repo, 'lib/recovery.js')).href)};
export const inject = ['webServer', 'sessions', 'sessionPersistence', 'sessionQuery', 'workspaceRegistry', 'attachments'];
export function apply(ctx) {
  const home = process.env.DSH_HOME;
  const respond = (res, value) => { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify(value)); };
  ctx.effect(() => ctx.webServer.register({kind:'exact',path:'/desktop-fixture/create',handler:async(req,res)=>{
    try {
      const cwd=path.join(home,'fixture-project'); fs.mkdirSync(cwd,{recursive:true});
      const workspace=await ctx.workspaceRegistry.create(cwd,'桌面隔离验收项目');
      const session=ctx.sessions.prepare('session-'+randomUUID(),{meta:{cwd}});
      const writer=await ctx.sessionPersistence.create(session.header);
      const detach=ctx.sessions.enter(session); ctx.effect(()=>detach); ctx.sessions.announce(session);
      const attachment=await ctx.attachments.saveFile({data:Buffer.from('Desktop attachment fixture'),name:'桌面验收.txt'});
      session.append('turn/start',{turn:1});
      session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'桌面宿主会话与恢复验收'},{type:'file',attachment}]}),{surfaceOp:'append'});
      session.append('turn/end',{turn:1,reason:{kind:'completed'}});
      await ctx.sessions.flush(session); await writer.close(); await workspace.attachSession(session.id);
      const files=fs.readdirSync(path.join(home,'sessions'),{recursive:true}).filter(file=>file.includes(session.id)&&/\\.jsonl(?:\\.zstd)?$/.test(file));
      if(files.length!==1) throw new Error('Session storage path is ambiguous');
      const relative='sessions/'+files[0].split(path.sep).join('/'), bytes=fs.readFileSync(path.join(home,relative));
      const record=new RecoveryStore(home).save({kind:'main',status:'merged',path:relative,kept:'local'},{local:bytes,remote:bytes});
      respond(res,{ok:true,sourceId:session.id,workspaceId:workspace.id,record,originalHash:createHash('sha256').update(bytes).digest('hex')});
    } catch(e){respond(res,{ok:false,error:e.message});}
  }}));
  ctx.effect(() => ctx.webServer.register({kind:'exact',path:'/desktop-fixture/inspect',handler:async(req,res)=>{
    try {
      const sessions=[];
      for(const stored of await ctx.sessionPersistence.list()) {
        const id=stored.header.id, value=await ctx.sessionQuery.readSession(id);
        if(!value) throw new Error('Public query cannot read '+id);
        sessions.push({id,eventCount:value.events.length,eventHash:createHash('sha256').update(JSON.stringify(value.events)).digest('hex'),parentSession:stored.header.parentSession});
      }
      const workspaces=ctx.workspaceRegistry.list().map(workspace=>({id:workspace.id,path:workspace.path,sessions:workspace.sessionIds}));
      const catalog=ctx.get('tools'); const tools=['sync_status','sync_preview','sync_doctor'].filter(name=>catalog?.get(name));
      respond(res,{ok:true,sessions,workspaces,tools});
    } catch(e){respond(res,{ok:false,error:e.message});}
  }}));
}
`);
    }
    const engines = homes.map(home => {
      const engine = new SyncEngine(home, { remote, branch, autoRepo: false, patches: false, workspaceSync: false,
        contentScope: { sessions: true, attachments: true, settings: false }, autoRestartAfterRepair: false });
      if (!githubRemote) engine.verifyPrivateRemote = async () => ({ ok: true });
      return acceptFixturePreviews(engine);
    });
    const boot = home => bootHost(dshRoot, home, '/desktop-fixture/inspect', { desktopRuntime: runtimeDir,
      env: { HOME: path.join(root, 'user'), USERPROFILE: path.join(root, 'user') } });
    const synchronize = async engine => {
      const result = await engine.syncOnce('desktop-fixture', { forceCommit: true, offlineApply: true });
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.equal(result.downloadPending, undefined, JSON.stringify(result));
    };
    const initial = [];
    for (let i = 0; i < homes.length; i++) {
      host = await boot(homes[i]);
      const status = await host.request('/dsh-sync/api/status');
      assert.equal(status.hostKind, 'desktop', JSON.stringify(status));
      await assert.rejects(assertDshClosed(engines[i], true), /仍检测到 DSH/);
      if (i === 1) {
        const received = await host.request('/desktop-fixture/inspect');
        assert.equal(received.sessions.length, 2);
      }
      const fixture = await host.request('/desktop-fixture/create', {});
      assert.equal(fixture.ok, true, JSON.stringify(fixture));
      const request = { id: fixture.record.id, side: 'remote', expectedHash: fixture.record.versions.remote.sha256, workspaceId: fixture.workspaceId };
      const imported = await host.request('/dsh-sync/api/recovery/import-session', request);
      assert.equal(imported.ok, true, JSON.stringify(imported));
      assert.notEqual(imported.sessionId, fixture.sourceId); assert.equal(imported.attachmentCount, 1);
      const repeated = await host.request('/dsh-sync/api/recovery/import-session', request);
      assert.equal(repeated.sessionId, imported.sessionId);
      assert.equal(digest(fs.readFileSync(path.join(homes[i], fixture.record.path))), fixture.originalHash);
      const inspection = await host.request('/desktop-fixture/inspect');
      assert.equal(inspection.ok, true, JSON.stringify(inspection));
      assert.deepEqual(inspection.tools.sort(), ['sync_doctor', 'sync_preview', 'sync_status']);
      assert.ok(inspection.workspaces.find(w=>w.id===fixture.workspaceId).sessions.includes(imported.sessionId));
      initial.push({ sourceId: fixture.sourceId, importedId: imported.sessionId });
      evidence.checks.push(path.basename(homes[i]) + ': actual Desktop IPC ready, host identity, live-process repair refusal, public source/fork/readback, attachment, project, duplicate retry and three tools verified');
      stopHost(host.child); host = undefined;
      if (i === 0) { await synchronize(engines[0]); await synchronize(engines[1]); }
      else { await synchronize(engines[1]); await synchronize(engines[0]); }
    }
    const observed = [];
    for (const home of homes) {
      host = await boot(home);
      const value = await host.request('/desktop-fixture/inspect');
      assert.equal(value.ok, true, JSON.stringify(value)); assert.equal(value.sessions.length, 4);
      const registered = new Set(value.workspaces.flatMap(w=>w.sessions));
      for (const session of value.sessions) assert.ok(registered.has(session.id));
      observed.push(value.sessions.map(s=>[s.id,s.eventCount,s.eventHash,s.parentSession]).sort((a,b)=>a[0].localeCompare(b[0])));
      stopHost(host.child); host = undefined;
    }
    assert.deepEqual(observed[0], observed[1]);
    const attachments = home => fs.readdirSync(path.join(home, 'attachments'), {recursive:true}).filter(file=>fs.statSync(path.join(home,'attachments',file)).isFile())
      .map(file=>[file.split(path.sep).join('/'),digest(fs.readFileSync(path.join(home,'attachments',file)))]).sort((a,b)=>a[0].localeCompare(b[0]));
    assert.deepEqual(attachments(homes[0]), attachments(homes[1]));
    evidence.checks.push('A upload → B read and add → A receive; both actual Desktop Hosts restart sequentially and publicly read identical four sessions, membership and attachment hashes');
    if (githubRemote) {
      const response = await engines[0].gh(['api', 'repos/' + githubRepository.fullName + '/git/ref/heads/' + branch]);
      assert.equal(engines[0].ok(response), true, 'GitHub API could not read the acceptance branch');
      const githubCommit = JSON.parse(response.out).object.sha;
      const mirror = scopeMirrorPath(engines[0].home, engines[0].loadConfig());
      const local = await engines[0].rev(branch, path.join(mirror, '.git'), mirror);
      assert.match(local || '', /^[0-9a-f]{40,64}$/, 'Scoped transmission branch could not be read');
      assert.equal(local, githubCommit, 'GitHub must contain the exact checked transmission commit');
      evidence.githubCommit = githubCommit;
      evidence.checks.push('Actual GitHub API reads the exact checked transmission commit; no local Git URL rewriting or private-validation substitute');
    }
    evidence.homes = homes;
    fs.writeFileSync(path.join(root,'acceptance.json'),JSON.stringify(evidence,null,2));
    console.log(JSON.stringify({ok:true,root,...evidence},null,2));
  } catch (error) {
    fs.writeFileSync(path.join(root,'acceptance-failed.json'),JSON.stringify({...evidence,error:error.message,stack:error.stack},null,2));
    console.error(JSON.stringify({ok:false,root,error:error.message})); process.exitCode=1;
  } finally { if(host) stopHost(host.child); }
}
