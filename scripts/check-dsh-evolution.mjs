// Optional real-host acceptance using synthetic data only.
// Usage: node scripts/check-dsh-evolution.mjs <dsh-package-dir> [--serve] [--repair-offline] [--github-real <empty-test-repo-url>]
// --serve retains the two localhost hosts until this process receives Enter.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { profile, bootHost, stopHost, repo } from './native-fixture.mjs';
import { SyncEngine } from '../lib/sync.js';
import { parseSyncRemote } from '../lib/remote.js';
import { scopeMirrorPath } from '../lib/scope.js';
import { digest } from '../lib/recovery.js';
import { previewSessionRepair, repairSessionImport } from '../lib/session-repair.js';
import { acceptFixturePreviews } from '../tests/helpers/reviewed-sync.mjs';

const dshRoot = path.resolve(process.argv[2]);
if (process.argv.includes('--serve') && !process.stdin.isTTY)
  throw new Error('--serve needs an interactive terminal; omit it for automatic acceptance');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-evolution-native-'));
const resolver = createRequire(path.join(dshRoot, 'lib/bin.js'));
const moduleURL = name => pathToFileURL(resolver.resolve(name)).href;
const hosts = [];
const githubFlag = process.argv.indexOf('--github-real');
const githubRemote = githubFlag < 0 ? null : process.argv[githubFlag + 1];
const githubRepository = githubFlag < 0 ? null : parseSyncRemote(githubRemote);
if (
  githubFlag >= 0 &&
  (!githubRepository ||
    githubRepository.provider !== 'github' ||
    !/^https:\/\/github\.com\//.test(githubRemote) ||
    !/^chatsync-acceptance-/.test(githubRepository.repo))
) {
  throw new Error('--github-real requires a dedicated HTTPS GitHub chatsync-acceptance-* repository');
}
const previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
const result = {
  dshVersion: JSON.parse(fs.readFileSync(path.join(dshRoot, 'package.json'), 'utf8')).version,
  physicalMachines: 1,
  hostProcesses: 2,
  additionalFaultHostProcesses: 1,
  remote: githubRepository
    ? githubRemote
    : 'local Git bare fixture (private-remote check substituted only in this script)',
  checks: [],
};
try {
  const remote = path.join(root, 'remote.git');
  if (!githubRepository) execFileSync('git', ['init', '--bare', remote], { windowsHide: true, stdio: 'ignore' });
  const logicalRemote = githubRepository ? githubRemote : remote;
  if (githubRepository) {
    // Never upload to an existing personal sync store. Require the signed-in owner's
    // empty private repository, explicitly named and described for this acceptance.
    const probe = new SyncEngine(root, { remote: githubRemote, autoRepo: false });
    assert.equal(
      (await probe.ghLogin())?.toLowerCase(),
      githubRepository.owner.toLowerCase(),
      'Test repository must belong to the signed-in account',
    );
    const view = await probe.gh([
      'repo',
      'view',
      githubRepository.fullName,
      '--json',
      'nameWithOwner,visibility,description',
    ]);
    assert.equal(probe.ok(view), true, 'GitHub test repository metadata could not be read');
    const metadata = JSON.parse(view.out);
    assert.equal(metadata.nameWithOwner.toLowerCase(), githubRepository.fullName.toLowerCase());
    assert.equal(metadata.visibility, 'PRIVATE');
    assert.match(metadata.description || '', /ChatSync synthetic acceptance/);
    assert.equal(
      (await probe.verifyPrivateRemote(githubRemote)).ok,
      true,
      'Production private-repository validation failed',
    );
    probe.applyProxyEnv(probe.loadConfig());
    const refs = await probe.git([
      '-c',
      'credential.helper=',
      '-c',
      'credential.helper=!gh auth git-credential',
      'ls-remote',
      githubRemote,
    ]);
    assert.equal(probe.ok(refs), true, 'GitHub refs could not be queried');
    assert.equal(refs.out.trim(), '', 'Dedicated test repository must be empty');
    result.checks.push(
      'Real GitHub API confirms signed-in ownership and private visibility; actual Git confirms an empty dedicated test repository',
    );
  }
  for (const device of ['a', 'b']) {
    const home = path.join(root, device);
    const profileRoot = profile(home, ['@chatsync/native-fixture']);
    const driver = path.join(profileRoot, 'node_modules/@chatsync/native-fixture');
    fs.mkdirSync(driver, { recursive: true });
    fs.writeFileSync(
      path.join(driver, 'package.json'),
      JSON.stringify({
        name: '@chatsync/native-fixture',
        version: '1.0.0',
        type: 'module',
        main: './index.js',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }),
    );
    fs.writeFileSync(
      path.join(driver, 'cordis.patch.yml'),
      '- insert:\n    - id: chatsync-native-fixture\n      name: "@chatsync/native-fixture"\n',
    );
    // The driver only creates public-service fixtures in this isolated process.
    fs.writeFileSync(
      path.join(driver, 'index.js'),
      `
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createUserMessage } from ${JSON.stringify(moduleURL('@deepseek-ai/dsh-llm'))};
import { sessionFormatCatalog } from ${JSON.stringify(moduleURL('@deepseek-ai/dsh-session-format-catalog'))};
import { buildForkSeed } from ${JSON.stringify(moduleURL('@deepseek-ai/dsh-session'))};
import { releasedV3SessionFormatCodec } from ${JSON.stringify(moduleURL('@deepseek-ai/dsh-session-format-v2-to-v3'))};
import { RecoveryStore } from ${JSON.stringify(pathToFileURL(path.join(repo, 'lib/recovery.js')).href)};
import { SyncEngine } from ${JSON.stringify(pathToFileURL(path.join(repo, 'lib/sync.js')).href)};
import { importRecoverySession } from ${JSON.stringify(pathToFileURL(path.join(repo, 'lib/session-recovery.js')).href)};
export const inject = ['webServer', 'sessions', 'sessionPersistence', 'sessionQuery', 'workspaceRegistry', 'attachments'];
export function apply(ctx) {
  const home = process.env.DSH_HOME;
  const respond = (res, value) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/native-fixture/create', handler: async (_req, res) => {
    try {
      let requestText = ''; for await (const chunk of _req) requestText += chunk;
      const mode = JSON.parse(requestText || '{}').mode || 'closed';
      const cwd = path.join(home, 'fixture-project'); fs.mkdirSync(cwd, { recursive: true });
      const workspace = await ctx.workspaceRegistry.create(cwd, '隔离验收项目');
      const session = ctx.sessions.prepare('session-' + randomUUID(), { meta: { cwd } });
      const writer = await ctx.sessionPersistence.create(session.header);
      const detach = ctx.sessions.enter(session); ctx.effect(() => detach); ctx.sessions.announce(session);
      const attachment = await ctx.attachments.saveFile({ data: Buffer.from('attachment acceptance fixture'), name: '验收附件.txt' });
      const image = await ctx.attachments.saveImage({ data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWOwqThhU3GCAUIBACduBfEmgTN6AAAAAElFTkSuQmCC', 'base64'), mediaType: 'image/png', name: '验收图片.png' });
      session.append('turn/start', { turn: 1 });
      session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '隔离会话验收' }, { type: 'file', attachment }, { type: 'image', attachment: image }] }), { surfaceOp: 'append' });
      if (mode !== 'open') session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
      await ctx.sessions.flush(session); await writer.close(); await workspace.attachSession(session.id);
      let sourceId = session.id;
      if (mode === 'child') {
        const parentReader = await ctx.sessionPersistence.open(session.id, 'read');
        const parent = await parentReader.read(); await parentReader.close();
        const seed = buildForkSeed(parent.events, parent.events.length - 1);
        const child = ctx.sessions.prepare('session-' + randomUUID(), { seed, inheritedEventCount: parent.events.length,
          meta: { cwd, parentSession: session.id, isSeeded: true, origin: 'subagent', delegationDepth: 1 } });
        const childWriter = await ctx.sessionPersistence.create(child.header, { inheritedEventCount: child.inheritedEventCount });
        await childWriter.append(seed); await childWriter.flush(); await childWriter.close();
        await workspace.attachSession(child.id); sourceId = child.id;
      }
      const reader = await ctx.sessionPersistence.open(sourceId, 'read');
      const source = await reader.read(); await reader.close();
      const encodeHeader = mode === 'v3' ? releasedV3SessionFormatCodec.encodeHeader : sessionFormatCatalog.encodeCurrentHeader;
      const encodeEvent = mode === 'v3' ? releasedV3SessionFormatCodec.encodeEvent : sessionFormatCatalog.encodeCurrentEvent;
      const rows = [encodeHeader({ ...reader.header, version: mode === 'v3' ? 3 : reader.header.version, delegationDepth: reader.header.delegationDepth ?? 0 }, reader.inheritedEventCount), ...source.events.map(event => encodeEvent(event))];
      const bytes = Buffer.from(rows.map(row => JSON.stringify(row)).join('\\n') + '\\n');
      const stored = (await ctx.sessionPersistence.stat(sourceId));
      const files = fs.readdirSync(path.join(home, 'sessions'), { recursive: true }).filter(file => file.includes(sourceId) && /\\.jsonl(?:\\.zstd)?$/.test(file));
      const record = new RecoveryStore(home).save({ kind: 'main', status: 'merged', path: 'sessions/' + files[0].split(path.sep).join('/'), kept: 'local' }, { local: bytes, remote: bytes });
      respond(res, { ok: true, record, workspaceId: workspace.id, sourceId, eventCount: source.events.length, attachment, image, stored: !!stored,
        originalHash: createHash('sha256').update(fs.readFileSync(path.join(home, 'sessions', files[0]))).digest('hex') });
    } catch (e) { respond(res, { ok: false, error: e.message }); }
  } }));
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/native-fixture/inspect', handler: async (_req, res) => {
    try { const all = await ctx.sessionPersistence.list(); const tools = ctx.get('tools'); const sessions = [];
      for (const s of all) {
        const read = await ctx.sessionQuery.readSession(s.header.id);
        const files = fs.readdirSync(path.join(home, 'sessions'), { recursive: true }).filter(file => file.includes(s.header.id) && /\\.jsonl(?:\\.zstd)?$/.test(file));
        sessions.push({ id: s.header.id, cwd: s.header.cwd, parentSession: s.header.parentSession, origin: s.header.origin,
          inheritedEventCount: read.inheritedEventCount, eventCount: read.events.length, eventHash: createHash('sha256').update(JSON.stringify(read.events)).digest('hex'), tail: read.events.at(-1),
          fileHash: createHash('sha256').update(fs.readFileSync(path.join(home, 'sessions', files[0]))).digest('hex') });
      }
      respond(res, { ok: true,
      tools: ['sync_status', 'sync_preview', 'sync_doctor'].filter(name => tools?.get(name)),
      sessions, workspaces: ctx.workspaceRegistry.list().map(w => ({ id: w.id, sessions: w.sessionIds })) }); }
    catch (e) { respond(res, { ok: false, error: e.message }); }
  } }));
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/native-fixture/partial', handler: async (req, res) => {
    try {
      let text = ''; for await (const chunk of req) text += chunk;
      const request = JSON.parse(text), engine = new SyncEngine(home, { autoRepo: false });
      const persistence = ctx.sessionPersistence;
      const fault = { stat: (...args) => persistence.stat(...args), open: (...args) => persistence.open(...args),
        async create(...args) { const handle = await persistence.create(...args); let failed = false; return {
          header: handle.header, inheritedEventCount: handle.inheritedEventCount,
          read: (...args) => handle.read(...args), flush: () => handle.flush(), close: () => handle.close(),
          async append(batch) { if (failed && !request.partial) return handle.append(batch); failed = true;
            await handle.append(request.partial ? batch.slice(0, 1) : batch); await handle.flush(); throw new Error('fixture disk write failure'); },
        }; } };
      let error;
      try { await importRecoverySession(engine, { get: name => name === 'sessionPersistence' ? fault : ctx.get(name) }, request); }
      catch (e) { error = e.message; }
      const pending = engine.recovery.read(request.id).imports[request.side];
      let retried; try { retried = await importRecoverySession(engine, ctx, request); }
      catch (e) { respond(res, { ok: false, error: e.message, initialError: error, stat: await persistence.stat(pending.sessionId) }); return; }
      respond(res, { ok: true, error, pendingId: pending.sessionId, retried });
    } catch (e) { respond(res, { ok: false, error: e.message }); }
  } }));
}
`,
    );
    hosts.push(await bootHost(dshRoot, home, '/native-fixture/inspect'));
  }
  for (const host of hosts) {
    let partialRequest;
    for (const mode of ['closed', 'open', 'child', 'v3']) {
      const before = (await host.request('/native-fixture/inspect')).sessions.length;
      const fixture = await host.request('/native-fixture/create', { mode });
      assert.equal(fixture.ok, true, JSON.stringify(fixture));
      const preview = await host.request('/dsh-sync/api/recovery/preview', { id: fixture.record.id });
      assert.equal(preview.ok, true, JSON.stringify(preview));
      assert.equal(preview.sessionImport.available, true, JSON.stringify(preview.sessionImport));
      const request = {
        id: fixture.record.id,
        side: 'remote',
        expectedHash: fixture.record.versions.remote.sha256,
        workspaceId: fixture.workspaceId,
      };
      if (mode === 'closed') partialRequest = { ...request, side: 'local' };
      const imported = await host.request('/dsh-sync/api/recovery/import-session', request);
      assert.equal(imported.ok, true, JSON.stringify(imported));
      assert.notEqual(imported.sessionId, fixture.sourceId);
      assert.equal(imported.attachmentCount, 2);
      const repeated = await host.request('/dsh-sync/api/recovery/import-session', request);
      assert.equal(repeated.ok, true, JSON.stringify(repeated));
      assert.equal(repeated.sessionId, imported.sessionId);
      const observed = await host.request('/native-fixture/inspect');
      assert.equal(observed.ok, true, JSON.stringify(observed));
      assert.equal(observed.sessions.length, before + (mode === 'child' ? 3 : 2));
      const recovered = observed.sessions.find(s => s.id === imported.sessionId);
      assert.equal(recovered.parentSession, fixture.sourceId);
      assert.equal(recovered.inheritedEventCount, fixture.eventCount);
      assert.equal(recovered.origin, undefined, 'Recovered children must be independent top-level forks');
      assert.equal(observed.sessions.find(s => s.id === fixture.sourceId).fileHash, fixture.originalHash);
      if (mode === 'open') assert.equal(recovered.tail.data.reason.kind, 'forked');
      assert.equal(observed.tools.length, 3, 'Real host must register all three read-only tools');
      assert.ok(observed.workspaces.find(w => w.id === fixture.workspaceId).sessions.includes(imported.sessionId));
      result.checks.push(
        path.basename(host.home) +
          ': ' +
          mode +
          ' source → new fork, source unchanged, file + image verified, durable readback, inherited prefix, project membership, idempotent retry, three read-only tools registered',
      );
    }
    const partial = await host.request('/native-fixture/partial', partialRequest);
    assert.equal(partial.ok, true, JSON.stringify(partial));
    assert.match(partial.error, /fixture disk write failure/);
    assert.equal(partial.retried.ok, true);
    assert.equal(partial.retried.sessionId, partial.pendingId);
    result.checks.push(path.basename(host.home) + ': failure after durable append retries the same fork identity');
    await host.request('/dsh-sync/api/config', {
      contentScope: { sessions: true, attachments: true, settings: false },
    });
  }
  // A deliberately broken seeded prefix has no generic public rollback seam on this host.
  // Validate fail-closed behavior in a separate host; never add it to the roundtrip stores.
  const faultHome = path.join(root, 'persistent-fault');
  const faultProfile = profile(faultHome, ['@chatsync/native-fixture']);
  const faultDriver = path.join(faultProfile, 'node_modules/@chatsync/native-fixture');
  fs.mkdirSync(faultDriver, { recursive: true });
  const sourceDriver = path.join(hosts[0].home, 'profiles/web/node_modules/@chatsync/native-fixture');
  for (const file of ['package.json', 'cordis.patch.yml', 'index.js'])
    fs.copyFileSync(path.join(sourceDriver, file), path.join(faultDriver, file));
  const faultHost = await bootHost(dshRoot, faultHome, '/native-fixture/inspect');
  hosts.push(faultHost);
  const brokenFixture = await faultHost.request('/native-fixture/create', { mode: 'closed' });
  assert.equal(brokenFixture.ok, true, JSON.stringify(brokenFixture));
  const broken = await faultHost.request('/native-fixture/partial', {
    id: brokenFixture.record.id,
    side: 'local',
    partial: true,
    expectedHash: brokenFixture.record.versions.local.sha256,
    workspaceId: brokenFixture.workspaceId,
  });
  assert.equal(broken.ok, false);
  assert.match(broken.error, /stored log is corrupt/);
  const paused = await faultHost.request('/dsh-sync/api/run', {});
  assert.equal(paused.detail.error, 'session-import-pending', JSON.stringify(paused));
  const sourceFile = path.join(faultHome, brokenFixture.record.path);
  assert.equal((await import('../lib/recovery.js')).digest(fs.readFileSync(sourceFile)), brokenFixture.originalHash);
  result.checks.push(
    'Separate host: persistent partial seeded log is refused, source unchanged, synchronization paused before transmission; generic public API cannot roll it back',
  );
  if (process.argv.includes('--repair-offline')) {
    const engine = new SyncEngine(faultHome, { autoRepo: false });
    const plan = previewSessionRepair(engine, brokenFixture.record.id, 'local');
    await assert.rejects(repairSessionImport(engine, plan.planId, { offline: true }), /仍检测到 DSH/);
    for (const host of hosts) stopHost(host.child);
    const repaired = JSON.parse(
      execFileSync(
        process.execPath,
        [path.join(repo, 'lib/cli.mjs'), '--session-repair-apply', plan.planId, '--offline-dsh-closed'],
        { env: { ...process.env, DSH_HOME: faultHome }, encoding: 'utf8', windowsHide: true, timeout: 30000 },
      ),
    );
    assert.equal(repaired.ok, true, JSON.stringify(repaired));
    assert.equal(repaired.requiresHostReadback, true);
    assert.equal(engine.hasPendingSessionImport(), true);
    const rebootedFault = await bootHost(dshRoot, faultHome, '/native-fixture/inspect');
    hosts[hosts.length - 1] = rebootedFault;
    const pendingRun = await rebootedFault.request('/dsh-sync/api/run', {});
    assert.equal(pendingRun.detail.error, 'session-import-pending');
    const resumed = await rebootedFault.request('/dsh-sync/api/recovery/import-session', {
      id: brokenFixture.record.id,
      side: 'local',
      expectedHash: brokenFixture.record.versions.local.sha256,
      workspaceId: brokenFixture.workspaceId,
    });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(resumed.sessionId, repaired.sessionId);
    assert.equal(engine.hasPendingSessionImport(), false);
    assert.equal(digest(fs.readFileSync(sourceFile)), brokenFixture.originalHash);
    const recovered = await rebootedFault.request('/native-fixture/inspect');
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    const membership = recovered.workspaces.find(w => w.id === brokenFixture.workspaceId);
    assert.ok(membership.sessions.includes(resumed.sessionId));
    const repeated = await rebootedFault.request('/dsh-sync/api/recovery/import-session', {
      id: brokenFixture.record.id,
      side: 'local',
      expectedHash: brokenFixture.record.versions.local.sha256,
      workspaceId: brokenFixture.workspaceId,
    });
    assert.equal(repeated.sessionId, resumed.sessionId);
    result.checks.push(
      'Offline repair: running hosts refused; real CLI backs up and repairs only the known partial seed; restart/public readback validates the same identity and project, duplicate retry stable, original unchanged',
    );
    stopHost(rebootedFault.child);
    for (let index = 0; index < hosts.length - 1; index++) {
      hosts[index] = await bootHost(dshRoot, hosts[index].home, '/native-fixture/inspect');
    }
  }
  stopHost(faultHost.child);
  hosts.pop();
  // Run the production transport while real hosts own those same isolated stores.
  // Local fixtures cannot satisfy the production GitHub private-repo API check.
  const engines = hosts.map(host => {
    const engine = new SyncEngine(host.home, {
      remote: logicalRemote,
      autoRepo: false,
      patches: false,
      workspaceSync: false,
      contentScope: { sessions: true, attachments: true, settings: false },
      autoRestartAfterRepair: false,
    });
    if (!githubRepository) engine.verifyPrivateRemote = async () => ({ ok: true });
    return acceptFixturePreviews(engine);
  });
  const synchronize = async engine => {
    for (let i = 0; i < 4; i++) {
      const value = await engine.syncOnce('native-fixture', { forceCommit: true });
      if (!value.scopeWarnings?.length) return value;
      result.checks.push('Active host changed a local file during transfer; preserved it and retried');
    }
    throw new Error('Host writes did not settle within four fixture rounds');
  };
  const a = await synchronize(engines[0]);
  assert.equal(a.error, undefined, JSON.stringify(a));
  const b = await synchronize(engines[1]);
  assert.equal(b.error, undefined, JSON.stringify(b));
  let expectedSessions = 20;
  if (githubRepository) {
    const added = await hosts[1].request('/native-fixture/create', { mode: 'closed' });
    assert.equal(added.ok, true, JSON.stringify(added));
    const edited = await synchronize(engines[1]);
    assert.equal(edited.error, undefined, JSON.stringify(edited));
    expectedSessions++;
    result.checks.push(
      'B creates a new public-API session with file and image attachments after receiving A, then uploads to real GitHub',
    );
  }
  const back = await synchronize(engines[0]);
  assert.equal(back.error, undefined, JSON.stringify(back));
  result.checks.push('A upload → B receive + own additions → A receive with two real DSH processes running');
  for (let i = 0; i < hosts.length; i++) {
    const old = hosts[i];
    stopHost(old.child);
    hosts[i] = await bootHost(dshRoot, old.home, '/native-fixture/inspect');
    const observed = await hosts[i].request('/native-fixture/inspect');
    assert.equal(observed.ok, true, JSON.stringify(observed));
    assert.equal(observed.sessions.length, expectedSessions, JSON.stringify(observed));
    result.checks.push(
      path.basename(old.home) + ': restart reads all ' + expectedSessions + ' independently identified sessions',
    );
  }
  if (githubRepository) {
    const observed = await Promise.all(hosts.map(host => host.request('/native-fixture/inspect')));
    for (const value of observed) {
      assert.equal(value.ok, true);
      const registered = new Set(value.workspaces.flatMap(w => w.sessions || []));
      for (const session of value.sessions)
        assert.ok(registered.has(session.id), 'Transferred session must retain its project membership');
      assert.deepEqual([...value.tools].sort(), ['sync_doctor', 'sync_preview', 'sync_status']);
    }
    const sessionContent = value =>
      value.sessions
        .map(s => [s.id, s.eventCount, s.eventHash, s.inheritedEventCount])
        .sort((a, b) => a[0].localeCompare(b[0]));
    assert.deepEqual(
      sessionContent(observed[0]),
      sessionContent(observed[1]),
      'Restarted hosts must read identical session identities and event content',
    );
    const attachmentContent = home => {
      const base = path.join(home, 'attachments'),
        entries = [];
      const visit = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const file = path.join(dir, entry.name);
          if (entry.isDirectory()) visit(file);
          else if (entry.isFile())
            entries.push([path.relative(base, file).split(path.sep).join('/'), digest(fs.readFileSync(file))]);
        }
      };
      visit(base);
      return entries.sort((a, b) => a[0].localeCompare(b[0]));
    };
    assert.deepEqual(
      attachmentContent(hosts[0].home),
      attachmentContent(hosts[1].home),
      'All transferred attachment bytes must match',
    );
    const cfg = engines[0].loadConfig();
    const mirror = scopeMirrorPath(engines[0].home, cfg);
    const head = await engines[0].rev(cfg.branch, path.join(mirror, '.git'), mirror);
    assert.match(head || '', /^[0-9a-f]{40,64}$/);
    const ref = await engines[0].gh([
      'api',
      'repos/' + githubRepository.fullName + '/git/ref/heads/' + cfg.branch,
      '--jq',
      '.object.sha',
    ]);
    assert.equal(engines[0].ok(ref), true, 'Real GitHub API could not read the uploaded branch');
    assert.equal(ref.out.trim(), head, 'GitHub API commit must match the checked transfer commit');
    result.github = {
      fullName: githubRepository.fullName,
      private: true,
      productionValidation: true,
      commit: head,
      sessionsPerHost: expectedSessions,
      attachmentFiles: attachmentContent(hosts[0].home).length,
    };
    result.checks.push(
      'GitHub API reads the actual transfer commit; restarted hosts have identical session events and attachment bytes',
    );
  }
  fs.writeFileSync(
    path.join(root, 'acceptance.json'),
    JSON.stringify({ ...result, hosts: hosts.map(h => ({ home: h.home, url: h.url })) }, null, 2),
  );
  console.log(JSON.stringify({ ...result, evidence: root, urls: hosts.map(h => h.url) }, null, 2));
  if (process.argv.includes('--serve')) {
    console.log('Browser acceptance hosts ready; press Enter to stop only these fixture processes.');
    process.stdin.resume();
    await new Promise(resolve => process.stdin.once('data', resolve));
    process.stdin.pause();
  }
} catch (error) {
  fs.writeFileSync(
    path.join(root, 'acceptance-failed.json'),
    JSON.stringify({ ...result, error: error.message }, null, 2),
  );
  throw error;
} finally {
  for (const host of hosts) stopHost(host.child);
  if (previousGlobalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
  console.log('Evidence retained: ' + root);
}
