// A GUI executable must be waited on by a real process API. PowerShell's `&`
// may return before electron.exe exits, which cannot prove a test result.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
const executable = path.resolve(process.argv[2] || '');
assert.ok(process.argv[2] && fs.existsSync(executable), 'Missing Electron executable');
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_GUI_TEST_EXE: executable };
const versions = JSON.parse(execFileSync(executable, ['-p', 'JSON.stringify(process.versions)'],
  { env, encoding: 'utf8', windowsHide: true, timeout: 30000 }));
assert.equal(versions.electron, '44.7.0');
console.log('Desktop regression runtime: ' + JSON.stringify(versions));
const files = fs.readdirSync('tests').filter(file => file.endsWith('.test.mjs')).sort().map(file => path.join('tests', file));
// Reproduce the previously failing ASAR case first; it does not replace the full suite.
const asarProbe = ['--test', '--test-concurrency=1', '--test-timeout=45000', '--test-name-pattern=desktop Electron runtime', 'tests/issue6-workspace.test.mjs'];
for (const args of [asarProbe, ['--test', '--test-concurrency=2', '--test-timeout=300000', ...files], ['patch-version-agnostic-test.mjs']]) {
  console.log('Starting waited Electron phase: ' + args[0]);
  const started = Date.now();
  const result = spawnSync(executable, args, { env, windowsHide: true, stdio: 'inherit', timeout: args === asarProbe ? 60000 : 20 * 60 * 1000 });
  console.log('Electron phase terminated: ' + JSON.stringify({ phase: args[0], status: result.status, signal: result.signal, elapsedMs: Date.now() - started }));
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
