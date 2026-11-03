// Per-file size limits a hosting site enforces on push. Only limits the site
// documents are listed; elsewhere a rejected push is reported by git-failure.js.
import fs from 'node:fs';
import { parseSyncRemote } from './remote.js';

const LIMITS = { 'github.com': 100 * 1024 * 1024 };

/** The site's single-file limit for `remote`, or null when none is known. */
export function hostFileLimit(remote) {
  const parsed = remote ? parseSyncRemote(remote) : null;
  const bytes = parsed ? LIMITS[parsed.host] : undefined;
  return bytes ? { bytes, label: `${parsed.label} ${bytes / 1048576} MB` } : null;
}

/**
 * Files new to the shared tree that the site would reject. Files already shared stay
 * in: leaving them out would read as a deletion on every other computer. Session logs
 * always go, so a rejected push reports them instead of silently dropping a session.
 * @param {string} home
 * @param {string[]} names data-directory relative paths about to be exported
 * @param {Set<string>} shared paths already in the shared tree
 * @param {{ bytes: number } | null} limit
 */
export function oversizedNewFiles(home, names, shared, limit) {
  if (!limit) return [];
  const result = [];
  for (const file of names) {
    if (shared.has(file) || /^sessions\//i.test(file)) continue;
    try {
      const size = fs.statSync(home + '/' + file).size;
      if (size > limit.bytes) result.push({ file, size });
    } catch {
      /* A file that vanished is handled by the ordinary export. */
    }
  }
  return result;
}
