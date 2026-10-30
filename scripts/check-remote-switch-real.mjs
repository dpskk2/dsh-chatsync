// Real end-to-end check of moving the sync repository from GitHub to another Git
// host (issue #12): two isolated installed Desktop Hosts, synthetic sessions and
// attachments, the connection endpoint the sync page uses, and real pushes to
// dedicated empty private test repositories. No private-repository stubs.
// Usage (Windows, PowerShell):
//   node scripts/check-remote-switch-real.mjs --github <https GitHub chatsync-acceptance-* repo>
//     --target <first empty private target repo> --mirror-target <second empty private target repo>
//     [--public <any public repository on the target host>]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { profile, bootHost, stopHost, repo } from './native-fixture.mjs';
import { SyncEngine } from '../lib/sync.js';
import { digest } from '../lib/recovery.js';
import { parseSyncRemote } from '../lib/remote.js';
import { scopeMirrorPath } from '../lib/scope.js';
import { acceptFixturePreviews } from '../tests/helpers/reviewed-sync.mjs';

if (process.platform !== 'win32') throw new Error('This check requires Windows and an installed Desktop runtime');
const installation = path.join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness');
const argv = process.argv.slice(2);
const option = name => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const remotes = {
  github: option('--github'),
  target: option('--target'),
  mirrorTarget: option('--mirror-target'),
  public: option('--public'),
};
for (const key of ['github', 'target', 'mirrorTarget']) {
  const parsed = parseSyncRemote(remotes[key]);
  if (!parsed || !/^chatsync-acceptance-/.test(parsed.repo) || parsed.transport !== 'https')
    throw new Error(`--${key} must be an HTTPS address of a dedicated chatsync-acceptance-* repository`);
}
if (parseSyncRemote(remotes.github).provider !== 'github') throw new Error('--github must be on github.com');
if (
  parseSyncRemote(remotes.target).provider === 'github' ||
  parseSyncRemote(remotes.mirrorTarget).provider === 'github'
)
  throw new Error('Targets must be on another Git host');

if (!process.versions.electron) {
  const child = spawn(
    path.join(installation, 'DeepSeek Harness.exe'),
    ['--expose-internals', fileURLToPath(import.meta.url), ...argv],
    { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
  );
  const timeout = setTimeout(
    () => {
      stopHost(child);
      process.exitCode = 1;
    },
    20 * 60 * 1000,
  );
  process.exitCode = await new Promise(resolve => child.once('exit', code => resolve(code ?? 1)));
  clearTimeout(timeout);
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const root = path.join(repo, 'outputs', 'remote-switch-real-' + stamp);
  fs.mkdirSync(root, { recursive: true });
  const runtimeDir = path.join(installation, 'resources/app.asar/dsh');
  const dshRoot = path.join(runtimeDir, 'node_modules/@deepseek-ai/dsh');
  const resolver = createRequire(path.join(dshRoot, 'lib/bin.js'));
  const moduleURL = name => pathToFileURL(resolver.resolve(name)).href;
  const evidence = {
    startedAt: new Date().toISOString(),
    physicalMachines: 1,
    hostKind: 'desktop',
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    dshVersion: JSON.parse(fs.readFileSync(path.join(dshRoot, 'package.json'), 'utf8')).version,
    pluginVersion: JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version,
    remotes: Object.fromEntries(Object.entries(remotes).map(([k, v]) => [k, v || null])),
    privateValidatorSubstituted: false,
    checks: [],
  };
  const check = text => {
    evidence.checks.push(text);
    console.log('✓ ' + text);
  };
  const homes = { a: path.join(root, 'a'), b: path.join(root, 'b') };
  const probe = new SyncEngine(root, { remote: remotes.github, autoRepo: false });
  probe.applyProxyEnv(probe.loadConfig());
  const heads = async (remote, helper) => {
    const args = helper ? ['-c', 'credential.helper=', '-c', 'credential.helper=' + helper] : [];
    const r = await probe._spawn('git', [...args, 'ls-remote', '--heads', remote], 120000, {
      useGitEnv: true,
      cwd: root,
    });
    assert.equal(probe.ok(r), true, `ls-remote ${remote}: ${r.err}`);
    return Object.fromEntries(
      r.out
        .split('\n')
        .filter(Boolean)
        .map(line => line.split('\t').reverse()),
    );
  };
  const GH = '!gh auth git-credential';
  let host;
  try {
    // —— Preconditions: dedicated, private and empty test repositories ——
    const ghRepo = parseSyncRemote(remotes.github);
    const view = await probe.gh(['repo', 'view', ghRepo.fullName, '--json', 'visibility']);
    assert.equal(JSON.parse(view.out).visibility, 'PRIVATE');
    for (const key of ['github', 'target', 'mirrorTarget']) {
      assert.deepEqual(await heads(remotes[key], key === 'github' ? GH : null), {}, key + ' must start empty');
      assert.deepEqual(await probe.verifyPrivateRemote(remotes[key]), { ok: true }, key + ' must be confirmed private');
    }
    check('Dedicated GitHub and target repositories are empty and pass the production private-repository check');

    // —— Two isolated Desktop profiles with a synthetic content driver ——
    for (const home of Object.values(homes)) {
      const profileRoot = profile(home, ['@chatsync/e2e-fixture'], 'desktop');
      const driver = path.join(profileRoot, 'node_modules/@chatsync/e2e-fixture');
      fs.mkdirSync(driver, { recursive: true });
      fs.writeFileSync(
        path.join(driver, 'package.json'),
        JSON.stringify({
          name: '@chatsync/e2e-fixture',
          version: '1.0.0',
          type: 'module',
          main: './index.js',
          dsh: { bundle: { patch: './cordis.patch.yml' } },
        }),
      );
      fs.writeFileSync(
        path.join(driver, 'cordis.patch.yml'),
        '- insert:\n    - id: chatsync-e2e-fixture\n      name: "@chatsync/e2e-fixture"\n',
      );
      fs.writeFileSync(
        path.join(driver, 'index.js'),
        `
import { randomUUID, createHash } from 'node:crypto';
import { createUserMessage } from ${JSON.stringify(moduleURL('@deepseek-ai/dsh-llm'))};
export const inject = ['webServer', 'sessions', 'sessionPersistence', 'sessionQuery', 'attachments'];
export function apply(ctx) {
  const respond = (res, value) => { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify(value)); };
  const body = req => new Promise(resolve => { let text=''; req.on('data', c => text += c); req.on('end', () => resolve(text ? JSON.parse(text) : {})); });
  ctx.effect(() => ctx.webServer.register({kind:'exact',path:'/e2e-fixture/create',handler:async(req,res)=>{
    try {
      const { label } = await body(req);
      const session=ctx.sessions.prepare('session-'+randomUUID(),{meta:{cwd:process.env.DSH_HOME}});
      const writer=await ctx.sessionPersistence.create(session.header);
      const detach=ctx.sessions.enter(session); ctx.effect(()=>detach); ctx.sessions.announce(session);
      const attachment=await ctx.attachments.saveFile({data:Buffer.from('attachment '+label),name:label+'.txt'});
      session.append('turn/start',{turn:1});
      session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'迁移验收 '+label},{type:'file',attachment}]}),{surfaceOp:'append'});
      session.append('turn/end',{turn:1,reason:{kind:'completed'}});
      await ctx.sessions.flush(session); await writer.close();
      respond(res,{ok:true,id:session.id});
    } catch(e){respond(res,{ok:false,error:e.message});}
  }}));
  ctx.effect(() => ctx.webServer.register({kind:'exact',path:'/e2e-fixture/inspect',handler:async(req,res)=>{
    try {
      const sessions=[];
      for(const stored of await ctx.sessionPersistence.list()) {
        const value=await ctx.sessionQuery.readSession(stored.header.id);
        if(!value) throw new Error('Public query cannot read '+stored.header.id);
        sessions.push({id:stored.header.id,events:value.events.length,hash:createHash('sha256').update(JSON.stringify(value.events)).digest('hex')});
      }
      respond(res,{ok:true,sessions:sessions.sort((a,b)=>a.id.localeCompare(b.id))});
    } catch(e){respond(res,{ok:false,error:e.message});}
  }}));
}
`,
      );
      fs.writeFileSync(
        path.join(home, 'dsh-sync.json'),
        JSON.stringify({
          mode: 'manual',
          enabled: false,
          lifecycleAutomation: 1,
          autoRepo: false,
          remote: remotes.github,
          workspaceSync: false,
          contentScope: { sessions: true, attachments: true, settings: false },
          autoRestartAfterRepair: false,
          autoPullOnStart: false,
          autoPushOnExit: false,
          patches: false,
        }),
      );
    }
    // The remote always comes from the profile's own dsh-sync.json, as saved by the sync page.
    const engines = Object.fromEntries(
      Object.entries(homes).map(([name, home]) => [name, acceptFixturePreviews(new SyncEngine(home))]),
    );
    const boot = home =>
      bootHost(dshRoot, home, '/e2e-fixture/inspect', {
        desktopRuntime: runtimeDir,
        env: { HOME: path.join(root, 'user') },
      });
    const withHost = async (name, fn) => {
      host = await boot(homes[name]);
      try {
        return await fn(host);
      } finally {
        fs.appendFileSync(path.join(root, name + '-host.log'), host.readLog());
        stopHost(host.child);
        host = undefined;
      }
    };
    const create = (name, label) =>
      withHost(name, async h => {
        const made = await h.request('/e2e-fixture/create', { label });
        assert.equal(made.ok, true, JSON.stringify(made));
        return made.id;
      });
    const sync = async name => {
      const result = await engines[name].syncOnce('e2e-remote-switch', { forceCommit: true, offlineApply: true });
      assert.equal(result.error, undefined, name + ': ' + JSON.stringify(result));
      assert.equal(result.downloadPending, undefined, name + ': ' + JSON.stringify(result));
      return result;
    };
    const connect = (name, remote, expectedRemote) =>
      withHost(name, async h => {
        const saved = await h.request('/dsh-sync/api/connection', { remote, expectedRemote });
        assert.equal(saved.ok, true, JSON.stringify(saved));
        assert.equal(saved.config.remote, remote);
        const config = await h.request('/dsh-sync/api/config');
        assert.deepEqual(config.config.remoteWeb, {
          url: parseSyncRemote(remote).webUrl,
          label: parseSyncRemote(remote).label,
        });
        return saved.hint;
      });
    const inspectAll = async () => {
      const seen = {};
      for (const name of Object.keys(homes))
        seen[name] = await withHost(name, async h => {
          const value = await h.request('/e2e-fixture/inspect');
          assert.equal(value.ok, true, JSON.stringify(value));
          return value.sessions;
        });
      return seen;
    };
    const attachments = home =>
      fs
        .readdirSync(path.join(home, 'attachments'), { recursive: true })
        .filter(file => fs.statSync(path.join(home, 'attachments', file)).isFile())
        .map(file => [file.split(path.sep).join('/'), digest(fs.readFileSync(path.join(home, 'attachments', file)))])
        .sort((a, b) => a[0].localeCompare(b[0]));
    const sameEverywhere = async count => {
      const seen = await inspectAll();
      assert.equal(seen.a.length, count, JSON.stringify(seen));
      assert.deepEqual(seen.a, seen.b);
      assert.deepEqual(attachments(homes.a), attachments(homes.b));
      return seen.a;
    };
    const tracked = async (name, remote) => {
      const cfg = { ...engines[name].loadConfig(), remote };
      const mirror = scopeMirrorPath(engines[name].home, cfg);
      return engines[name].rev('refs/remotes/origin/' + cfg.branch, path.join(mirror, '.git'), mirror);
    };

    // —— 1. Both computers sync through GitHub ——
    const ids = {};
    ids.a1 = await create('a', 'A1');
    await sync('a');
    ids.b1 = await create('b', 'B1');
    await sync('b');
    await sync('a');
    await sameEverywhere(2);
    const githubBefore = await heads(remotes.github, GH);
    assert.equal(githubBefore['refs/heads/main'], await tracked('a', remotes.github));
    check('A and B exchange two sessions with attachments through the real GitHub repository');

    // —— 2. A public repository on the target host is refused by the sync page ——
    if (remotes.public) {
      const configBefore = fs.readFileSync(path.join(homes.a, 'dsh-sync.json'));
      const refused = await withHost('a', h =>
        h.request('/dsh-sync/api/connection', { remote: remotes.public, expectedRemote: remotes.github }),
      );
      assert.equal(refused.ok, false);
      assert.match(refused.error, /原同步仓库未更改/);
      assert.deepEqual(fs.readFileSync(path.join(homes.a, 'dsh-sync.json')), configBefore);
      evidence.publicRefusal = refused.error;
      check('Sync page refuses the public repository on the target host and keeps the configuration: ' + refused.error);
    }

    // —— 3. Route one: switch to an empty target and carry the current content ——
    evidence.targetHint = await connect('a', remotes.target, remotes.github);
    check('A saves the target address through the sync page endpoint: ' + evidence.targetHint);
    ids.a2 = await create('a', 'A2');
    await sync('a');
    ids.b2 = await create('b', 'B2'); // written on B before it switches
    assert.deepEqual(await heads(remotes.github, GH), githubBefore, 'GitHub must not change after A switched');
    await connect('b', remotes.target, remotes.github);
    await sync('b');
    await sync('a');
    await sameEverywhere(4);
    const targetHeads = await heads(remotes.target);
    assert.equal(targetHeads['refs/heads/main'], await tracked('a', remotes.target));
    assert.deepEqual(await heads(remotes.github, GH), githubBefore, 'GitHub stays untouched after both switched');
    evidence.targetBranches = Object.keys(targetHeads).sort();
    check(
      'Route one: A then B switch to the empty target; all four sessions and attachments match on both; the target holds the checked commit; GitHub unchanged',
    );

    // —— 4. Route two: copy every GitHub branch into the second empty target, then switch ——
    const copy = path.join(root, 'copy.git');
    for (const args of [
      ['-c', 'credential.helper=', '-c', 'credential.helper=' + GH, 'clone', '--bare', remotes.github, copy],
      ['-C', copy, 'push', remotes.mirrorTarget, 'refs/heads/*:refs/heads/*'],
    ]) {
      const r = await probe._spawn('git', args, 300000, { useGitEnv: true, cwd: root });
      assert.equal(probe.ok(r), true, args.join(' ') + ': ' + r.err);
    }
    assert.deepEqual(await heads(remotes.mirrorTarget), githubBefore);
    check('Every GitHub branch copied into the second empty target with git clone --bare and push refs/heads/*');
    await connect('a', remotes.mirrorTarget, remotes.target);
    ids.a3 = await create('a', 'A3');
    await sync('a');
    await connect('b', remotes.mirrorTarget, remotes.target);
    await sync('b');
    await sync('a');
    await sameEverywhere(5);
    const mirrorHeads = await heads(remotes.mirrorTarget);
    for (const ref of Object.keys(githubBefore)) assert.ok(ref in mirrorHeads, ref + ' kept on the mirror target');
    assert.equal(mirrorHeads['refs/heads/main'], await tracked('a', remotes.mirrorTarget));
    evidence.mirrorBranches = Object.keys(mirrorHeads).sort();
    check(
      'Route two: both computers switch to the copied target and keep syncing; all five sessions match; every copied branch is still present',
    );

    evidence.sessions = ids;
    evidence.completedAt = new Date().toISOString();
    evidence.ok = true;
    fs.writeFileSync(path.join(root, 'acceptance.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ ok: true, root }, null, 2));
  } catch (error) {
    evidence.ok = false;
    evidence.error = error.message;
    evidence.stack = error.stack;
    fs.writeFileSync(path.join(root, 'acceptance-failed.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.error(JSON.stringify({ ok: false, root, error: error.message }));
    process.exitCode = 1;
  } finally {
    if (host) stopHost(host.child);
  }
}
