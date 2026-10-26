import fs from 'node:fs';
import path from 'node:path';
import { atomicJson, digest } from './recovery.js';

export function readSyncConfig(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('必须是 JSON 对象');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error('同步配置无法读取，请修复 dsh-sync.json 后重试；原文件保留，未连接其他仓库。');
  }
}

export function writeSyncConfig(file, patch) {
  const value = { ...readSyncConfig(file), ...patch };
  if (path.basename(file) === 'dsh-sync.json' && fs.existsSync(file)) {
    const before = fs.readFileSync(file),
      dir = path.join(path.dirname(file), '.chatsync-local/config-history');
    fs.mkdirSync(dir, { recursive: true });
    const backup = path.join(dir, digest(before) + '.json');
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, before, { flag: 'wx', flush: true });
  }
  atomicJson(file, value);
  return value;
}
