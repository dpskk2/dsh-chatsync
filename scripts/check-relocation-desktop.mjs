// Native Desktop services with synthetic data only. No personal remote or profile changes.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { profile, bootHost, stopHost, repo } from './native-fixture.mjs';

const installation = path.join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness');
const outputArg = process.argv[2];
if (process.argv.length > 3)
  throw new Error('Usage: node scripts/check-relocation-desktop.mjs [new outputs directory]');
if (!process.versions.electron) {
  const child = spawn(
    path.join(installation, 'DeepSeek Harness.exe'),
    ['--expose-internals', fileURLToPath(import.meta.url), ...(outputArg ? [outputArg] : [])],
    { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.on('exit', resolve);
    child.on('error', reject);
  });
} else {
  const out = path.resolve(outputArg || path.join(repo, 'outputs', 'relocation-' + Date.now()));
  if (!out.startsWith(path.join(repo, 'outputs') + path.sep) || fs.existsSync(out))
    throw new Error('Use a new directory under outputs/');
  fs.mkdirSync(out, { recursive: true });
  const home = path.join(out, 'native-home-' + Date.now());
  const root = profile(home, ['@chatsync/relocation-proof'], 'desktop');
  const configFile = path.join(home, 'dsh-sync.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      ...JSON.parse(fs.readFileSync(configFile, 'utf8')),
      workspaceBase: path.join(home, 'local-projects'),
    }),
  );
  const driver = path.join(root, 'node_modules/@chatsync/relocation-proof');
  fs.mkdirSync(driver, { recursive: true });
  fs.writeFileSync(
    path.join(driver, 'package.json'),
    JSON.stringify({
      name: '@chatsync/relocation-proof',
      version: '1.0.0',
      type: 'module',
      main: './index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }),
  );
  fs.writeFileSync(
    path.join(driver, 'cordis.patch.yml'),
    '- insert:\n    - id: relocation-proof\n      name: "@chatsync/relocation-proof"\n',
  );
  fs.writeFileSync(
    path.join(driver, 'index.js'),
    `
import fs from 'node:fs';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';
export const inject=['webServer','sessions','sessionPersistence','sessionQuery','workspaceRegistry'];
const hash=b=>createHash('sha256').update(b).digest('hex');
export function apply(ctx){ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/relocation-proof',handler:async(req,res)=>{
try{const home=process.env.DSH_HOME;const body=JSON.parse(await Array.fromAsync(req).then(b=>Buffer.concat(b).toString())||'{}');
if(body.action==='create'){
 const cwd=path.join(home,'remote-machine','project');fs.mkdirSync(cwd,{recursive:true});
 const sourceWorkspace=await ctx.workspaceRegistry.create(cwd,'原项目');
 const target=path.join(home,'local-projects','project');fs.mkdirSync(target,{recursive:true});const workspace=await ctx.workspaceRegistry.create(target,'本机新项目');
 const session=ctx.sessions.prepare('session-'+randomUUID(),{meta:{cwd}});
 const writer=await ctx.sessionPersistence.create(session.header);const detach=ctx.sessions.enter(session);ctx.effect(()=>detach);ctx.sessions.announce(session);
 session.append('turn/start',{turn:1});
 session.append('turn/end',{turn:1,reason:{kind:'completed'}});await ctx.sessions.flush(session);await writer.close();await sourceWorkspace.attachSession(session.id);
 fs.rmdirSync(cwd);res.end(JSON.stringify({ok:true,sourceId:session.id,workspaceId:workspace.id}));return;
}
const source=await ctx.sessionQuery.readSession(body.sourceId),target=await ctx.sessionQuery.readSession(body.targetId);
res.end(JSON.stringify({ok:true,archived:ctx.workspaceRegistry.archivedSessionIds.includes(body.sourceId),
 sourceHash:hash(Buffer.from(JSON.stringify(source.events))),targetPrefixHash:hash(Buffer.from(JSON.stringify(target.events.slice(0,source.events.length)))),
 targetCwd:target.session.cwd,parentSession:target.session.parentSession,targetEvents:target.events.length,sourceEvents:source.events.length,
 targetMembers:ctx.workspaceRegistry.list().find(w=>w.id===body.workspaceId)?.sessionIds}));
}catch(e){res.end(JSON.stringify({ok:false,error:e.stack}));}}}));}
`,
  );
  const runtime = path.join(installation, 'resources/app.asar/dsh');
  let host;
  try {
    host = await bootHost('', home, '/dsh-sync/api/status', { desktopRuntime: runtime });
    const initial = await host.request('/relocation-proof', { action: 'create' });
    assert.equal(initial.ok, true, JSON.stringify(initial));
    const scan = await host.request('/dsh-sync/api/data-health/scan');
    const issue = [...scan.issues, ...(scan.ordinaryUngroupedSessions || [])].find(
      i => ['relocate', 'grouping'].includes(i.kind) && i.sessionId === initial.sourceId,
    );
    assert.ok(issue, JSON.stringify(scan));
    const preview = await host.request('/dsh-sync/api/data-health/preview', { key: issue.key });
    assert.equal(preview.ok, true, JSON.stringify(preview));
    assert.equal(preview.suggestedWorkspaceId, initial.workspaceId, JSON.stringify(preview));
    const body = {
      recoveryId: preview.recoveryId,
      expectedHash: preview.expectedHash,
      workspaceId: initial.workspaceId,
      archiveSource: true,
    };
    const imported = await host.request('/dsh-sync/api/data-health/import', body);
    assert.equal(imported.ok, true, JSON.stringify(imported));
    assert.equal(imported.archivedSource, true);
    const verify = await host.request('/relocation-proof', { ...initial, targetId: imported.sessionId });
    assert.equal(verify.ok, true, JSON.stringify(verify));
    assert.equal(verify.sourceHash, verify.targetPrefixHash);
    assert.equal(verify.archived, true);
    assert.equal(verify.parentSession, initial.sourceId);
    assert.deepEqual(verify.targetMembers, [imported.sessionId]);
    const retry = await host.request('/dsh-sync/api/data-health/import', body);
    assert.equal(retry.ok, true, JSON.stringify(retry));
    assert.equal(retry.sessionId, imported.sessionId);
    assert.equal((await host.request('/dsh-sync/api/local-storage/policy', { retentionDays: 0 })).ok, true);
    const storage = await host.request('/dsh-sync/api/local-storage/scan');
    assert.equal(storage.ok, true, JSON.stringify(storage));
    const original = storage.items.find(item => item.recordId === preview.recoveryId);
    assert.ok(original, JSON.stringify(storage));
    assert.equal(original.protected, false, original.reason);
    const cleanup = await host.request('/dsh-sync/api/local-storage/preview', { ids: [original.id] });
    assert.equal(cleanup.ok, true, JSON.stringify(cleanup));
    const cleaned = await host.request('/dsh-sync/api/local-storage/apply', { token: cleanup.token, confirm: true });
    assert.equal(cleaned.ok, true, JSON.stringify(cleaned));
    const afterCleanup = await host.request('/relocation-proof', { ...initial, targetId: imported.sessionId });
    assert.equal(afterCleanup.sourceHash, afterCleanup.targetPrefixHash);
    const after = await host.request('/dsh-sync/api/data-health/scan');
    assert.equal(after.issues.length, 0, JSON.stringify(after));
    stopHost(host.child);
    host = await bootHost('', home, '/dsh-sync/api/status', { desktopRuntime: runtime });
    const reopened = await host.request('/dsh-sync/api/data-health/scan');
    assert.equal(reopened.issues.length, 0, JSON.stringify(reopened));
    const persisted = await host.request('/relocation-proof', { ...initial, targetId: imported.sessionId });
    assert.equal(persisted.sourceHash, persisted.targetPrefixHash);
    assert.equal(persisted.archived, true);
    const result = {
      ok: true,
      initial,
      imported,
      verify,
      retry,
      cleaned,
      afterCleanup,
      reopened,
      persisted,
      node: process.versions.node,
      electron: process.versions.electron,
    };
    fs.writeFileSync(path.join(out, 'native-relocation-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    if (host) stopHost(host.child);
  }
}
