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

/* 桌面端自动重启(0.12.15):同步后自查补登记会话的自动重启不再只认 Web 端 —— 桌面端也把
   allowForce 传给宿主重启脚本(脚本自己校验「发起者是 Desktop Host、要关的是 Desktop 主进程」)。
   本文件的安全约束:临时 home 里没有 restart-dsh-web.ps1,而桌面重启脚本一旦被调度就会真的关应用,
   因此这里只断言判定形状与非桌面宿主的 allowForce 关闭,绝不让用例走到调度成功路径。 */
test('auto restart after repair covers both hosts and only forces the desktop host', () => {
  if (process.platform !== 'win32') return;
  const originalArgv = process.argv;
  try {
    /* 非宿主(standalone/CLI):即使开了开关也不自动重启 */
    process.argv = ['node.exe', 'lib\\cli.mjs', 'sync'];
    const cli = new SyncEngine('C:\\unused');
    assert.equal(cli.autoRestartHost(), null);
    assert.equal(cli.scheduleRestartAfterRepair({ autoRestartAfterRepair: true }), false);

    /* Web 宿主:重启脚本在 <home> 下,这里刻意用临时 home(没有脚本)避免真的重启 */
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-restart-host-'));
    try {
      process.argv = ['node.exe', 'C:\\Users\\tanos\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js', 'web'];
      const web = new SyncEngine(home);
      assert.equal(web.autoRestartHost(), null, '临时 home 没有 restart-dsh-web.ps1,不应认为可自动重启');
      assert.equal(web.webRestartAvailable(), false);
      assert.equal(web.scheduleRestartAfterRepair({ autoRestartAfterRepair: true }), false);
    } finally {
      assert.equal(path.dirname(path.resolve(home)), path.resolve(os.tmpdir()));
      fs.rmSync(home, { recursive: true, force: true });
    }

    /* 桌面宿主:能否自动重启取决于随包分发的桌面重启脚本是否存在 */
    process.argv = ['DeepSeek Harness.exe', 'C:\\Programs\\DeepSeek Harness\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js', 'C:\\Programs\\dsh', 'C:\\Users\\tanos\\.dsh\\profiles\\desktop'];
    const desktop = new SyncEngine('C:\\unused');
    assert.equal(desktop.webRestartAvailable(), false);
    assert.equal(desktop.autoRestartHost(), desktop.desktopRestartAvailable() ? 'desktop' : null);
    assert.match(desktop.desktopRestartScript(), /restart-dsh-desktop\.ps1$/);
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
