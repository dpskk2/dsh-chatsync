// Optional acceptance with released complementary packages; never reads personal history.
// node scripts/check-dsh-import-integration.mjs <dsh-dir> <chat-import-dir> <codex-sync-dir> <fzstd-dir>
// Arguments are unpacked npm package directories. No npm lifecycle scripts are run.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { profile, bootHost, stopHost } from './native-fixture.mjs';
import { SyncEngine } from '../lib/sync.js';
import { acceptFixturePreviews } from '../tests/helpers/reviewed-sync.mjs';

if (process.argv.length !== 6) throw new Error('Expected DSH, chat-import, codex-sync and fzstd package directories');
const [dshRoot, importRoot, codexRoot, fzstdRoot] = process.argv.slice(2).map(p => path.resolve(p));
const metadata = root => JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(metadata(importRoot).name, 'dsh-chat-import');
assert.equal(metadata(codexRoot).name, 'dsh-codex-sync');
assert.equal(metadata(fzstdRoot).name, 'fzstd');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-import-native-'));
const hosts = [];
const result = { date: new Date().toISOString(), hostVersion: metadata(dshRoot).version,
  packages: [importRoot, codexRoot, fzstdRoot].map(p => ({ name: metadata(p).name, version: metadata(p).version,
    entrySha256: createHash('sha256').update(fs.readFileSync(path.join(p, metadata(p).main))).digest('hex') })),
  physicalMachines: 1, hostProcesses: 2, checks: [],
  remote: 'local Git bare fixture; production private-remote check substituted only in this script' };
const resolver = createRequire(path.join(dshRoot, 'lib/bin.js'));
function packageRoot(name) {
  let folder = path.dirname(resolver.resolve(name));
  while (!fs.existsSync(path.join(folder, 'package.json'))) {
    const parent = path.dirname(folder); if (folder === parent) throw new Error('Cannot locate package ' + name); folder = parent;
  }
  return folder;
}
function link(target, source) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
}
function rollout(source, cwd, text, addition = false) {
  const stamp = addition ? '2026-10-04T03:10:00.000Z' : '2026-10-04T03:00:00.000Z';
  const rows = addition ? [] : [{ type: 'session_meta', payload: { id: randomUUID(), cwd, timestamp: stamp } }];
  rows.push({ type: 'turn_context', payload: { cwd, model: 'fixture-model' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '隔离导入答复：' + text }] } },
    { type: 'event_msg', payload: { type: 'task_complete' } });
  const bytes = rows.map(row => JSON.stringify({ timestamp: stamp, ...row })).join('\n') + '\n';
  if (addition) fs.appendFileSync(source, bytes); else fs.writeFileSync(source, bytes);
}
async function inspect(host) {
  const value = await host.request('/import-fixture/inspect');
  assert.equal(value.ok, true, JSON.stringify(value)); return value;
}
async function restart(index) {
  const old = hosts[index]; stopHost(old.child);
  hosts[index] = await bootHost(dshRoot, old.home, '/import-fixture/inspect', { env: old.fixtureEnv });
  hosts[index].fixtureEnv = old.fixtureEnv;
  return inspect(hosts[index]);
}
try {
  const sources = [];
  for (const [index, original] of [importRoot, codexRoot].entries()) {
    const home = path.join(root, index === 0 ? 'a' : 'b');
    const pkg = metadata(original);
    const profileRoot = profile(home, [pkg.name, '@chatsync/import-fixture']);
    // Copy the released package inside this fixture before adding dependency links.
    const addon = path.join(profileRoot, 'node_modules', pkg.name);
    fs.cpSync(original, addon, { recursive: true, filter: file => !file.split(path.sep).includes('node_modules') });
    if (index === 0) {
      link(path.join(addon, 'node_modules/@deepseek-ai/dsh-tools'), packageRoot('@deepseek-ai/dsh-tools'));
      link(path.join(addon, 'node_modules/fzstd'), fzstdRoot);
    }
    const fakeUser = path.join(home, 'fixture-user'), codexHome = path.join(fakeUser, '.codex');
    const source = path.join(codexHome, 'sessions/2026/10/04/rollout-fixture.jsonl');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    const cwd = path.join(root, 'fixture-project-' + index); fs.mkdirSync(cwd, { recursive: true });
    rollout(source, cwd, '互补插件验收 ' + index); sources.push(source);
    const env = { HOME: fakeUser, USERPROFILE: fakeUser, CODEX_HOME: codexHome,
      DSH_IMPORT_CONTEXT_BRIDGE: '0', DSH_IMPORT_SESSION_HINT: '0' };
    if (index === 1) {
      // Persisted settings override defaults; disable all optional bridges and auto-import.
      const safeConfig = { codexHome, enableImport: true, autoImport: false,
        enableSkills: false, enableInstructions: false, enableConfig: false, mcpMirror: false, mcpServers: {} };
      fs.writeFileSync(path.join(home, 'codex-sync.json'), JSON.stringify(safeConfig));
      fs.writeFileSync(path.join(profileRoot, 'cordis.patch.yml'), '- update:\n    id: codex-sync\n    config: ' + JSON.stringify(safeConfig) + '\n');
    }
    const driver = path.join(profileRoot, 'node_modules/@chatsync/import-fixture'); fs.mkdirSync(driver, { recursive: true });
    fs.writeFileSync(path.join(driver, 'package.json'), JSON.stringify({ name: '@chatsync/import-fixture', version: '1.0.0', type: 'module', main: './index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }));
    fs.writeFileSync(path.join(driver, 'cordis.patch.yml'), '- insert:\n    - id: chatsync-import-fixture\n      name: "@chatsync/import-fixture"\n');
    fs.writeFileSync(path.join(driver, 'index.js'), `
import { randomUUID } from 'node:crypto';
import { createUserMessage } from ${JSON.stringify(pathToFileURL(resolver.resolve('@deepseek-ai/dsh-llm')).href)};
export const inject = ['webServer', 'sessionPersistence', 'sessionQuery', 'workspaceRegistry'];
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/import-fixture/create', handler: async (req, res) => {
    try {
      const cwd = ${JSON.stringify(cwd)};
      const workspace = await ctx.workspaceRegistry.create(cwd, '隔离验收项目');
      const sessions = ctx.get('sessions'), session = sessions.prepare('session-' + randomUUID(), { meta: { cwd } });
      const writer = await ctx.sessionPersistence.create(session.header);
      const detach = sessions.enter(session); ctx.effect(() => detach); sessions.announce(session);
      session.append('turn/start', { turn: 1 });
      session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '另一端原生会话' }] }), { surfaceOp: 'append' });
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
      await sessions.flush(session); await writer.close(); await workspace.attachSession(session.id);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, sessionId: session.id }));
    } catch(e) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: e.message })); }
  } }));
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/import-fixture/inspect', handler: async (req, res) => {
    try {
      const sessions = [];
      for (const row of await ctx.sessionPersistence.list()) {
        const read = await ctx.sessionQuery.readSession(row.header.id);
        sessions.push({ id: row.header.id, cwd: row.header.cwd, parentSession: row.header.parentSession,
          events: read.events, inheritedEventCount: read.inheritedEventCount });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sessions, workspaces: ctx.workspaceRegistry.list().map(w => ({ id: w.id, sessions: w.sessionIds })) }));
    } catch(e) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: e.message })); }
  } }));
}
`);
    const host = await bootHost(dshRoot, home, '/import-fixture/inspect', { env }); host.fixtureEnv = env; hosts.push(host);
  }
  const defaultImport = await hosts[0].request('/api-import/import', { target: 'dsh', items: [{ source: 'codex', sourcePath: sources[0] }] });
  result.defaultImport = defaultImport;
  const importA = () => hosts[0].request('/api-import/import', { target: 'dsh4', items: [{ source: 'codex', sourcePath: sources[0] }] });
  const importB = () => hosts[1].request('/dsh-codex-sync/import', {});
  const expected = [];
  const codexUnavailable = /skipping profile bundle "dsh-codex-sync".*incompatible with dsh/.test(hosts[1].readLog());
  result.codexCompatibility = codexUnavailable ? { status: 'rejected-by-host', version: metadata(codexRoot).version,
    reason: 'incompatible @deepseek-ai/dsh-mcp-client peer dependency; no version exemption granted' } : { status: 'loaded' };
  for (const [index, run] of [importA, codexUnavailable ? () => hosts[1].request('/import-fixture/create', {}) : importB].entries()) {
    const imported = await run();
    assert.equal(imported.ok, true, JSON.stringify(imported));
    if (index === 0) assert.equal(imported.results[0].status, 'imported', JSON.stringify(imported));
    const before = await inspect(hosts[index]);
    assert.equal(before.sessions.length, 1, JSON.stringify(imported));
    assert.ok(before.workspaces.some(w => w.sessions.includes(before.sessions[0].id)), 'Importer must attach the project');
    if (index === 0 || !codexUnavailable) {
      const repeated = await run(); assert.equal(repeated.ok, true, JSON.stringify(repeated));
      const after = await inspect(hosts[index]); assert.equal(after.sessions.length, 1);
      assert.deepEqual(after.sessions[0].events, before.sessions[0].events);
    }
    expected.push(before.sessions[0]);
    result.checks.push(index === 1 && codexUnavailable ? 'B: independent native session used for return transfer; codex-sync integration not passed' :
      result.packages[index].name + ': real public import route, durable host readback, project membership, repeated import creates no duplicate');
  }
  const remote = path.join(root, 'remote.git'); execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  const engines = hosts.map(host => {
    const engine = new SyncEngine(host.home, { remote, autoRepo: false, patches: false, workspaceSync: false,
      contentScope: { sessions: true, attachments: true, settings: false }, autoRestartAfterRepair: false });
    engine.verifyPrivateRemote = async () => ({ ok: true }); return acceptFixturePreviews(engine);
  });
  async function sync(index) {
    for (let round = 0; round < 4; round++) {
      const value = await engines[index].syncOnce('import-fixture', { forceCommit: true });
      assert.equal(value.error, undefined, JSON.stringify(value));
      if (!value.scopeWarnings?.length) return;
    }
    throw new Error('Host writes did not settle');
  }
  await sync(0); await sync(1); await sync(0);
  for (let i = 0; i < 2; i++) {
    const observed = await restart(i); assert.equal(observed.sessions.length, 2);
    for (const source of expected) {
      const read = observed.sessions.find(s => s.id === source.id); assert.ok(read);
      assert.deepEqual(read.events, source.events); assert.equal(read.cwd, source.cwd);
      assert.ok(observed.workspaces.some(w => w.sessions.includes(source.id)));
    }
  }
  result.checks.push('A → B → A production transport, imported and native IDs/events/projects preserved after both real hosts restart');
  await importA(); if (!codexUnavailable) await importB();
  for (const host of hosts) assert.equal((await inspect(host)).sessions.length, 2);
  result.checks.push('Repeat original imports after transport and restart still creates no duplicate');
  rollout(sources[0], expected[0].cwd, '导入源新增第二轮', true);
  const incremental = await importA(); assert.equal(incremental.ok, true, JSON.stringify(incremental));
  const changed = (await inspect(hosts[0])).sessions.find(s => s.id === expected[0].id);
  if (incremental.results[0].status === 'failed') {
    assert.match(incremental.results[0].error, /ctx\.sessionPersistence\.append is not a function/);
    assert.deepEqual(changed.events, expected[0].events, 'Rejected incremental import must preserve the stored conversation');
    result.incrementalCompatibility = { status: 'unsupported-public-interface', error: incremental.results[0].error };
  } else {
    assert.ok(changed.events.length > expected[0].events.length, JSON.stringify(incremental));
    result.incrementalCompatibility = { status: 'passed' };
  }
  await sync(0); await sync(1);
  const received = (await restart(1)).sessions.find(s => s.id === changed.id);
  assert.deepEqual(received.events, changed.events);
  result.checks.push(result.incrementalCompatibility.status === 'passed' ?
    'chat-import incremental append retains ID and transports the new turn to the other restarted host' :
    'chat-import incremental append rejected by missing public interface; original imported history remains unchanged on both hosts');
  fs.writeFileSync(path.join(root, 'acceptance.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidence: root }, null, 2));
} catch (e) {
  fs.writeFileSync(path.join(root, 'failure.json'), JSON.stringify({ ...result, error: e.message, stack: e.stack }, null, 2)); throw e;
} finally { for (const host of hosts) { fs.writeFileSync(path.join(host.home, 'boot.log'), host.readLog()); stopHost(host.child); } console.log('Evidence retained: ' + root); }
