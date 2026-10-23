// Real Desktop services, synthetic sessions, isolated home; never restarts the daily app.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { profile, bootHost, stopHost, repo } from './native-fixture.mjs';

const installation = path.join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness');
if (!process.versions.electron) {
  const child = spawn(path.join(installation, 'DeepSeek Harness.exe'), ['--expose-internals', fileURLToPath(import.meta.url)],
    { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exitCode = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
} else {
  const out = process.env.DSH_GROUPING_REPORT_DIR || path.join(repo, 'outputs/grouping-intent-20261023/native');
  fs.mkdirSync(out, { recursive: true });
  const home = path.join(out, 'native-home-' + Date.now());
  const root = profile(home, ['@chatsync/grouping-fixture'], 'desktop');
  const driver = path.join(root, 'node_modules/@chatsync/grouping-fixture');
  fs.mkdirSync(driver, { recursive: true });
  fs.writeFileSync(path.join(driver, 'package.json'), JSON.stringify({ name: '@chatsync/grouping-fixture', version: '1.0.0', type: 'module', main: './index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }));
  fs.writeFileSync(path.join(driver, 'cordis.patch.yml'), '- insert:\n    - id: grouping-fixture\n      name: "@chatsync/grouping-fixture"\n');
  const syncURL = pathToFileURL(path.join(repo, 'lib/sync.js')).href;
  const groupingURL = pathToFileURL(path.join(repo, 'lib/host-grouping.js')).href;
  fs.writeFileSync(path.join(driver, 'index.js'), `
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SyncEngine } from ${JSON.stringify(syncURL)};
import { groupingRepairStatus } from ${JSON.stringify(groupingURL)};
import { scanDataHealth } from ${JSON.stringify(pathToFileURL(path.join(repo, 'lib/data-health.js')).href)};
export const inject=['webServer','sessions','sessionPersistence','workspaceRegistry'];
export function apply(ctx){
 const home=process.env.DSH_HOME;
 const reply=(res,value)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 const engine=new SyncEngine(home,{enabled:true,autoRestartAfterRepair:true});engine.setHostContext(ctx);
 ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/grouping/create',handler:async(req,res)=>{try{
   const cwd=path.join(home,'project');fs.mkdirSync(cwd,{recursive:true});
   const workspace=await ctx.workspaceRegistry.create(cwd,'分组验收');
   const session=ctx.sessions.prepare('session-'+randomUUID(),{meta:{cwd}});
   const writer=await ctx.sessionPersistence.create(session.header);
   const detach=ctx.sessions.enter(session);ctx.effect(()=>detach);ctx.sessions.announce(session);
   session.append('turn/start',{turn:1});session.append('turn/end',{turn:1,reason:{kind:'completed'}});
   await ctx.sessions.flush(session);await writer.close();
   const file=path.join(home,'storages/workspace.json');const disk=JSON.parse(fs.readFileSync(file,'utf8'));
   disk.tables.workspaces[workspace.id].sessionIds.push(session.id);fs.writeFileSync(file,JSON.stringify(disk));
   const state=engine.hostGroupingState();let scheduled=0;
   const target=engine.autoRestartHost();engine.scheduleRestartAfterRepair=()=>{scheduled++;return true};
   engine.sessionActivity=()=>({available:true,activeCount:1});const busy=engine.maybeScheduleRepairRestart({restartRequired:true});
   engine.sessionActivity=()=>({available:true,activeCount:0});const idle=engine.maybeScheduleRepairRestart({});
   const count=engine.ungroupedSessionIds().length;
   await ctx.workspaceRegistry.archiveSession(session.id);
   const archived=groupingRepairStatus(engine);
   await ctx.workspaceRegistry.unarchiveSession(session.id);
   engine.sendGuard={};engine.lastOutcome={error:'queued-data-repair'};
   const unarchived=groupingRepairStatus(engine);
   const noAutomaticClose=engine.maybeScheduleRepairRestart({restartRequired:true})===false;
   await workspace.attachSession(session.id);
   await ctx.workspaceRegistry.archiveSession(session.id);
   engine.repairWorkspaceRegistry();
   const archiveKeptSlot=workspace.sessionIds.includes(session.id);
   const archiveHealth=scanDataHealth(engine);
   await ctx.workspaceRegistry.delete(workspace.id);
   engine.repairWorkspaceRegistry();engine.repairWorkspaceRegistry();
   const deletedArchived=groupingRepairStatus(engine);
   await ctx.workspaceRegistry.unarchiveSession(session.id);
   const deletedUnarchived=groupingRepairStatus(engine);
   const deletionHealth=scanDataHealth(engine);
   const projects=ctx.workspaceRegistry.list().map(w=>w.id);
   reply(res,{ok:true,id:session.id,state,count,target,busy,idle,scheduled,archived,unarchived,noAutomaticClose,archiveKeptSlot,
    archiveIssues:archiveHealth.issues,deletedArchived,deletedUnarchived,deletionIssues:deletionHealth.issues,ordinary:deletionHealth.ordinaryUngroupedSessions.length,projects});
 }catch(e){reply(res,{ok:false,error:e.stack})}}}));
 ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/grouping/state',handler:(req,res)=>reply(res,{ok:true,state:engine.hostGroupingState(),count:engine.ungroupedSessionIds().length})}));
}
`);
  const runtime = path.join(installation, 'resources/app.asar/dsh');
  const boot = () => bootHost(path.join(runtime, 'node_modules/@deepseek-ai/dsh'), home, '/grouping/state',
    { desktopRuntime: runtime, env: { USERPROFILE: path.join(home, 'user'), HOME: path.join(home, 'user') } });
  let host;
  try {
    host = await boot();
    const before = await host.request('/grouping/create');
    assert.equal(before.ok,true,JSON.stringify(before)); assert.equal(before.count,1);
    assert.deepEqual(before.state.refreshableIds,[before.id]); assert.equal(before.target,'desktop');
    assert.equal(before.busy,false); assert.equal(before.idle,true); assert.equal(before.scheduled,1);
    assert.equal(before.archived.count,0);
    assert.equal(before.unarchived.count,0); assert.equal(before.unarchived.ordinaryCount,1); assert.equal(before.unarchived.issueKey,null);
    assert.equal(before.unarchived.refreshOnly,false); assert.equal(before.noAutomaticClose,true);
    assert.equal(before.archiveKeptSlot,true);assert.equal(before.archiveIssues.length,0);assert.deepEqual(before.projects,[]);
    assert.equal(before.deletedArchived.archivedCount,1);assert.equal(before.deletedUnarchived.count,0);assert.equal(before.ordinary,1);assert.equal(before.deletionIssues.length,0);
    stopHost(host.child); host = await boot();
    const after = await host.request('/grouping/state');
    assert.equal(after.ok,true); assert.equal(after.count,0); assert.deepEqual(after.state.refreshableIds,[]);assert.equal(after.state.ordinaryIds.length,1);
    const result={ok:true,node:process.versions.node,electron:process.versions.electron,before,after,
      boundary:'Actual installed Desktop Host services; synthetic home; restart scheduling stubbed; host stopped/reopened by fixture; daily app untouched'};
    fs.writeFileSync(path.join(out,'native-grouping-intent-result.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
  } finally { if(host)stopHost(host.child); }
}
