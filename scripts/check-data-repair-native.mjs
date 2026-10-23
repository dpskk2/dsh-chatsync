// Isolated real host acceptance; synthetic sessions and local files only.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { profile, bootHost, stopHost, repo } from './native-fixture.mjs';
import { SyncEngine } from '../lib/sync.js';
import { applyDataRepair, scanDataHealth, previewDataRepair } from '../lib/data-health.js';
import { removeFixture } from '../tests/helpers/fixture-cleanup.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'chatsync-health-native-'));
const output=path.join(repo,'outputs','compatibility-fixes-20261021','native-data-repair');fs.mkdirSync(output,{recursive:true});
const dshRoot=path.resolve(process.argv[2] || path.join(process.env.APPDATA,'npm/node_modules/@deepseek-ai/dsh'));
const require=createRequire(path.join(dshRoot,'lib/bin.js'));
const resolve=name=>pathToFileURL(require.resolve(name)).href;
const url=file=>pathToFileURL(path.join(repo,file)).href;
const home=path.join(root,'home'),driver=path.join(profile(home,['@chatsync/health-fixture']),'node_modules/@chatsync/health-fixture');
fs.mkdirSync(driver,{recursive:true});
fs.writeFileSync(path.join(driver,'package.json'),JSON.stringify({name:'@chatsync/health-fixture',version:'1.0.0',type:'module',main:'./index.js',dsh:{bundle:{patch:'./cordis.patch.yml'}}}));
fs.writeFileSync(path.join(driver,'cordis.patch.yml'),'- insert:\n    - id: health-fixture\n      name: "@chatsync/health-fixture"\n');
fs.writeFileSync(path.join(driver,'index.js'),`
import fs from 'node:fs'; import path from 'node:path'; import {randomUUID} from 'node:crypto'; import {zstdCompressSync} from 'node:zlib';
import {createUserMessage} from ${JSON.stringify(resolve('@deepseek-ai/dsh-llm'))};
import {RecoveryStore,digest} from ${JSON.stringify(url('lib/recovery.js'))};
import {parseSessionLog} from ${JSON.stringify(url('lib/merge.js'))};
export const inject=['webServer','sessions','sessionPersistence','sessionQuery','workspaceRegistry'];
export function apply(ctx){const home=process.env.DSH_HOME;ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/health-fixture',handler:async(req,res)=>{
 let reply;try{let text='';for await(const chunk of req)text+=chunk;const body=text?JSON.parse(text):{};
 if(body.action==='create'){
  const cwd=path.join(home,'project');fs.mkdirSync(cwd,{recursive:true});const ws=await ctx.workspaceRegistry.create(cwd,'health fixture');
  const session=ctx.sessions.prepare('session-'+randomUUID(),{meta:{cwd}}),writer=await ctx.sessionPersistence.create(session.header);
  const detach=ctx.sessions.enter(session);ctx.effect(()=>detach);ctx.sessions.announce(session);
  session.append('turn/start',{turn:1});session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'local branch fixture'}]}),{surfaceOp:'append'});
  session.append('turn/end',{turn:1,reason:{kind:'completed'}});await ctx.sessions.flush(session);await writer.close();await ws.attachSession(session.id);
  const all=fs.readdirSync(path.join(home,'sessions'),{recursive:true}).filter(f=>f.includes(session.id)&&/\\.jsonl(?:\\.zstd)?$/.test(f));
  const file='sessions/'+all[0].split(path.sep).join('/'),bytes=fs.readFileSync(path.join(home,file));
  const rows=parseSessionLog(bytes),remote=Buffer.from(rows.map(row=>JSON.stringify(row).replace('local branch fixture','remote branch fixture')).join('\\n')+'\\n');
  const record=new RecoveryStore(home).save({kind:'main',status:'merged',path:file,kept:'local'},{local:bytes,remote:zstdCompressSync(remote)});
  reply={ok:true,id:session.id,workspaceId:ws.id,file,record,hash:digest(bytes)};
 }else if(body.action==='damage'){
  fs.appendFileSync(path.join(home,body.file),zstdCompressSync(Buffer.from('{"bad":true}\\n')).subarray(0,5));reply={ok:true};
 }else if(body.action==='inspect'){
  const sessions=[];for(const item of await ctx.sessionPersistence.list()){const r=await ctx.sessionQuery.readSession(item.header.id);sessions.push({id:r.session.id,parentSession:r.session.parentSession,events:r.events.length,text:JSON.stringify(r.events)});}
  reply={ok:true,sessions,workspaces:ctx.workspaceRegistry.list().map(w=>({id:w.id,path:w.path,sessions:w.sessionIds}))};
 }else reply={ok:true};
 }catch(e){reply={ok:false,error:e.stack};}res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(reply));
 }}));}
`);
const evidence={ok:false,hostVersion:JSON.parse(fs.readFileSync(path.join(dshRoot,'package.json'))).version,remote:'none',personalData:false,checks:[],
  offlineGuard:'global process guard tested separately; apply test guard checks only the owned synthetic host has exited'};
let host,hostIndex=0;
async function close(){if(!host)return;fs.writeFileSync(path.join(output,'host-'+hostIndex+++'.log'),host.readLog());const child=host.child;stopHost(child);
 for(let i=0;i<100&&child.exitCode===null;i++)await new Promise(r=>setTimeout(r,50));assert.notEqual(child.exitCode,null);}
try{
 host=await bootHost(dshRoot,home,'/health-fixture');
 const created=await host.request('/health-fixture',{action:'create'});assert.equal(created.ok,true,JSON.stringify(created));
 const original=fs.readFileSync(path.join(home,created.file));
 const preview=await host.request('/dsh-sync/api/recovery/preview',{id:created.record.id});assert.equal(preview.ok,true,JSON.stringify(preview));assert.equal(preview.branches.divergent,true);
 const request={id:created.record.id,workspaceId:created.workspaceId,expectedLocalHash:created.record.versions.local.sha256,expectedRemoteHash:created.record.versions.remote.sha256};
 const preserved=await host.request('/dsh-sync/api/recovery/preserve-branches',request);assert.equal(preserved.ok,true,JSON.stringify(preserved));assert.equal(preserved.branches.length,1);
 const repeated=await host.request('/dsh-sync/api/recovery/preserve-branches',request);assert.equal(repeated.ok,true,JSON.stringify(repeated));assert.equal(repeated.branches[0].sessionId,preserved.branches[0].sessionId);
 const actual=await host.request('/health-fixture',{action:'inspect'});assert.equal(actual.sessions.length,2);assert.ok(actual.sessions.some(s=>s.text.includes('remote branch fixture')));
 assert.deepEqual(fs.readFileSync(path.join(home,created.file)),original);evidence.checks.push('Real host one-click branch preservation, independent parent lineage, distinct remote text, repeat identity and unchanged active original');
 await host.request('/health-fixture',{action:'damage',file:created.file});
 const options=await host.request('/dsh-sync/api/data-health/preview',{key:created.file});assert.equal(options.ok,true,JSON.stringify(options));assert.ok(options.candidates.length);
 const plan=await host.request('/dsh-sync/api/data-health/preview',{key:created.file,candidateHash:options.candidates[0].hash});assert.equal(plan.ok,true,JSON.stringify(plan));
 await close();const engine=new SyncEngine(home,{autoRepo:false});
 const ownedClosed=async()=>assert.notEqual(host.child.exitCode,null);
 await applyDataRepair(engine,plan.planId,{offline:true,assertClosed:ownedClosed});
 evidence.checks.push('Torn compressed tail recovered after real official strict preflight, backed up and read back only after owned host exits');
 const registryFile=path.join(home,'storages/workspace.json'),registry=JSON.parse(fs.readFileSync(registryFile));
 registry.tables.workspaces.wrong={...registry.tables.workspaces[created.workspaceId],path:path.join(home,'wrong'),title:'wrong',sessionIds:[created.id]};
 registry.global.workspaceIds.push('wrong');registry.tables.workspaces[created.workspaceId].sessionIds=registry.tables.workspaces[created.workspaceId].sessionIds.filter(id=>id!==created.id);
 fs.writeFileSync(registryFile,JSON.stringify(registry));
 const issue=scanDataHealth(engine).issues.find(i=>i.kind==='membership'&&i.sessionId===created.id);assert.ok(issue);
 const classification=await previewDataRepair(engine,{key:issue.key});await applyDataRepair(engine,classification.planId,{offline:true,assertClosed:ownedClosed});
 host=await bootHost(dshRoot,home,'/health-fixture');const final=await host.request('/health-fixture',{action:'inspect'});assert.equal(final.ok,true,JSON.stringify(final));
 assert.equal(final.sessions.length,2);assert.ok(final.workspaces.find(w=>w.id===created.workspaceId).sessions.includes(created.id));
 assert.ok(!final.workspaces.find(w=>w.id==='wrong').sessions.includes(created.id));
 evidence.checks.push('Wrong classification repaired offline; real host restart publicly reads both complete conversations and correct project membership');
 evidence.ok=true;
}catch(error){evidence.error=error.stack;process.exitCode=1;}
finally{await close();if(fs.existsSync(path.join(home,'boot.log')))fs.copyFileSync(path.join(home,'boot.log'),path.join(output,'failed-boot.log'));
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));if(evidence.ok)removeFixture(root);}
