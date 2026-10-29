// Real public persistence + two isolated hosts + local Git. No personal data,
// credentials, model calls, network repositories or installed plugin changes.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { profile, bootHost, stopHost, repo } from './native-fixture.mjs';
import { removeFixture } from '../tests/helpers/fixture-cleanup.mjs';

const desktop = process.argv.includes('--desktop');
const installation = path.join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness');
if (desktop && !process.versions.electron) {
  const child = spawn(
    path.join(installation, 'DeepSeek Harness.exe'),
    ['--expose-internals', fileURLToPath(import.meta.url), '--desktop'],
    { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
  );
  const timer = setTimeout(() => stopHost(child), 8 * 60 * 1000);
  const code = await new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  clearTimeout(timer);
  process.exit(code ?? 1);
}
const desktopRuntime = desktop ? path.join(installation, 'resources/app.asar/dsh') : null;
const dshRoot = desktop
  ? path.join(desktopRuntime, 'node_modules/@deepseek-ai/dsh')
  : path.resolve(process.argv[2] || path.join(process.env.APPDATA, 'npm/node_modules/@deepseek-ai/dsh'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-issue4-native-'));
const output = path.join(repo, 'outputs', 'issue-4-fix-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(output, { recursive: true });
const hosts = [];
const result = {
  ok: false,
  hostVersion: JSON.parse(fs.readFileSync(path.join(dshRoot, 'package.json'))).version,
  hostKind: desktop ? 'desktop' : 'web',
  node: process.versions.node,
  electron: process.versions.electron,
  physicalMachines: 1,
  hostProcesses: 2,
  remote: 'local bare Git; private visibility substituted only for synthetic fixture',
  checks: [],
};
const id = 'session-11111111-1111-1111-1111-111111111111';
const require = createRequire(path.join(dshRoot, 'lib/bin.js'));
try {
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  for (const name of ['a', 'b']) {
    const home = path.join(root, name),
      profileRoot = profile(home, ['@chatsync/issue4-fixture'], desktop ? 'desktop' : 'web');
    const driver = path.join(profileRoot, 'node_modules/@chatsync/issue4-fixture');
    fs.mkdirSync(driver, { recursive: true });
    fs.writeFileSync(
      path.join(driver, 'package.json'),
      JSON.stringify({
        name: '@chatsync/issue4-fixture',
        version: '1.0.0',
        type: 'module',
        main: './index.js',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }),
    );
    fs.writeFileSync(
      path.join(driver, 'cordis.patch.yml'),
      '- insert:\n    - id: chatsync-issue4-fixture\n      name: "@chatsync/issue4-fixture"\n',
    );
    fs.writeFileSync(
      path.join(driver, 'index.js'),
      `
import { SyncEngine } from ${JSON.stringify(pathToFileURL(path.join(repo, 'lib/sync.js')).href)};
export const inject = ['webServer', 'sessionPersistence', 'sessionQuery', 'workspaceRegistry'];
export function apply(ctx) {
  const engine = new SyncEngine(${JSON.stringify(home)}, { remote: ${JSON.stringify(remote)}, autoRepo: false,
    workspaceSync: false, contentScope: { sessions: true, attachments: false, settings: false },
    patches: false, autoRestartAfterRepair: false });
  engine.setHostContext(ctx); engine.verifyPrivateRemote = async () => ({ ok: true });
  const id = ${JSON.stringify(id)};
  let writer, injected = false;
  const event = seq => ({ type: seq % 2 ? 'turn/end' : 'turn/start', seq, time: seq + 1,
    data: seq % 2 ? { turn: Math.floor(seq / 2) + 1, reason: { kind: 'completed' } } : { turn: Math.floor(seq / 2) + 1 } });
  async function append(count) {
    const own = writer || await ctx.sessionPersistence.open(id, 'write');
    try { const read = await own.read(); await own.append(Array.from({ length: count }, (_, i) => event(read.events.length + i))); await own.flush(); }
    finally { if (!writer) await own.close(); }
  }
  async function inspect() {
    const handle = await ctx.sessionPersistence.open(id, 'read');
    try { const read = await handle.read(); return { events: read.events, header: handle.header, inheritedEventCount: handle.inheritedEventCount }; }
    finally { await handle.close(); }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/issue4-fixture', handler: async (req, res) => {
    try {
      let text = ''; for await (const chunk of req) text += chunk;
      const body = text ? JSON.parse(text) : {};
      let value;
      if (body.action === 'create') {
        const header = ctx.get('sessions').prepare(id, { meta: { cwd: ${JSON.stringify(path.join(root, 'project'))} } }).header;
        const handle = await ctx.sessionPersistence.create(header); await handle.flush(); await handle.close();
        await append(12); value = await inspect();
      } else if (body.action === 'hold') { writer = await ctx.sessionPersistence.open(id, 'write'); value = { held: true }; }
      else if (body.action === 'release') { await writer.close(); writer = null; value = { held: false }; }
      else if (body.action === 'append') { await append(body.count); value = await inspect(); }
      else if (body.action === 'sync') {
        if (body.injectAtMerge && engine._transport) {
          const mirror = engine._transport, original = mirror.git.bind(mirror);
          mirror.git = async (...args) => {
            if (args[0][0] === 'merge' && !injected) { injected = true; await append(9); }
            return original(...args);
          };
        }
        value = await engine.syncOnce('issue4-native', { forceCommit: true });
        for (let n = 0; n < 20 && value.needsReview; n++) value = await engine.syncOnce('issue4-native', { forceCommit: true, approval: value.review.id });
        value = { ...value, injected };
      } else if (body.action === 'inspect') value = await inspect();
      else if (body.action === 'query') { const read = await ctx.sessionQuery.readSession(id); value = { events: read.events }; }
      else value = { ready: true };
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, value }));
    } catch(error) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: error.stack })); }
  } }));
}
`,
    );
    hosts.push(await bootHost(dshRoot, home, '/issue4-fixture', { desktopRuntime }));
  }
  async function call(index, action, values = {}) {
    const reply = await hosts[index].request('/issue4-fixture', { action, ...values });
    assert.equal(reply.ok, true, JSON.stringify(reply));
    result.steps = [
      ...(result.steps || []),
      {
        index,
        action,
        count: reply.value.events?.length,
        error: reply.value.error,
        hint: reply.value.hint,
        deferred: reply.value.sessionDeferred,
        tail: reply.value.events?.slice(-2).map(e => ({ seq: e.seq, type: e.type })),
      },
    ];
    return reply.value;
  }
  const sync = async (index, options = {}) => {
    const value = await call(index, 'sync', options);
    assert.equal(value.error, undefined, JSON.stringify(value));
    return value;
  };
  await call(0, 'create');
  await sync(0);
  await sync(1);
  assert.equal((await call(1, 'inspect')).events.length, 12);
  result.checks.push(
    'A → B: current-format session imported through real public persistence, no raw filesystem writes',
  );
  await call(0, 'append', { count: 2 });
  await sync(0);
  await call(1, 'hold');
  const worker = `
    import { Context } from ${JSON.stringify(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)};
    import * as Persistence from ${JSON.stringify(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-persistence-jsonl')).href)};
    const ctx = new Context();
    const fiber = ctx.plugin(Persistence, { root: process.argv[1] });
    await fiber.await();
    let outcome;
    try { const handle = await ctx.get('sessionPersistence').open(process.argv[2], 'write'); await handle.close(); outcome = 'unexpected-write-owner'; }
    catch (error) { outcome = error.name; }
    await fiber.dispose(); process.stdout.write(JSON.stringify({ outcome }));
  `;
  const otherProcess = execFileSync(
    process.execPath,
    [
      ...(desktop ? ['--expose-internals'] : []),
      '--input-type=module',
      '-e',
      worker,
      path.join(hosts[1].home, 'sessions'),
      id,
    ],
    { windowsHide: true, encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(JSON.parse(otherProcess).outcome, 'SessionAlreadyOwnedError');
  result.checks.push('Independent process using the official JSONL backend is refused by the Windows writer lease');
  const blocked = await call(1, 'sync');
  assert.equal(blocked.sessionDeferred[0].reason, 'session-writer-held');
  assert.equal((await call(1, 'inspect')).events.length, 12);
  result.checks.push('Real resident write handle blocks sync mutation, even without an active model turn');
  await call(1, 'release');
  await sync(1);
  assert.equal((await call(1, 'inspect')).events.length, 14);
  result.checks.push('Release and retry appends the two remote events and passes host readback');
  await call(0, 'append', { count: 2 });
  await sync(0);
  const beforeRace = await call(1, 'append', { count: 8 });
  assert.equal(beforeRace.events.length, 22);
  await call(1, 'hold');
  const raced = await call(1, 'sync', { injectAtMerge: true });
  assert.equal(raced.injected, true, JSON.stringify(raced));
  assert.equal((await call(1, 'inspect')).events.length, 31);
  await call(1, 'append', { count: 1 });
  await call(1, 'release');
  await sync(1);
  await sync(0);
  for (let i = 0; i < 2; i++) {
    const value = await call(i, 'inspect');
    assert.deepEqual(
      value.events.map(e => e.seq),
      Array.from({ length: 32 }, (_, seq) => seq),
    );
    assert.deepEqual((await call(i, 'query')).events, value.events);
  }
  result.checks.push('Nine real host appends at Git merge boundary survive, followed by seq31 and B → A continuation');
  for (let i = 0; i < 2; i++) {
    const old = hosts[i];
    stopHost(old.child);
    hosts[i] = await bootHost(dshRoot, old.home, '/issue4-fixture', { desktopRuntime });
    assert.equal((await call(i, 'inspect')).events.length, 32);
  }
  result.checks.push('Both hosts restart and cold-read all 32 contiguous durable events');
  result.ok = true;
} catch (error) {
  result.error = error.stack;
  process.exitCode = 1;
} finally {
  for (const name of ['a', 'b']) {
    const bootLog = path.join(root, name, 'boot.log');
    if (fs.existsSync(bootLog)) fs.copyFileSync(bootLog, path.join(output, name + '-boot.log'));
  }
  for (const [i, host] of hosts.entries()) {
    fs.writeFileSync(path.join(output, 'host-' + i + '.log'), host.readLog());
    stopHost(host.child);
  }
  result.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, ...result }, null, 2));
  removeFixture(root);
}
