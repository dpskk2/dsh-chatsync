import os from 'node:os';
import path from 'node:path';
import { SyncEngine } from './sync.js';
import { applyQueuedDataRepairs } from './data-health.js';
import { saveSyncStatus } from './session-safety.js';
const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
let result;
try {
  const engine = new SyncEngine(home, { autoRepo: false, patches: false });
  const repairs = await applyQueuedDataRepairs(engine);
  result = { repairs, repaired: true, message: '已完成确认过的数据修复；原件保留。' };
} catch (error) {
  result = { error: error.message };
  process.exitCode = 1;
}
saveSyncStatus(home, result, 'data-repair');
