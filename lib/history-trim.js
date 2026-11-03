// Keeps the transport copy's own history short. The remote keeps every version;
// this computer only needs the recent stretch that merging starts from.

export const TRIM_AT = 200; // commits on the sync branch before trimming
export const KEEP = 50; // commits kept after trimming

const isShallow = async engine => (await engine.git(['rev-parse', '--is-shallow-repository'])).out.trim() === 'true';

/**
 * Trim only when the copy matches the remote and nothing local is missing from it,
 * so every dropped version is still in the remote. Returns true when trimmed.
 * @param {any} engine transport-copy engine
 * @param {{ branch: string, remote?: string }} cfg
 */
export async function trimHistory(engine, cfg, { trimAt = TRIM_AT, keep = KEEP } = {}) {
  if (!cfg.remote) return false;
  const remoteRef = `refs/remotes/origin/${cfg.branch}`;
  const [head, remote] = [await engine.rev('HEAD'), await engine.rev(remoteRef)];
  if (!head || head !== remote) return false;
  const count = await engine.git(['rev-list', '--count', head]);
  if (!engine.ok(count) || Number(count.out.trim()) <= trimAt) return false;
  // Commits only a reflog still reaches would be lost with it; keep everything then.
  const unique = await engine.git(['rev-list', '--reflog', '--not', remoteRef]);
  if (!engine.ok(unique) || unique.out.trim()) return false;
  const fetched = await engine.git(
    ['fetch', '--quiet', `--depth=${keep}`, 'origin', `+refs/heads/${cfg.branch}:${remoteRef}`],
    180000,
  );
  if (!engine.ok(fetched)) return false;
  await engine.git(['reflog', 'expire', '--expire=now', '--all']);
  const gc = await engine.git(['gc', '--quiet', '--prune=now'], 600000);
  engine.log?.('info', `同步副本历史已缩短为最近 ${keep} 次${engine.ok(gc) ? '' : '（空间回收未完成）'}`);
  return true;
}

/**
 * A trimmed copy may not reach the point where two histories meet. Fetch the
 * full history once so ancestry and merge checks never mistake that for
 * unrelated histories.
 */
export async function ensureMergeBase(engine, a, b) {
  if (!a || !b || a === b || !(await isShallow(engine))) return true;
  if ((await engine.git(['merge-base', a, b])).code === 0) return true;
  const full = await engine.git(['fetch', '--quiet', '--unshallow', 'origin'], 600000);
  return engine.ok(full);
}
