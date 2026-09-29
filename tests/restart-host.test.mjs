import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isWebHostProcess, isDesktopHostProcess, SyncEngine } from '../lib/sync.js';

test('the Web restart path is limited to the DSH Web host', () => {
  const bin = 'C:\\Users\\tanos\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js';
  assert.equal(isWebHostProcess(['node.exe', bin, 'web'], 'win32'), true);
  assert.equal(isWebHostProcess(['node.exe', bin, 'desktop'], 'win32'), false);
  assert.equal(isWebHostProcess(['DeepSeek Harness.exe', '--expose-internals', 'C:\\Users\\tanos\\.dsh\\profiles\\desktop'], 'win32'), false);
  assert.equal(isWebHostProcess(['node.exe', 'lib\\cli.mjs', 'web'], 'win32'), false);
  assert.equal(isWebHostProcess(['node', bin, 'web'], 'linux'), false);
  const desktop = ['DeepSeek Harness.exe', 'C:\\Programs\\DeepSeek Harness\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js', 'C:\\Programs\\dsh', 'C:\\Users\\tanos\\.dsh\\profiles\\desktop'];
  assert.equal(isDesktopHostProcess(desktop, 'win32'), true);
  assert.equal(isDesktopHostProcess(['node.exe', bin, 'web'], 'win32'), false);
});

test('standalone sync cannot schedule the Web restart task', () => {
  const engine = new SyncEngine('C:\\unused');
  assert.deepEqual(engine.scheduleRestart(), { scheduled: false, reason: 'unsupported-host' });
  assert.equal(engine.webRestartAvailable(), false);
});

test('desktop restart requires the explicit manual confirmation path', () => {
  if (process.platform !== 'win32') return;
  const originalArgv = process.argv;
  try {
    process.argv = ['DeepSeek Harness.exe', 'C:\\Programs\\DeepSeek Harness\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js', 'C:\\Programs\\dsh', 'C:\\Users\\tanos\\.dsh\\profiles\\desktop'];
    const engine = new SyncEngine('C:\\unused');
    assert.deepEqual(engine.scheduleRestart(), { scheduled: false, reason: 'desktop-confirmation-required' });
  } finally {
    process.argv = originalArgv;
  }
});

test('two host engines cannot sync the same DSH home at once', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cross-host-lock-'));
  try {
    const a = new SyncEngine(home);
    const b = new SyncEngine(home);
    let finish;
    a._syncOnce = () => new Promise((resolve) => { finish = resolve; });
    b._syncOnce = () => { throw new Error('second engine entered sync'); };
    const first = a.syncOnce();
    const blocked = await b.syncOnce();
    assert.match(blocked.error, /另一 DSH 进程正在同步/);
    finish({ pushed: false });
    await first;
    assert.equal(fs.existsSync(path.join(home, '.dsh-sync.process.lock')), false);
  } finally {
    assert.equal(path.dirname(path.resolve(home)), path.resolve(os.tmpdir()));
    assert.match(path.basename(home), /^dsh-cross-host-lock-/);
    fs.rmSync(home, { recursive: true, force: true });
  }
});
