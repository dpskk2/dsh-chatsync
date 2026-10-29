// Old history that only this computer's transport copy still holds: local refs
// the sync branch no longer reaches, e.g. backup branches left behind by an
// earlier clear. A ref is dropped only when GitHub provably holds its commit.
import { digest } from './recovery.js';
import { parseSyncRemote } from './remote.js';
import { mirrorOf } from './remote-cleanup.js';

const KEEP = /^refs\/(?:chatsync-devices\/|remotes\/origin\/HEAD$)/;

async function objectBytes(git, refs, tip) {
  const sizes = await git(['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objectsize:disk)']);
  if (sizes.code !== 0) return null;
  const disk = new Map();
  for (const line of sizes.out.split('\n').filter(Boolean)) {
    const [sha, size] = line.split(' ');
    disk.set(sha, Number(size) || 0);
  }
  const sum = async args => {
    const listed = await git(['rev-list', '--objects', ...args]);
    if (listed.code !== 0) return null;
    let bytes = 0;
    const seen = new Set();
    for (const line of listed.out.split('\n').filter(Boolean)) {
      const sha = line.split(' ')[0];
      if (seen.has(sha)) continue;
      seen.add(sha);
      bytes += disk.get(sha) || 0;
    }
    return bytes;
  };
  const totalBytes = [...disk.values()].reduce((a, b) => a + b, 0);
  const extra = {};
  for (const ref of refs) extra[ref.ref] = await sum([ref.sha, '--not', tip]);
  return { totalBytes, currentBytes: await sum([tip]), extra };
}

// GitHub holds `sha` when it is a branch tip there, an ancestor of a tip this
// copy also has, or, for GitHub remotes, an ancestor of a tip per the compare API.
async function remoteHolds(engine, git, remote, heads, sha) {
  if (heads.some(h => h.sha === sha)) return true;
  for (const h of heads)
    if ((await git(['cat-file', '-e', h.sha + '^{commit}'])).code === 0)
      if ((await git(['merge-base', '--is-ancestor', sha, h.sha])).code === 0) return true;
  const parsed = parseSyncRemote(remote);
  if (!parsed) return false;
  // Archives, backups and the sync branch; device receipts never hold old history.
  for (const h of heads.filter(h => !h.ref.startsWith('refs/heads/chatsync-device/'))) {
    const r = await engine.gh(['api', `repos/${parsed.fullName}/compare/${sha}...${h.sha}`, '--jq', '.behind_by']);
    if (engine.ok(r) && r.out.trim() === '0') return true;
  }
  return false;
}

/** Local refs pinning old history, their extra size and whether GitHub keeps them. */
export async function previewLocalHistory(engine) {
  const { cfg, git } = mirrorOf(engine);
  const tipRef = `refs/remotes/origin/${cfg.branch}`;
  const tip = await git(['rev-parse', '--verify', tipRef + '^{commit}']);
  if (!engine.ok(tip)) throw new Error('还没有远端同步记录，请先同步一次。');
  const listed = await git(['for-each-ref', '--format=%(refname) %(objectname)']);
  if (!engine.ok(listed)) throw new Error('无法读取本机同步副本的引用。');
  const refs = listed.out
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [ref, sha] = line.split(' ');
      return { ref, sha };
    })
    .filter(r => r.ref !== tipRef && r.ref !== 'refs/heads/' + cfg.branch && !KEEP.test(r.ref));
  const sizes = await objectBytes(git, refs, tip.out.trim());
  if (!sizes) throw new Error('无法统计本机同步副本的占用。');
  const heads = await git(['ls-remote', '--heads', cfg.remote], 60000);
  if (!engine.ok(heads)) throw new Error('无法读取 GitHub 上的分支，请检查网络后重新检查。');
  const remoteHeads = heads.out
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [sha, ref] = line.trim().split(/\s+/);
      return { sha, ref };
    });
  const items = [];
  for (const r of refs) {
    const backup = /^refs\/(?:heads|remotes\/origin)\/backup\//.test(r.ref);
    const kept = backup && (await remoteHolds(engine, git, cfg.remote, remoteHeads, r.sha));
    items.push({
      ref: r.ref,
      sha: r.sha,
      bytes: sizes.extra[r.ref] || 0,
      removable: kept,
      reason: kept ? '' : backup ? 'GitHub 上找不到这段历史，只有这台电脑有，保留' : '不是同步前备份，保留',
    });
  }
  // Reflogs may still name older commits. Each must stay reachable from a ref or
  // lie inside history GitHub holds; otherwise expiring them could lose work.
  const covered = items.filter(i => i.removable).map(i => i.sha);
  const unreferenced = await git(['rev-list', '--reflog', '--not', '--all', ...covered]);
  const reflogClean = engine.ok(unreferenced) && !unreferenced.out.trim();
  const previewId = digest(
    Buffer.from(JSON.stringify([tip.out.trim(), items.map(i => [i.ref, i.sha, i.removable]), reflogClean])),
  );
  return {
    ok: true,
    totalBytes: sizes.totalBytes,
    currentBytes: sizes.currentBytes,
    otherBytes: Math.max(0, sizes.totalBytes - sizes.currentBytes),
    refs: items,
    reflogClean,
    previewId,
  };
}

/**
 * Drop the previewed refs GitHub keeps, then release the space they pinned.
 * @param {any} engine
 * @param {{ previewId?: string }} [confirmation]
 */
export async function reclaimLocalHistory(engine, { previewId } = {}) {
  if (engine.inFlight) throw new Error('同步正在进行，请完成后再回收。');
  const release = engine.acquireProcessLock();
  if (!release) throw new Error('另一同步或恢复进程正在运行，请稍后再试。');
  try {
    const preview = await previewLocalHistory(engine);
    if (typeof previewId !== 'string' || previewId !== preview.previewId)
      throw new Error('本机同步副本或 GitHub 的状态已变化，请重新检查后再确认。');
    if (!preview.reflogClean) throw new Error('本机同步副本的恢复记录中还有未归档的独有提交，已停止回收并保留原件。');
    const { git } = mirrorOf(engine);
    const removed = [];
    for (const item of preview.refs.filter(i => i.removable))
      if (engine.ok(await git(['update-ref', '-d', item.ref, item.sha]))) removed.push(item.ref);
    // Every reflog entry was checked above; old entries would keep the pack alive.
    const expired = await git(['reflog', 'expire', '--expire=now', '--all']);
    const pruned = engine.ok(expired) && (await git(['gc', '--prune=now', '--quiet'], 600000));
    const after = pruned && engine.ok(pruned) ? await previewLocalHistory(engine) : null;
    return {
      ok: Boolean(after),
      removed,
      freedBytes: after ? Math.max(0, preview.totalBytes - after.totalBytes) : 0,
      totalBytes: after?.totalBytes ?? preview.totalBytes,
      error: after ? null : '已删除旧备份引用，但本机空间回收未完成，请稍后重新检查。',
    };
  } finally {
    release();
  }
}
