import hostFs from 'node:fs';
import { createRequire } from 'node:module';

// Teardown deletes only validated, synthetic temp roots. Opaque .asar fixtures
// must be inspected as disk files, not as Electron virtual archive directories.
// Product code continues using the host's normal filesystem.
const fs = process.versions.electron ? createRequire(import.meta.url)('original-fs') : hostFs;
import os from 'node:os';
import path from 'node:path';

// Electron's bundled Windows runtime can refuse recursive removal of Git's
// readonly objects. Only teardown changes their permissions; product I/O keeps
// using the host's normal filesystem and every assertion still runs.
export function removeFixture(root) {
  const resolved = path.resolve(root),
    temp = fs.realpathSync(os.tmpdir());
  const inside = value => {
    const relative = path.relative(temp, value);
    return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  };
  if (!inside(resolved) || !/^(?:chatsync|dsh)-/.test(path.basename(resolved)))
    throw new Error('Refusing to remove a non-fixture root');
  if (!fs.existsSync(resolved)) return;
  if (fs.lstatSync(resolved).isSymbolicLink() || !inside(fs.realpathSync(resolved)))
    throw new Error('Refusing to follow a fixture root link');
  // Remove links before native recursive deletion. Electron's recursive remover
  // can otherwise traverse a Windows junction even when lstat identifies it.
  const unlinkChildren = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name),
        stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) fs.unlinkSync(file);
      else if (stat.isDirectory()) unlinkChildren(file);
    }
  };
  unlinkChildren(resolved);
  const options = { recursive: true, force: true, maxRetries: 3, retryDelay: 100 };
  try {
    fs.rmSync(resolved, options);
  } catch (error) {
    if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    const writable = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name),
          stat = fs.lstatSync(file);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) writable(file);
        else if (stat.isFile()) fs.chmodSync(file, 0o600);
      }
    };
    if (fs.existsSync(resolved)) {
      writable(resolved);
      fs.rmSync(resolved, options);
    }
  }
}
