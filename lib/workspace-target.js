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

/** Validate the existing portion of a proposed directory without creating it. */
export function checkWorkspaceDirectory(target) {
  const resolved = path.resolve(target);
  let current = resolved;
  for (;;) {
    let status;
    try {
      status = fs.statSync(current, { throwIfNoEntry: false });
    } catch (error) {
      if (error.code === 'ENOTDIR') throw new Error('路径中有文件，请选择项目文件夹。');
      throw error;
    }
    if (status) {
      if (!status.isDirectory()) throw new Error('路径指向文件，请选择项目文件夹。');
      return { canonical: canonicalWorkspacePath(resolved), exists: current === resolved };
    }
    const parent = path.dirname(current);
    if (parent === current) throw new Error('本机无法访问这个盘符或共享位置，请检查后重试。');
    current = parent;
  }
}

export function workspacePathsOverlap(a, b) {
  const inside = (candidate, root) => {
    const relative = path.relative(root, candidate);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  };
  return inside(a, b) || inside(b, a);
}
