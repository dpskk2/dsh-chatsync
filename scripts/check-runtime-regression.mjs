// Capture terminal test results for standalone Node or installed Desktop's Node.
// Usage: node scripts/check-runtime-regression.mjs [--desktop]
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1 || (args[0] && args[0] !== '--desktop')) throw new Error('Use only --desktop or no arguments');
const desktop = args[0] === '--desktop';
if (desktop && process.platform !== 'win32') throw new Error('Installed Desktop acceptance requires Windows');
const executable = desktop ? path.join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness/DeepSeek Harness.exe') : process.execPath;
const prefix = desktop ? ['--expose-internals'] : [];
const env = { ...process.env };
if (desktop) env.ELECTRON_RUN_AS_NODE = '1'; else delete env.ELECTRON_RUN_AS_NODE;
// The Windows GUI invocation case needs the real GUI executable, as in run-desktop-regression.mjs.
if (desktop) env.DSH_GUI_TEST_EXE = executable;
const versions = spawnSync(executable, [...prefix, '-p', 'JSON.stringify(process.versions)'],
  { env, windowsHide: true, encoding: 'utf8', timeout: 10000 });
if (versions.status !== 0) throw new Error('Unable to inspect the chosen runtime');
const runtime = JSON.parse(versions.stdout);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const directory = path.join(repo, 'outputs', 'regression-' + stamp + (desktop ? '-desktop' : '-standalone'));
fs.mkdirSync(directory, { recursive: true });
console.log(JSON.stringify({ state: 'running', directory, node: runtime.node, electron: runtime.electron, desktop }));

async function run(name, commandArgs) {
  const logFile = path.join(directory, name + '.log');
  const fd = fs.openSync(logFile, 'wx');
  const child = spawn(executable, [...prefix, ...commandArgs], { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', bytes = 0, stoppedFor;
  const stop = reason => {
    stoppedFor = reason;
    if (child.exitCode === null && child.pid) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
      } else child.kill('SIGTERM');
    }
  };
  const interrupted = () => stop('interrupted');
  process.once('SIGINT', interrupted);
  // Real Git fault and recovery cases on Windows may exceed eight minutes.
  const timeout = setTimeout(() => stop('timeout'), 20 * 60 * 1000);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 5 * 1024 * 1024) { stop('output limit'); return; }
    fs.writeSync(fd, chunk); output += chunk.toString('utf8');
  });
  let failure;
  child.once('error', error => { failure = error.message; });
  const code = await new Promise(resolve => child.once('close', resolve));
  clearTimeout(timeout); process.removeListener('SIGINT', interrupted);
  fs.fsyncSync(fd); fs.closeSync(fd);
  return { code, stoppedFor, failure, logFile, output };
}

const files = fs.readdirSync(path.join(repo, 'tests')).filter(file => file.endsWith('.test.mjs')).sort().map(file => 'tests/' + file);
const started = Date.now();
const suite = await run('suite', ['--test', '--test-concurrency=2', ...files]);
const count = label => Number(suite.output.match(new RegExp('(?:^|\\n)ℹ ' + label + ' (\\d+)'))?.[1] ?? NaN);
const tests = count('tests'), passed = count('pass'), failed = count('fail'), cancelled = count('cancelled'), skipped = count('skipped');
const suiteOK = suite.code === 0 && !suite.stoppedFor && !suite.failure && Number.isInteger(tests) && tests > 0 && passed === tests && failed === 0 && cancelled === 0 && skipped === 0;
const patch = suiteOK ? await run('patch', ['tests/patch-version-agnostic.mjs']) : null;
const patchAssertions = patch ? Number(patch.output.match(/(\d+) 个断言全部通过/)?.[1] ?? NaN) : null;
const ok = suiteOK && patch.code === 0 && !patch.stoppedFor && !patch.failure && patchAssertions === 8;
const result = { ok, completedAt: new Date().toISOString(), elapsedSeconds: (Date.now() - started) / 1000,
  productVersion: JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version,
  productBuild: JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).chatsyncBuild, testFileConcurrency: 2,
  runtime: { node: runtime.node, electron: runtime.electron, platform: process.platform },
  suite: { code: suite.code, stoppedFor: suite.stoppedFor, failure: suite.failure, tests, passed, failed, cancelled, skipped, logFile: suite.logFile },
  patch: patch && { code: patch.code, stoppedFor: patch.stoppedFor, failure: patch.failure, assertions: patchAssertions, logFile: patch.logFile } };
fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exitCode = ok ? 0 : 1;
