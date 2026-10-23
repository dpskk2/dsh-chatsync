import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDesktopHostProcess, isWebHostProcess } from './sync.js';
import { saveSyncStatus } from './session-safety.js';
import { windowsOutput } from './windows-output.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export function startExitSync(engine) {
  // Isolated tests and embedded non-host contexts must never start background jobs.
  if (!isDesktopHostProcess() && !isWebHostProcess()) return false;
  const configFile = path.join(os.tmpdir(), `dsh-exit-config-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(configFile, JSON.stringify(engine.overrides), { flag: 'wx' });
  const child = spawn(process.execPath, [path.join(here, 'exit-sync.mjs'), engine.home, String(process.pid), configFile], {
    detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  child.on('error', e => { saveSyncStatus(engine.home, { error: '退出上传未启动：' + e.message }, 'exit'); engine.log('warn', '退出上传未启动：' + e.message); try { fs.unlinkSync(configFile); } catch {} });
  child.unref();
  return true;
}

export function scheduleOfflineSync(engine, { runCommand = spawnSync, repair = false } = {}) {
  if (!isDesktopHostProcess()) return { scheduled: false, reason: '当前宿主不支持自动关闭后同步，请退出 DSH 后使用命令行同步。' };
  const script = path.resolve(here, '..', 'scripts', 'restart-dsh-desktop.ps1');
  const args = ['-NoProfile', '-WindowStyle Hidden', '-ExecutionPolicy Bypass', `-File "${script}"`, `-HostPid ${process.pid}`, '-AllowForce', `-SyncHome "${engine.home}"`, `-SyncCli "${path.join(here, repair ? 'data-repair-worker.mjs' : 'cli.mjs')}"`];
  if ([script, engine.home, here].some(p => /["\r\n]/.test(p))) return { scheduled: false, reason: '同步路径不能包含引号或换行。' };
  const task = `DSH-Sync-Startup-${process.pid}-${Date.now()}`;
  const identity = runCommand('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  const sid = identity.status === 0 && identity.stdout?.match(/S-\d-(?:\d+-)*\d+/)?.[0];
  if (!sid) return { scheduled: false, reason: '无法确认当前 Windows 用户，未安排关闭后同步。' };
  const configFile = path.join(os.tmpdir(), `dsh-startup-config-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(configFile, JSON.stringify({ ...engine.overrides, patches: false }), { flag: 'wx' });
  args.push(`-SyncConfig "${configFile}"`);
  args.push(`-TaskName "${task}"`);
  const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const xml = path.join(os.tmpdir(), task + '.xml');
  // schtasks /xml expects a BOM when reading Unicode task definitions. Without
  // it, Windows reads UTF-8 as UTF-16 and rejects the declaration at (1,40).
  fs.writeFileSync(xml, '\uFEFF' + `<?xml version="1.0" encoding="UTF-16"?><Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Principals><Principal id="Author"><UserId>${sid}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><ExecutionTimeLimit>PT15M</ExecutionTimeLimit><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries></Settings><Actions Context="Author"><Exec><Command>powershell.exe</Command><Arguments>${escape(args.join(' '))}</Arguments></Exec></Actions></Task>`, 'utf16le');
  let create;
  try { create = runCommand('schtasks', ['/create', '/tn', task, '/xml', xml, '/f'], { encoding: 'buffer', windowsHide: true, timeout: 15000 }); }
  finally { fs.unlinkSync(xml); }
  if (create.status !== 0) { fs.unlinkSync(configFile); return { scheduled: false, reason: '无法安排关闭后同步：' + (windowsOutput(create.stderr) || windowsOutput(create.stdout) || create.error?.message || '任务计划失败') }; }
  const run = runCommand('schtasks', ['/run', '/tn', task], { encoding: 'buffer', windowsHide: true, timeout: 15000 });
  if (run.status !== 0) {
    fs.unlinkSync(configFile);
    runCommand('schtasks', ['/delete', '/tn', task, '/f'], { windowsHide: true, timeout: 15000 });
    return { scheduled: false, reason: '无法启动关闭后同步任务：' + (windowsOutput(run.stderr) || windowsOutput(run.stdout) || run.error?.message || '任务启动失败') };
  }
  return { scheduled: true };
}
