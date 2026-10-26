// Deterministic issue #4 investigation. Synthetic data and local bare Git only.
// Usage: node scripts/check-issue4-race.mjs [--tag v0.20.0] [--zstd]
// Assertions describe the current vulnerability; this is not a passing safety test.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { zstdCompressSync } from 'node:zlib';
import { removeFixture } from '../tests/helpers/fixture-cleanup.mjs';
import { acceptFixturePreviews } from '../tests/helpers/reviewed-sync.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2),
  tagIndex = args.indexOf('--tag');
const tag = tagIndex < 0 ? null : args[tagIndex + 1];
if (tagIndex >= 0 && !tag) throw new Error('--tag needs a Git reference');
const compressed = args.includes('--zstd');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-issue4-'));
const report = {
  timestamp: new Date().toISOString(),
  source: tag || 'working-tree',
  node: process.version,
  platform: process.platform,
  compressed,
  injection: 'separate Node process at deterministic write boundary',
  remote: 'local bare Git only; private-remote check substituted for fixture',
  checks: [],
};
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
try {
  let source = repo;
  if (tag) {
    report.commit = git(repo, 'rev-parse', tag + '^{commit}');
    source = path.join(root, 'source');
    fs.mkdirSync(source);
    const archive = path.join(root, 'source.tar');
    execFileSync('git', ['archive', '--format=tar', '--output=' + archive, tag], { cwd: repo, windowsHide: true });
    execFileSync('tar', ['-xf', archive, '-C', source], { windowsHide: true });
  } else report.commit = git(repo, 'rev-parse', 'HEAD');
  report.sourceHashes = Object.fromEntries(
    ['lib/sync.js', 'lib/merge.js'].map(file => [
      file,
      createHash('sha256')
        .update(fs.readFileSync(path.join(source, file)))
        .digest('hex'),
    ]),
  );
  const { SyncEngine } = await import(pathToFileURL(path.join(source, 'lib/sync.js')));
  const { mergeSessionLog, decodeZstdFrames } = await import(pathToFileURL(path.join(source, 'lib/merge.js')));
  const dshRoot = path.join(process.env.APPDATA, 'npm/node_modules/@deepseek-ai/dsh');
  const require = createRequire(path.join(dshRoot, 'lib/bin.js'));
  const { historicalSessionFormatCatalog } = await import(
    pathToFileURL(require.resolve('@deepseek-ai/dsh-session-format-catalog'))
  );
  report.codecDshVersion = JSON.parse(fs.readFileSync(path.join(dshRoot, 'package.json'))).version;
  const header = {
    type: 'session',
    version: 2,
    id: 'session-11111111-1111-1111-1111-111111111111',
    createdAt: 1,
    isSeeded: false,
    delegationDepth: 0,
  };
  const event = (seq, origin = 'base') => ({
    type: seq % 2 ? 'turn/end' : 'turn/start',
    seq,
    time: seq + 1,
    data:
      seq % 2 ? { turn: Math.floor(seq / 2) + 1, reason: { kind: 'completed' } } : { turn: Math.floor(seq / 2) + 1 },
    ...(origin === 'base' ? {} : { ignorable: true }),
  });
  const text = rows => rows.map(JSON.stringify).join('\n') + '\n';
  const encode = rows => (compressed ? zstdCompressSync(Buffer.from(text(rows))) : Buffer.from(text(rows)));
  const decode = buffer =>
    (compressed ? decodeZstdFrames(buffer) : buffer.toString('utf8')).split('\n').filter(Boolean).map(JSON.parse);
  const validate = buffer => {
    try {
      const rows = decode(buffer),
        restore = historicalSessionFormatCatalog.createRestore(rows[0], { recovery: 'strict', validation: 'current' });
      for (const row of rows.slice(1)) restore.decodeRow(row);
      return { ok: true, events: restore.finish().events.length };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  };
  const base = [header, ...Array.from({ length: 12 }, (_, seq) => event(seq))];
  assert.equal(validate(encode(base)).ok, true);
  const validLonger = [...base, event(12), event(13)];
  assert.equal(mergeSessionLog(encode(base), encode(validLonger)).value.equals(encode(validLonger)), true);
  report.checks.push({ name: 'idle-prefix-selection', safe: true, bytePreserving: true });
  const invalid = [...base, event(21)];
  assert.equal(validate(encode(invalid)).ok, false);
  assert.equal(mergeSessionLog(encode(base), encode(invalid)).ok, true);
  assert.equal(mergeSessionLog(encode(invalid), encode(invalid)).ok, true);
  report.checks.push({
    name: 'gap-validation-missing',
    badPrefixAccepted: true,
    identicalBadLogAccepted: true,
    hostCodec: validate(encode(invalid)),
  });
  const worker = path.join(root, 'append.mjs');
  fs.writeFileSync(
    worker,
    `import fs from 'node:fs';\nfs.appendFileSync(process.argv[2], fs.readFileSync(process.argv[3]));\n`,
  );
  function appendProducer(engine, rel, rows) {
    const batch = path.join(root, 'batch');
    fs.writeFileSync(batch, encode(rows));
    execFileSync(process.execPath, [worker, path.join(engine.home, rel), batch], { windowsHide: true });
  }
  async function scenario(name, diverged, race = true) {
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    const remote = path.join(dir, 'remote.git');
    git(dir, 'init', '--bare', remote);
    const make = name => {
      const home = path.join(dir, name);
      fs.mkdirSync(home);
      fs.writeFileSync(
        path.join(home, 'dsh-sync.json'),
        JSON.stringify({
          remote,
          autoRepo: false,
          workspaceSync: false,
          mode: 'auto',
          autoRestartAfterRepair: false,
          autoPullOnStart: false,
          autoPushOnExit: false,
          patches: false,
        }),
      );
      const engine = acceptFixturePreviews(new SyncEngine(home));
      engine.verifyPrivateRemote = async () => ({ ok: true });
      engine._activeSessionProbe = () => ({
        available: true,
        activeCount: 1,
        activeIds: [header.id],
        source: 'agents',
      });
      return engine;
    };
    const a = make('a'),
      b = make('b');
    const rel = 'sessions/example/' + header.id + '/session.v2.jsonl' + (compressed ? '.zstd' : '');
    const write = (engine, rows) => {
      const file = path.join(engine.home, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, encode(rows));
    };
    const read = engine => fs.readFileSync(path.join(engine.home, rel));
    const sync = async engine => {
      const r = await engine.syncOnce('interval', { forceCommit: true });
      assert.equal(r.error, undefined, JSON.stringify(r));
      return r;
    };
    write(a, base);
    await sync(a);
    await sync(b);
    write(a, [...base, event(12), event(13)]);
    const bRows = [...base, ...Array.from({ length: 10 }, (_, i) => event(i + 12))];
    if (diverged) bRows[13] = event(12, 'device-b');
    write(b, bRows);
    await sync(a);
    let injected = false;
    const newRows = Array.from({ length: 9 }, (_, i) => event(i + 22));
    const inject = () => {
      if (!race || injected) return;
      injected = true;
      appendProducer(b, rel, newRows);
      assert.equal(validate(read(b)).ok, true);
    };
    if (diverged) {
      const original = b.git.bind(b);
      b.git = async (args, ...rest) => {
        if (args[0] === 'checkout' && args[1] === '--ours' && args.includes(rel)) inject();
        return original(args, ...rest);
      };
    } else {
      const original = b._writeMerged.bind(b);
      b._writeMerged = (file, bytes) => {
        if (file === rel) inject();
        return original(file, bytes);
      };
    }
    const merge = await sync(b);
    assert.equal(injected, race);
    if (race) {
      assert.equal(decode(read(b)).filter(row => Number.isInteger(row.seq)).length, 22);
      appendProducer(b, rel, [event(31)]);
      assert.match(validate(read(b)).error, /seq gap \(expected 22, got 31\)/);
    } else assert.equal(validate(read(b)).ok, true);
    await sync(b);
    await sync(a);
    const result = {
      name,
      injected,
      activeDuringSync: b.sessionActivity({}).activeCount,
      mergeReportedError: merge.error || null,
      mergeWarning: merge.sessionWarnings?.[0]?.reason || null,
      localValidation: validate(read(b)),
      receiverValidation: validate(read(a)),
    };
    if (race) {
      assert.equal(read(a).equals(read(b)), true);
      const refs = git(b.home, 'for-each-ref', '--format=%(refname)', 'refs/heads/backup').split('\n').filter(Boolean);
      assert.ok(refs.length > 0);
      const commits = git(b.home, 'rev-list', '--all').split('\n');
      const lost = new Set(newRows.map(row => row.seq));
      for (const commit of commits) {
        try {
          const buffer = execFileSync('git', ['show', commit + ':' + rel], {
            cwd: b.home,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          for (const row of decode(buffer)) if (lost.has(row.seq)) throw new Error('Lost event unexpectedly backed up');
        } catch (error) {
          if (error.message === 'Lost event unexpectedly backed up') throw error;
        }
      }
      result.lostSeq = [22, 30];
      result.missingEvents = 9;
      result.backupBranches = refs.length;
      result.reachableCommitsChecked = commits.length;
      result.lostEventsAbsentFromReachableGitHistory = true;
      if (b.recovery)
        result.lostEventsAbsentFromConflictOriginals = b.recovery.list().every(record => {
          if (record.path !== rel) return true;
          const preview = b.recoveryPreview(record.id);
          return ['local', 'remote'].every(
            side =>
              !preview[side]?.text ||
              !preview[side].text
                .split('\n')
                .filter(Boolean)
                .map(JSON.parse)
                .some(row => lost.has(row.seq)),
          );
        });
    }
    report.checks.push(result);
  }
  await scenario('idle-merge-control', false, false);
  await scenario('prefix-write-race', false);
  await scenario('divergence-checkout-race', true);

  // Proposed stat+atomic-rename mitigation still has a check-to-use window.
  const file = path.join(root, 'rename-probe'),
    tmp = path.join(root, 'rename-probe.tmp');
  fs.writeFileSync(file, encode(base));
  fs.writeFileSync(tmp, encode(base));
  const before = fs.statSync(file),
    checked = fs.statSync(file);
  assert.equal(before.size, checked.size);
  assert.equal(before.mtimeMs, checked.mtimeMs);
  fs.writeFileSync(path.join(root, 'batch'), encode([event(12), event(13)]));
  execFileSync(process.execPath, [worker, file, path.join(root, 'batch')], { windowsHide: true });
  fs.renameSync(tmp, file);
  assert.equal(decode(fs.readFileSync(file)).length, base.length);
  report.checks.push({ name: 'stat-then-rename-race', checkPassed: true, appendedEventsOverwritten: 2 });
  report.completed = true;
} finally {
  const out = path.join(repo, 'outputs/issue-4-2026-10-07');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, (tag || 'working-tree') + (compressed ? '-zstd' : '-plain') + '.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ file, completed: report.completed || false, checks: report.checks }, null, 2));
  removeFixture(root);
}
