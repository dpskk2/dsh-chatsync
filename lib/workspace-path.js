import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A project recorded under a user's home folder on Windows, macOS or Linux keeps
// its place relative to the home folder of this computer, whichever OS made it.
const HOME_ROOTS = [
  /^[A-Za-z]:[\\/]+Users[\\/]+[^\\/]+[\\/]+(.+)$/i,
  /^[\\/]Users[\\/]+[^\\/]+[\\/]+(.+)$/,
  /^[\\/]home[\\/]+[^\\/]+[\\/]+(.+)$/,
];

/** True when `target` is a complete directory under this OS's own rules. */
export function isLocalAbsolute(target, platformPath = path) {
  const value = String(target || '');
  return platformPath === path.win32
    ? /^(?:[A-Za-z]:[\\/]|\\\\[^\\]|\/\/[^/])/.test(value)
    : platformPath.isAbsolute(value);
}

/**
 * The folder this computer uses for a project recorded as `recorded`.
 * Returns null for a path another OS wrote that has no counterpart here
 * (for example `D:\work` read on macOS); the caller must not create it.
 * @param {string} recorded
 * @param {{ base?: string, home?: string, exists?: (p: string) => boolean, platformPath?: typeof path }} [options]
 */
export function mapWorkspacePath(
  recorded,
  { base = '', home = os.homedir(), exists = fs.existsSync, platformPath = path } = {},
) {
  if (!recorded) return null;
  const raw = String(recorded);
  const parts = rest => rest.split(/[\\/]+/).filter(Boolean);
  if (base.trim()) {
    const name = parts(raw).at(-1);
    return name ? platformPath.join(base.trim(), name) : null;
  }
  const local = isLocalAbsolute(raw, platformPath);
  const native = platformPath === path.win32 ? raw.replace(/\//g, '\\') : raw;
  if (local && exists(native)) return native;
  for (const pattern of HOME_ROOTS) {
    const match = pattern.exec(raw);
    if (match) return platformPath.join(home, ...parts(match[1]));
  }
  return local ? native : null;
}
