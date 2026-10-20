import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-startup-control-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, engine: new SyncEngine(home, { autoRepo: false, workspaceSync: false }) };
}

test('startup waits for an exit upload lock then continues without a false failure', async t => {
  const { home, engine: exit } = fixture(t), startup = new SyncEngine(home, { autoRepo: false, workspaceSync: false });
  let finish; exit._syncOnce = () => new Promise(resolve => { finish = resolve; });
  let ran = false; startup._syncOnce = async () => { ran = true; return { pushed: false }; };
  const upload = exit.syncOnce('exit');
  const opening = startup.syncOnce('startup', { waitForLock: true });
  await delay(30); assert.equal(ran, false); assert.equal(startup.progress.stage, 'wait-lock');
  finish({ pushed: true }); await upload;
  assert.equal((await opening).error, undefined); assert.equal(ran, true);
  assert.equal(fs.existsSync(path.join(home, '.dsh-sync.process.lock')), false);
});

test('cancel while waiting leaves the other process lock intact and permits a later retry', async t => {
  const { home, engine: owner } = fixture(t), startup = new SyncEngine(home, { autoRepo: false, workspaceSync: false });
  let finish; owner._syncOnce = () => new Promise(resolve => { finish = resolve; });
  startup._syncOnce = () => assert.fail('waiting startup must not enter sync');
  const upload = owner.syncOnce('exit');
  const lock = fs.readFileSync(path.join(home, '.dsh-sync.process.lock'));
  const opening = startup.syncOnce('startup', { waitForLock: true });
  await startup.cancelSync(); assert.equal((await opening).cancelled, true);
  assert.deepEqual(fs.readFileSync(path.join(home, '.dsh-sync.process.lock')), lock);
  finish({ pushed: true }); await upload;
  startup._syncOnce = async () => ({ pushed: false });
  assert.equal((await startup.syncOnce('startup', { waitForLock: true })).error, undefined);
});

test('manual cancel interrupts a real stalled Git network command and releases the process lock for retry', { timeout: 15000 }, async t => {
  const { home, engine } = fixture(t);
  engine.applyProxyEnv({});
  const original = Buffer.from('original session bytes'); fs.writeFileSync(path.join(home, 'original'), original);
  let connected; const arrived = new Promise(resolve => { connected = resolve; });
  const server = http.createServer((_req, _res) => connected());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const originalSync = engine._syncOnce;
  engine._syncOnce = async () => {
    const result = await engine.git(['-c', 'http.proxy=', 'ls-remote', `http://127.0.0.1:${server.address().port}/remote.git`], 60_000);
    assert.fail('cancelled network command must not continue: ' + JSON.stringify(result));
  };
  const opening = engine.syncOnce('web-button');
  await Promise.race([arrived, opening.then(result => { throw new Error('network ended before request: ' + JSON.stringify(result)); })]);
  const before = Date.now(); await engine.cancelSync();
  assert.equal((await opening).cancelled, true); assert.ok(Date.now() - before < 5000);
  assert.equal(fs.existsSync(path.join(home, '.dsh-sync.process.lock')), false);
  assert.deepEqual(fs.readFileSync(path.join(home, 'original')), original);
  engine._syncOnce = originalSync;
  assert.equal((await engine.syncOnce('web-button', { forceCommit: true })).error, undefined);
  assert.deepEqual(fs.readFileSync(path.join(home, 'original')), original);
  assert.equal(fs.existsSync(path.join(home, '.dsh-sync.process.lock')), false);
});

test('cancel allows a local operation to finish before releasing the lock', async t => {
  const { home, engine } = fixture(t); const marker = path.join(home, 'saved');
  engine._syncOnce = async () => {
    await engine._spawn(process.execPath, ['-e', `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'complete'),300)`], 10_000);
    assert.fail('must not start another operation after cancellation');
  };
  const opening = engine.syncOnce('startup');
  await delay(30); await engine.cancelSync();
  assert.equal((await opening).cancelled, true); assert.equal(fs.readFileSync(marker, 'utf8'), 'complete');
  assert.equal(fs.existsSync(path.join(home, '.dsh-sync.process.lock')), false);
});

test('Windows GUI sync invocation waits for its actual exit and returns its exit code', {
  skip: process.platform !== 'win32' || !process.env.DSH_GUI_TEST_EXE,
}, t => {
  const { home } = fixture(t), marker = path.join(home, 'done'), script = path.join(home, 'delayed sync.mjs');
  fs.writeFileSync(script, `import fs from 'node:fs';setTimeout(()=>{fs.writeFileSync(${JSON.stringify(marker)},'complete');process.exit(7)},400);`);
  const production = fs.readFileSync(new URL('../scripts/restart-dsh-desktop.ps1', import.meta.url), 'utf8');
  const invocation = production.match(/\$syncProcess = Start-Process[^\r\n]+\r?\n\s*\$syncExit =[^\r\n]+/)[0];
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const ps = path.join(home, 'check.ps1');
  fs.writeFileSync(ps, `$env:ELECTRON_RUN_AS_NODE='1'\n$exe=${quote(process.env.DSH_GUI_TEST_EXE)}\n$SyncCli=${quote(script)}\n${invocation}\nif ($syncExit -ne 7 -or -not (Test-Path -LiteralPath ${quote(marker)})) { exit 1 }\n`);
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps], { windowsHide: true, timeout: 15_000 });
  assert.equal(fs.readFileSync(marker, 'utf8'), 'complete');
});
