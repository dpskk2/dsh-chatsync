import fs from 'node:fs';
import path from 'node:path';

// Resolve junctions even when the final directory has not been created yet.
export function canonicalWorkspacePath(target) {
  let current = path.resolve(target),
    suffix = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    suffix.unshift(path.basename(current));
    current = parent;
  }
  const resolved = path.join(fs.realpathSync.native(current), ...suffix);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
