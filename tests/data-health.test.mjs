import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SyncEngine } from '../lib/sync.js';
import { scopeMirrorPath } from '../lib/scope.js';
import { digest } from '../lib/recovery.js';
import { parseSessionLog } from '../lib/merge.js';
import { fixtureCatalog } from './helpers/session-persistence.mjs';
import { scanDataHealth, previewDataRepair, queueDataRepair, queuedDataRepairs,
  cancelQueuedDataRepairs, applyDataRepair, previewDataRollback, pendingDataVerification, acknowledgeDataRepairs } from '../lib/data-health.js';

const id = 'session-11111111-1111-1111-1111-111111111111';
const file = 'sessions/test/' + id + '/session.v4.jsonl';
const encode = n => Buffer.from([{type:'session',version:4,id,cwd:'C:/right'}, ...Array.from({length:n},(_,seq)=>
  ({type:seq%2?'turn/end':'turn/start',seq,time:seq+1,data:{turn:Math.floor(seq/2)+1}}))].map(JSON.stringify).join('\n')+'\n');
const offline = { offline:true, assertClosed:async()=>{} };
function fixture(t) {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'chatsync-health-'));
  t.after(()=>removeFixture(home));
  const engine=new SyncEngine(home,{autoRepo:false,workspaceSync:false}); engine.loadTransferCatalog=async()=>fixtureCatalog;
  const put=(name,bytes)=>{const target=path.join(home,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);};
  return {engine,home,put};
}

test('the processing list follows the live sidebar even when the disk registry looks repaired',t=>{
  const {engine,home,put}=fixture(t);const cwd=path.join(home,'project');fs.mkdirSync(cwd);
  const rows=[{type:'session',version:4,id,cwd},{type:'turn/start',seq:0,time:1,data:{turn:1}},{type:'turn/end',seq:1,time:2,data:{turn:1}}];
  put(file,rows.map(JSON.stringify).join('\n')+'\n');
  put('storages/workspace.json',JSON.stringify({global:{workspaceIds:['w'],archivedSessionIds:[]},tables:{workspaces:{w:{path:cwd,title:'Project',sessionIds:[id],createdAt:'now',updatedAt:'now'}}}}));
  engine.hostGroupingState=()=>({available:true,ungroupedIds:[id],refreshableIds:[id]});
  const scan=scanDataHealth(engine);assert.equal(scan.issues.length,0);assert.equal(scan.ungroupedSessions.length,1);
  assert.equal(scan.ungroupedSessions[0].sessionId,id);assert.equal(scan.ungroupedSessions[0].refreshOnly,true);
});

test('wrong, duplicate and archived memberships are previewed and repaired with a reversible original',async t=>{
  const {engine,home,put}=fixture(t);put(file,encode(2));
  const ws={global:{workspaceIds:['wrong','right'],archivedSessionIds:[]},tables:{workspaces:{
    wrong:{path:'C:/wrong',sessionIds:[id,id]},right:{path:'C:/right',sessionIds:[]}}}};
  const original=Buffer.from(JSON.stringify(ws));put('storages/workspace.json',original);
  const issue=scanDataHealth(engine).issues.find(i=>i.kind==='membership');assert.ok(issue);
  const plan=await previewDataRepair(engine,{key:issue.key});
  assert.deepEqual(fs.readFileSync(path.join(home,'storages/workspace.json')),original,'preview never writes registry');
  queueDataRepair(engine,plan.planId);assert.equal(queuedDataRepairs(engine).length,1);
  assert.match((await engine.syncOnce('test')).error,/已安排/);
  const applied=await applyDataRepair(engine,plan.planId,offline);
  const repaired=JSON.parse(fs.readFileSync(path.join(home,'storages/workspace.json')));
  assert.deepEqual(repaired.tables.workspaces.wrong.sessionIds,[]);assert.deepEqual(repaired.tables.workspaces.right.sessionIds,[id]);
  const reverse=previewDataRollback(engine,applied.backups[0]);await applyDataRepair(engine,reverse.planId,offline);
  assert.deepEqual(fs.readFileSync(path.join(home,'storages/workspace.json')),original);
  ws.global.archivedSessionIds=[id];put('storages/workspace.json',JSON.stringify(ws));
  const archived=await previewDataRepair(engine,{key:issue.key});await applyDataRepair(engine,archived.planId,offline);
  const saved=JSON.parse(fs.readFileSync(path.join(home,'storages/workspace.json')));
  assert.deepEqual(saved.global.archivedSessionIds,[id]);assert.deepEqual(saved.tables.workspaces.right.sessionIds,[id]);assert.deepEqual(saved.tables.workspaces.wrong.sessionIds,[]);
  assert.equal(scanDataHealth(engine).issues.some(issue=>issue.kind==='membership'),false);
  assert.equal(cancelQueuedDataRepairs(engine).cancelled,1);
});

test('plain torn tails, missing newline, seq gaps and complete compressed frames recover without renumbering',async t=>{
  const {engine,home,put}=fixture(t);
  for(const [suffix,bad] of [
    ['',Buffer.concat([encode(4),Buffer.from('{"type":"turn/start","seq":')])],
    ['',encode(4).subarray(0,-1)],
    ['',Buffer.concat([encode(4),Buffer.from('{"type":"turn/start","seq":9}\n')])],
    ['.zstd',Buffer.concat([zstdCompressSync(encode(4)),zstdCompressSync(Buffer.from('{"seq":4}\n')).subarray(0,5)])],
  ]) {
    const target=file+suffix;put(target,bad);
    const preview=await previewDataRepair(engine,{key:target});assert.ok(preview.candidates.length);
    const plan=await previewDataRepair(engine,{key:target,candidateHash:preview.candidates[0].hash});
    const result=await applyDataRepair(engine,plan.planId,offline);
    const saved=fs.readFileSync(path.join(home,target));assert.deepEqual(parseSessionLog(saved),parseSessionLog(encode(4)));
    assert.deepEqual(engine.recovery.version(engine.recovery.read(result.backups[0]),'local'),bad);
    // Keep the repaired plain file out of the next physical-generation case.
    if (!suffix) fs.renameSync(path.join(home,target),path.join(home,'repaired-'+digest(saved)+'.txt'));
  }
});

test('stale previews, changed chosen logs and missing strict host validation stop before writing',async t=>{
  const {engine,home,put}=fixture(t);const bad=Buffer.concat([encode(2),Buffer.from('{')]);put(file,bad);
  const listing=await previewDataRepair(engine,{key:file});
  const plan=await previewDataRepair(engine,{key:file,candidateHash:listing.candidates[0].hash});
  put(file,Buffer.concat([bad,Buffer.from('changed')]));
  await assert.rejects(applyDataRepair(engine,plan.planId,offline),/变化/);
  put(file,bad);engine.loadTransferCatalog=async()=>{throw new Error('strict capability absent');};
  await assert.rejects(previewDataRepair(engine,{key:file,candidateHash:listing.candidates[0].hash}),/capability absent/);
  assert.deepEqual(fs.readFileSync(path.join(home,file)),bad);
});

test('same-generation ambiguity archives the other original and refuses a changed selection',async t=>{
  const {engine,home,put}=fixture(t);put(file,encode(2));put(file+'.zstd',zstdCompressSync(encode(4)));
  const key='ambiguous:'+id;
  assert.equal((await previewDataRepair(engine,{key})).choices.length,2);
  const plan=await previewDataRepair(engine,{key,selectedFile:file});
  put(file,encode(6));await assert.rejects(applyDataRepair(engine,plan.planId,offline),/变化/);
  put(file,encode(2));const result=await applyDataRepair(engine,plan.planId,offline);
  assert.equal(fs.existsSync(path.join(home,file+'.zstd')),false);assert.deepEqual(fs.readFileSync(path.join(home,file)),encode(2));
  assert.deepEqual(engine.recovery.version(engine.recovery.read(result.backups[0]),'local'),zstdCompressSync(encode(4)));
});

test('corrupted registry can recover from a verified original; unknown missing content is never invented',async t=>{
  const {engine,home,put}=fixture(t);const valid=Buffer.from(JSON.stringify({global:{workspaceIds:['w']},tables:{workspaces:{w:{path:'C:/right',sessionIds:[id]}}}}));
  engine.recovery.save({kind:'scope-backup',path:'storages/workspace.json',status:'applied'},{local:valid,remote:valid});
  put('storages/workspace.json','{broken');
  const preview=await previewDataRepair(engine,{key:'storages/workspace.json'});assert.equal(preview.candidates.length,1);
  const plan=await previewDataRepair(engine,{key:'storages/workspace.json',candidateHash:preview.candidates[0].hash});await applyDataRepair(engine,plan.planId,offline);
  const restored=JSON.parse(fs.readFileSync(path.join(home,'storages/workspace.json')));
  assert.deepEqual(restored.tables.workspaces.w.sessionIds,[id]);assert.equal(typeof restored.tables.workspaces.w.updatedAt,'string');
  const missing=scanDataHealth(engine).issues.find(issue=>issue.kind==='missing');assert.ok(missing);
  await assert.rejects(previewDataRepair(engine,{key:missing.key}),/不能重建/);
});

test('BOM-aware configuration history restores saved choices, and explicit rebuild stays manual',async t=>{
  const {engine,home,put}=fixture(t);
  const cfg={remote:'https://github.com/fixture/custom',autoRepo:false,contentScope:{sessions:true,settings:false,attachments:false}};
  put('dsh-sync.json','\uFEFF'+JSON.stringify(cfg));engine.writeConfig({enabled:false});put('dsh-sync.json','{broken');
  const listing=await previewDataRepair(engine,{key:'dsh-sync.json'});assert.equal(listing.candidates.length,1);
  const plan=await previewDataRepair(engine,{key:'dsh-sync.json',candidateHash:listing.candidates[0].hash});await applyDataRepair(engine,plan.planId,offline);
  assert.equal(engine.loadConfig().remote,cfg.remote);assert.equal(engine.loadConfig().contentScope.settings,false);
  put('dsh-sync.json','{broken');const replacement=await previewDataRepair(engine,{key:'dsh-sync.json',replacementConfig:{remote:'https://github.com/fixture/new'}});
  await applyDataRepair(engine,replacement.planId,offline);assert.equal(engine.loadConfig().enabled,false);assert.equal(engine.loadConfig().autoRepo,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home,'dsh-sync.json'))).remote,'https://github.com/fixture/new');
});

test('a process killed after replacement resumes the same durable repair without truncating new edits',async t=>{
  const {engine,home,put}=fixture(t);put(file,Buffer.concat([encode(4),Buffer.from('{')]));
  const choices=await previewDataRepair(engine,{key:file});const plan=await previewDataRepair(engine,{key:file,candidateHash:choices.candidates[0].hash});
  const code=`import {SyncEngine} from ${JSON.stringify(pathToFileURL(path.resolve('lib/sync.js')).href)};
    import {applyDataRepair} from ${JSON.stringify(pathToFileURL(path.resolve('lib/data-health.js')).href)};
    const engine=new SyncEngine(process.argv[1],{autoRepo:false});const finish=engine.recovery.finish.bind(engine.recovery);
    engine.recovery.finish=(id,value)=>{if(value.status==='repaired')process.exit(37);return finish(id,value);};
    await applyDataRepair(engine,process.argv[2],{offline:true,assertClosed:async()=>{}});`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code,home,plan.planId],{encoding:'utf8'});assert.equal(child.status,37,child.stderr);
  assert.deepEqual(parseSessionLog(fs.readFileSync(path.join(home,file))),parseSessionLog(encode(4)));
  await applyDataRepair(engine,plan.planId,offline);
  put(file,encode(6));await assert.rejects(applyDataRepair(engine,plan.planId,offline),/变化/);
  assert.deepEqual(fs.readFileSync(path.join(home,file)),encode(6));
});

test('completed repairs wait for explicit user verification before any transfer',async t=>{
  const {engine,home,put}=fixture(t);put('.chatsync-local/data-repair/verification.json','["verified-preview"]');
  assert.equal(pendingDataVerification(engine).length,1);
  const result=await engine.syncOnce('test');assert.equal(result.deferred,true);assert.match(result.error,/核对正文/);
  assert.equal(result.dataVerificationPending,true);
  assert.match(result.error,/检查与修复历史数据.*已检查修复结果，允许同步.*立即同步/);
  assert.equal(fs.existsSync(path.join(home,'.git')),false);
  acknowledgeDataRepairs(engine);assert.deepEqual(pendingDataVerification(engine),[]);
});

test('after restart repair can find intact history in the persistent transport without initializing or fetching',async t=>{
  const {engine,home,put}=fixture(t);const mirror=scopeMirrorPath(home,engine.loadConfig());fs.mkdirSync(mirror,{recursive:true});
  const source=path.join(mirror,file);fs.mkdirSync(path.dirname(source),{recursive:true});fs.writeFileSync(source,encode(6));
  for(const args of [['init','-b','main'],['config','user.name','fixture'],['config','user.email','fixture@invalid'],['add','.'],['commit','-m','intact fixture']])
    execFileSync('git',args,{cwd:mirror,stdio:'ignore'});
  put(file,Buffer.concat([encode(2),Buffer.from('{')]));assert.equal(engine._transport,undefined);
  const choices=await previewDataRepair(engine,{key:file});const history=choices.candidates.find(item=>item.source.startsWith('Git 历史'));assert.ok(history);
  const plan=await previewDataRepair(engine,{key:file,candidateHash:history.hash});await applyDataRepair(engine,plan.planId,offline);
  assert.deepEqual(fs.readFileSync(path.join(home,file)),encode(6));assert.equal(fs.existsSync(path.join(home,'.git')),false);
});


test('intentional and archived ungrouped sessions are visible context, not repair defects', t=>{
  const {engine,put}=fixture(t);put(file,encode(2));
  const ws={global:{workspaceIds:[],archivedSessionIds:[]},tables:{workspaces:{}}};
  put('storages/workspace.json',JSON.stringify(ws));
  let scan=scanDataHealth(engine);assert.equal(scan.issues.length,0);assert.equal(scan.ungroupedSessions.length,0);assert.equal(scan.ordinaryUngroupedSessions.length,1);
  ws.global.archivedSessionIds=[id];put('storages/workspace.json',JSON.stringify(ws));
  scan=scanDataHealth(engine);assert.equal(scan.issues.length,0);assert.equal(scan.ordinaryUngroupedSessions.length,0);assert.equal(scan.archivedUngroupedSessions.length,1);
});
