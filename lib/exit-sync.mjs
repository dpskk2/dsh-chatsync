// A separate process survives a normal host exit. It never rewrites live logs.
import fs from 'node:fs';
import { SyncEngine } from './sync.js';
import { saveSyncStatus } from './session-safety.js';

const [home, parentId, configFile] = process.argv.slice(2);
if (!home || !/^\d+$/.test(parentId || '')) throw new Error('缺少宿主退出同步参数');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let exited = false;
for (let i = 0; i < 90; i++) {
  try { process.kill(Number(parentId), 0); }
  catch (e) { if (e.code === 'ESRCH') { exited = true; break; } }
  await wait(500);
}
let result;
try {
  if (!exited) throw new Error('DSH 尚未退出；待上传改动保留，下次启动时重试。');
  const overrides = configFile ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
  const engine = new SyncEngine(home, overrides, () => {});
  result = await engine.syncOnce('exit', { forceCommit: true, uploadOnly: true, waitForLock: true });
} catch (e) { result = { error: e.message }; }
finally { if (configFile) { try { fs.unlinkSync(configFile); } catch {} } }
saveSyncStatus(home, result, 'exit');
if (result.error || result.cancelled || result.deferred || result.downloadPending || result.workspaces?.errors?.length) process.exitCode = 1;
