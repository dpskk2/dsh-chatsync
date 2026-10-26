import fs from 'node:fs';
import path from 'node:path';
import { validateSessionLog, mergeSessionLog } from './merge.js';
import { validateTransferSession } from './session-transfer.js';
import { sessionIdOfLogPath } from './session-path.js';

const read = file => {
  try {
    return fs.readFileSync(file);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
};
const equal = (a, b) => (a === null || b === null ? a === b : a.equals(b));

// No Git checkout/merge/reset is allowed to touch a live session. The same rule
// applies when an external CLI is invoked while a plugin host is still alive.
export function liveHosts(home) {
  const dir = path.join(home, '.dsh-sync-hosts');
  if (!fs.existsSync(dir)) return [];
  const alive = [];
  for (const file of fs.readdirSync(dir)) {
    if (!/^\d+\.json$/.test(file)) continue;
    const pid = Number(file.slice(0, -5));
    try {
      process.kill(pid, 0);
      alive.push(pid);
    } catch (e) {
      if (e.code !== 'ESRCH') alive.push(pid);
    }
  }
  return alive;
}

export function registerHost(home) {
  const dir = path.join(home, '.dsh-sync-hosts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid }));
  return () => {
    try {
      fs.unlinkSync(file);
    } catch {}
  };
}

export function saveSyncStatus(home, result, source) {
  const file = path.join(home, '.dsh-sync-status.json');
  const temp = file + `.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ at: Date.now(), hostPid: process.pid, source, result }), { flush: true });
  fs.renameSync(temp, file);
}

export function readSyncStatus(home) {
  try {
    return JSON.parse(fs.readFileSync(path.join(home, '.dsh-sync-status.json'), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

// An explicit offline startup is the only non-host path allowed to materialize
// logs. The normal live path still uses the public persistence writer lease.
export async function applyOfflineSession(engine, name, buffer, expected) {
  if (engine.ctx || liveHosts(engine.home).length)
    return { deferred: true, reason: 'host-running', hint: '还有宿主正在运行，已保留本机会话，关闭后重试' };
  try {
    await validateTransferSession(engine, name, buffer);
  } catch (error) {
    return {
      deferred: true,
      reason: 'invalid-session-semantics',
      hint: '会话未通过宿主格式校验，原件保留：' + error.message,
    };
  }
  const dest = targetPath(engine.home, name);
  const before = read(dest);
  if (!equal(before, expected))
    return { deferred: true, reason: 'local-session-ahead', hint: '取回期间本机会话发生变化，已保留原件' };
  const check = validateSessionLog(buffer);
  if (!check.ok) return { deferred: true, reason: check.reason, hint: '会话快照校验失败，已保留原件' };
  const header = JSON.parse(check.rows[0]);
  if (header.id !== sessionIdOfLogPath(name))
    return { deferred: true, reason: 'session-header-mismatch', hint: '会话身份与文件路径不一致，已保留原件' };
  if (!Number.isInteger(header.version) || header.version < 0 || header.version > 4)
    return {
      deferred: true,
      reason: 'unsupported-session-format',
      hint: '当前版本没有此会话格式的停机应用证据，已保留原件',
    };
  if (before) {
    const selected = mergeSessionLog(before, buffer);
    if (!selected.ok || !selected.value.equals(buffer))
      return { deferred: true, reason: 'divergent-session-history', hint: '会话历史无法严格接续，已保留双方原件' };
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const temp = dest + `.dsh-sync-${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, buffer, { flag: 'wx', flush: true });
    if (liveHosts(engine.home).length || !equal(read(dest), before))
      return { deferred: true, reason: 'host-running', hint: '应用前检测到新宿主或本地修改，已保留原件' };
    if (before === null) {
      fs.linkSync(temp, dest);
      fs.unlinkSync(temp);
    } else fs.renameSync(temp, dest);
    if (!fs.readFileSync(dest).equals(buffer)) throw new Error('停机会话应用读回不一致');
    return { applied: true, offline: true };
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch {}
  }
}

function targetPath(root, name) {
  const target = path.resolve(root, name);
  if (!target.startsWith(path.resolve(root) + path.sep) || name.split(/[\\/]/).some(s => s.toLowerCase() === '.git'))
    throw new Error('非法同步路径');
  // Refuse symlinks in both worktrees; remote files cannot escape the DSH home.
  for (let current = target; current !== path.resolve(root); current = path.dirname(current)) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('同步路径包含符号链接');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return target;
}
