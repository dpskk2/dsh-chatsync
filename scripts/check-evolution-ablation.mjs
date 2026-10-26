// Comparative diagnostics only. Ablations never modify product sources or profiles.
// Synthetic common workload, local bare Git, production privacy/review kept on.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { removeFixture } from '../tests/helpers/fixture-cleanup.mjs';
import { acceptFixturePreviews } from '../tests/helpers/reviewed-sync.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const variants = [
  'v0.20.0',
  'current',
  'without-handoff',
  'without-config-optimization',
  'without-preview-optimization',
  'current-repeat',
];
const git = (cwd, args) =>
  execFileSync('git', args, { cwd, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function workload(source, root, variant) {
  const { SyncEngine } = await import(pathToFileURL(path.join(source, 'lib/sync.js')));
  const counts = {},
    stages = [];
  const originalSpawn = SyncEngine.prototype._spawn;
  const verbs = new Set(['rev-parse', 'config', 'fetch', 'push', 'add', 'commit', 'diff', 'status', 'show']);
  SyncEngine.prototype._spawn = async function (command, args, ...rest) {
    const started = performance.now(),
      result = await originalSpawn.call(this, command, args, ...rest);
    const name = args.find(arg => verbs.has(arg)) || 'other';
    const entry = (counts[name] ||= { calls: 0, elapsedMs: 0 });
    entry.calls++;
    entry.elapsedMs += performance.now() - started;
    return result;
  };
  const remote = path.join(root, 'remote.git');
  git(root, ['init', '--bare', remote]);
  const projectA = path.join(root, 'projects-a', 'example'),
    projectB = path.join(root, 'projects-b', 'example');
  const make = name => {
    const home = path.join(root, name);
    fs.mkdirSync(path.join(home, 'skills'), { recursive: true });
    const engine = acceptFixturePreviews(
      new SyncEngine(home, {
        remote,
        autoRepo: false,
        mode: 'manual',
        workspaceSync: true,
        workspaceBase: path.join(root, 'projects-' + name),
        patches: false,
        autoRestartAfterRepair: false,
        autoPullOnStart: false,
        autoPushOnExit: false,
        gitUserName: 'ablation fixture',
        gitUserEmail: 'fixture@example.invalid',
      }),
    );
    engine.verifyPrivateRemote = async () => ({ ok: true });
    if (variant === 'without-handoff') engine.skipHandoff = true;
    return engine;
  };
  const a = make('a'),
    b = make('b');
  fs.mkdirSync(path.join(a.home, 'storages'));
  fs.mkdirSync(projectA, { recursive: true });
  fs.writeFileSync(
    path.join(a.home, 'storages/workspace.json'),
    JSON.stringify({
      tables: {
        workspaces: {
          'ablation-workspace': { path: projectA, title: 'example' },
        },
      },
    }),
  );
  fs.writeFileSync(path.join(a.home, '.credentials.yaml'), 'synthetic-local-only\n');
  fs.writeFileSync(path.join(a.home, 'skills/from-a.txt'), 'from a\n');
  fs.writeFileSync(path.join(projectA, 'note.txt'), 'initial\n');
  const round = async (engine, name) => {
    const started = performance.now(),
      result = await engine.syncOnce('test', { forceCommit: true });
    stages.push({ name, elapsedMs: performance.now() - started });
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.equal(result.workspaces.errors.length, 0, JSON.stringify(result.workspaces));
  };
  const started = performance.now();
  await round(a, 'a-upload');
  await round(b, 'b-receive');
  assert.equal(fs.readFileSync(path.join(projectB, 'note.txt'), 'utf8'), 'initial\n');
  assert.equal(fs.existsSync(path.join(b.home, '.credentials.yaml')), false);
  fs.writeFileSync(path.join(b.home, 'skills/from-b.txt'), 'from b\n');
  fs.writeFileSync(path.join(projectB, 'note.txt'), 'b edit\n');
  await round(b, 'b-upload');
  await round(a, 'a-receive');
  assert.equal(fs.readFileSync(path.join(a.home, 'skills/from-b.txt'), 'utf8'), 'from b\n');
  assert.equal(fs.readFileSync(path.join(projectA, 'note.txt'), 'utf8'), 'b edit\n');
  fs.writeFileSync(path.join(projectA, 'note.txt'), 'parallel a\n');
  fs.writeFileSync(path.join(projectB, 'note.txt'), 'parallel b\n');
  await round(a, 'a-parallel-upload');
  await round(b, 'b-parallel-merge');
  await round(a, 'a-final-receive');
  assert.equal(fs.readFileSync(path.join(projectA, 'note.txt'), 'utf8'), 'parallel b\n');
  assert.equal(fs.readFileSync(path.join(projectB, 'note.txt'), 'utf8'), 'parallel b\n');
  if (variant !== 'v0.20.0' && variant !== 'without-handoff') assert.equal(a.handoffStatus().receiptPublished, true);
  return {
    variant,
    ok: true,
    elapsedMs: performance.now() - started,
    stages,
    commands: counts,
    assertions: [
      'main roundtrip',
      'different workspace roots',
      'project roundtrip',
      'parallel conflict outcome',
      'local credentials excluded',
    ],
    sourceHashes: Object.fromEntries(
      ['lib/sync.js', 'lib/review.js']
        .filter(file => fs.existsSync(path.join(source, file)))
        .map(file => [file, hash(path.join(source, file))]),
    ),
  };
}

if (process.argv[2] === '--worker') {
  const [source, root, variant, output] = process.argv.slice(3);
  try {
    fs.writeFileSync(output, JSON.stringify(await workload(source, root, variant), null, 2));
  } catch (error) {
    fs.writeFileSync(output, JSON.stringify({ variant, ok: false, error: error.stack }, null, 2));
    process.exitCode = 1;
  }
} else {
  assert.equal(process.argv.length, 2, 'No arguments or explicit internal worker mode');
  const directory = path.join(repo, 'outputs', 'ablation-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(directory, { recursive: true });
  console.log(JSON.stringify({ state: 'running', directory }));
  const report = {
    createdAt: new Date().toISOString(),
    node: process.version,
    baselineCommit: git(repo, ['rev-parse', 'v0.20.0^{commit}']).trim(),
    scope: 'one Windows computer, synthetic directories, local Git; diagnostic ablations are not release acceptance',
    results: [],
  };
  for (const variant of variants) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-ablation-')),
      source = path.join(root, 'source');
    const output = path.join(directory, variant + '.json');
    try {
      fs.mkdirSync(source);
      if (variant === 'v0.20.0') {
        const archive = path.join(root, 'baseline.tar');
        git(repo, ['archive', '--format=tar', '--output=' + archive, 'v0.20.0']);
        execFileSync('tar', ['-xf', archive, '-C', source], { windowsHide: true });
      } else {
        fs.cpSync(path.join(repo, 'lib'), path.join(source, 'lib'), { recursive: true });
        fs.copyFileSync(path.join(repo, 'package.json'), path.join(source, 'package.json'));
        if (variant === 'without-config-optimization') {
          const file = path.join(source, 'lib/sync.js'),
            text = fs.readFileSync(file, 'utf8');
          const start = text.indexOf('    // Read every round so external edits'),
            end = text.indexOf('    // Session relations cannot', start);
          assert.ok(start >= 0 && end > start);
          const old =
            "    if (cfg.remote) {\n      await this.git(['config', 'remote.origin.fetch', '+refs/heads/' + cfg.branch + ':refs/remotes/origin/' + cfg.branch]);\n      await this.git(['config', 'credential.helper', parseSyncRemote(cfg.remote)?.provider === 'github' && await this.ghAvailable() ? '!gh auth git-credential' : 'manager']);\n    }\n    for (const [key, value] of Object.entries({ 'user.name': cfg.gitUserName, 'user.email': cfg.gitUserEmail, 'core.autocrlf': 'false', 'core.longpaths': 'true', 'core.safecrlf': 'false', 'commit.gpgsign': 'false' })) await this.git(['config', key, value]);\n";
          fs.writeFileSync(file, text.slice(0, start) + old + text.slice(end));
        }
        if (variant === 'without-preview-optimization') {
          const file = path.join(source, 'lib/review.js'),
            text = fs.readFileSync(file, 'utf8');
          const start = text.indexOf('  // Callers pass the immutable commit'),
            end = text.indexOf('  if (!to || to === before)', start);
          assert.ok(start >= 0 && end > start);
          fs.writeFileSync(
            file,
            text.slice(0, start) +
              "  const local = await engine.rev('HEAD', gitdir, root);\n  const remote = await engine.rev('refs/remotes/origin/' + branch, gitdir, root);\n  const before = direction === 'upload' ? remote : local;\n  const to = await engine.rev(target, gitdir, root);\n" +
              text.slice(end),
          );
        }
      }
      const child = spawn(
        process.execPath,
        [fileURLToPath(import.meta.url), '--worker', source, root, variant, output],
        { windowsHide: true, stdio: 'ignore' },
      );
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          if (process.platform === 'win32')
            execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          else child.kill('SIGKILL');
        } catch {}
      }, 180000);
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      clearTimeout(timer);
      const result = fs.existsSync(output)
        ? JSON.parse(fs.readFileSync(output))
        : { variant, ok: false, code, timedOut };
      result.code = code;
      result.timedOut = timedOut;
      if (code !== 0 || timedOut) result.ok = false;
      report.results.push(result);
      fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ variant, ok: result.ok, elapsedMs: result.elapsedMs, code, timedOut }));
    } finally {
      removeFixture(root);
    }
  }
  report.completedAt = new Date().toISOString();
  report.ok = report.results.length === variants.length && report.results.every(result => result.ok);
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
