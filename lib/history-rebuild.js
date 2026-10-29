// Clear the history of the sync branch: keep only the current content as one
// commit. Old history stays in a GitHub archive branch, never a local bundle.
// Every other computer must run a version that detects a rebuilt history, or it
// would merge the old history back and push it again.
import { LOCAL_DATA, digest } from './recovery.js';
import { CLEANUP_MIN_VERSION, mirrorOf, deviceBlockers } from './remote-cleanup.js';

export const HISTORY_BACKUPS = LOCAL_DATA + '/history-backups';

async function inspect(engine, deadline) {
  const mirror = mirrorOf(engine);
  const { cfg } = mirror;
  const git = args => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('检查同步仓库超时，请检查网络后重试。');
    return mirror.git(args, remaining);
  };
  // One advertisement covers the sync tip, backups and devices. Do not fetch
  // hundreds of old commits just to preview, or repeat a slow network query.
  const heads = await git(['ls-remote', '--heads', cfg.remote]);
  if (!engine.ok(heads)) {
    if (heads.timedOut) throw new Error('读取同步仓库分支超时，请检查网络后重新检查。');
    if (engine.isAuthError(heads.err)) throw new Error('无法验证同步仓库身份，请检查 GitHub 登录后重新检查。');
    throw new Error('无法读取同步仓库的分支，请检查网络与仓库访问权限后重新检查。');
  }
  const remoteHeads = heads.out
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [sha, ref] = line.trim().split(/\s+/);
      if (!/^[0-9a-f]{40,64}$/.test(sha) || !ref?.startsWith('refs/heads/'))
        throw new Error('同步仓库返回的分支信息无效，请重新检查。');
      return { sha, ref };
    });
  const tip = remoteHeads.find(h => h.ref === 'refs/heads/' + cfg.branch)?.sha;
  const head = await git(['rev-parse', '--verify', 'HEAD^{commit}']);
  if (!tip) throw new Error('还没有远端同步记录，请先同步一次。');
  if (!engine.ok(head) || head.out.trim() !== tip)
    throw new Error('这台电脑的同步副本和同步仓库不一致，请先同步一次再清除。');
  const status = await git(['--no-optional-locks', 'status', '--porcelain']);
  if (!engine.ok(status) || status.out.trim())
    throw new Error('这台电脑的同步副本还有未提交的改动，请先同步一次再清除。');
  const count = await git(['rev-list', '--count', tip]);
  if (!engine.ok(count) || !/^\d+$/.test(count.out.trim()))
    throw new Error('无法统计本机同步副本的提交记录，请先同步一次再检查。');
  const backupHeads = remoteHeads.filter(h => h.ref.startsWith('refs/heads/backup/'));
  const backupBranches = backupHeads.map(h => h.ref.slice('refs/heads/'.length)).sort();
  const shallow = await git(['rev-parse', '--is-shallow-repository']);
  if (!engine.ok(shallow)) throw new Error('无法检查本机同步副本是否完整，请重新检查。');
  return {
    mirror,
    tip,
    commits: Number(count.out.trim()) || 0,
    shallow: shallow.out.trim() === 'true',
    backupBranches,
    backupHeads,
    remoteHeads,
  };
}

/** What clearing the history would do, and the computers that must upgrade first. */
export async function previewHistoryRebuild(engine) {
  const deadline = Date.now() + 120000;
  const { mirror, tip, commits, shallow, backupBranches, backupHeads, remoteHeads } = await inspect(engine, deadline);
  const blockers = await deviceBlockers(engine, mirror, { deadline, remoteHeads });
  const previewId = digest(
    Buffer.from(JSON.stringify([tip, commits, backupHeads, blockers.map(b => [b.deviceId, b.reason])])),
  );
  return {
    ok: true,
    tip,
    commits,
    shallow,
    backupBranches,
    backupHeads,
    blockers,
    minVersion: CLEANUP_MIN_VERSION,
    previewId,
  };
}

/**
 * @param {any} engine
 * @param {{ previewId?: string, retiredDevices?: string[], deleteBackupBranches?: boolean }} [confirmation]
 */
export async function applyHistoryRebuild(
  engine,
  { previewId, retiredDevices = [], deleteBackupBranches = false } = {},
) {
  if (engine.inFlight) throw new Error('同步正在进行，请完成后再清除。');
  const release = engine.acquireProcessLock();
  if (!release) throw new Error('另一同步或恢复进程正在运行，请稍后再试。');
  try {
    const preview = await previewHistoryRebuild(engine);
    if (typeof previewId !== 'string' || previewId !== preview.previewId)
      throw new Error('同步仓库或其他电脑的状态已变化，请重新检查后再确认。');
    const retired = new Set(Array.isArray(retiredDevices) ? retiredDevices : []);
    const waiting = preview.blockers.filter(b => !retired.has(b.deviceId));
    if (waiting.length)
      throw new Error(
        `还有电脑不是 ${CLEANUP_MIN_VERSION} 或更新版本：${waiting.map(b => b.deviceName + '（' + b.reason + '）').join('、')}。请先在这些电脑上升级并同步一次。`,
      );
    if (preview.commits <= 1 && !preview.shallow && !(deleteBackupBranches && preview.backupBranches.length))
      return { ok: true, removedCommits: 0, backup: null, deletedBranches: [] };
    const { cfg, git } = mirrorOf(engine);
    const verified = await engine.verifyPrivateRemote(cfg.remote);
    if (!verified.ok) throw new Error(verified.error || '无法确认同步仓库为私有仓库，没有清除任何历史。');
    const unreferenced = await git(['rev-list', '--reflog', '--not', '--all']);
    if (!engine.ok(unreferenced) || unreferenced.out.trim())
      throw new Error('本机同步副本的恢复历史中还有未归档的独有提交，已停止清除并保留原件。');
    const remoteRef = `refs/remotes/origin/${cfg.branch}`;
    let backup = null,
      replaced = preview.tip;
    if (preview.commits > 1 || preview.shallow) {
      // 1. Preserve the already-remote tip on GitHub without downloading its parents.
      backup = 'archive/sync-history/' + Date.now() + '-' + preview.tip.slice(0, 12);
      const archived = await git(['push', cfg.remote, `${preview.tip}:refs/heads/${backup}`], 60000);
      if (!engine.ok(archived)) throw new Error('无法在 GitHub 保留旧历史，没有清除任何历史。');
      // 2. One commit holding exactly the current content.
      const created = await git([
        '-c',
        'user.name=' + cfg.gitUserName,
        '-c',
        'user.email=' + cfg.gitUserEmail,
        'commit-tree',
        preview.tip + '^{tree}',
        '-m',
        'ChatSync: 清除历史版本，只保留当前内容',
      ]);
      if (!engine.ok(created)) throw new Error('无法建立新的历史，没有清除任何历史。');
      replaced = created.out.trim();
      // 3. Replace the sync branch only if nobody pushed since the check.
      const pushed = await git(
        [
          'push',
          `--force-with-lease=refs/heads/${cfg.branch}:${preview.tip}`,
          cfg.remote,
          `${replaced}:refs/heads/${cfg.branch}`,
        ],
        600000,
      );
      if (!engine.ok(pushed))
        throw new Error('同步仓库在检查后有了新的改动，或无法上传；没有清除任何历史，旧历史已保留在 GitHub。');
      // 4. The transport copy follows; its tree is unchanged, so only the refs move.
      if (
        !engine.ok(await git(['update-ref', remoteRef, replaced])) ||
        !engine.ok(await git(['reset', '--soft', replaced]))
      )
        throw new Error('远端历史已清除，但本机同步副本未完成切换；请重新同步，本机原件保留。');
    }
    const deletedBranches = [];
    let branchError = null;
    if (deleteBackupBranches && preview.backupBranches.length) {
      // Each deletion is leased to the previewed tip too: a new backup must not
      // disappear merely because it reused an old branch name.
      const deleted = await git(
        [
          'push',
          '--atomic',
          ...preview.backupHeads.map(h => `--force-with-lease=${h.ref}:${h.sha}`),
          cfg.remote,
          ...preview.backupHeads.map(h => ':' + h.ref),
        ],
        300000,
      );
      if (engine.ok(deleted)) deletedBranches.push(...preview.backupBranches);
      else branchError = '同步前备份分支没有删除，可以稍后重试。';
    }
    // A successful push used to leave local backup/* refs pinning the entire
    // old pack. Drop only exact copies covered by the archived sync tip. Unique
    // local history, changed refs and other namespaces must remain untouched.
    let localCleanupError = null;
    if (backup) {
      for (const saved of preview.backupHeads) {
        const ancestor = await git(['merge-base', '--is-ancestor', saved.sha, preview.tip]);
        if (!engine.ok(ancestor)) continue;
        for (const ref of [saved.ref, saved.ref.replace('refs/heads/', 'refs/remotes/origin/')]) {
          const local = await git(['rev-parse', '--verify', '-q', ref]);
          if (
            engine.ok(local) &&
            local.out.trim() === saved.sha &&
            !engine.ok(await git(['update-ref', '-d', ref, saved.sha]))
          )
            localCleanupError = '远端历史已清除，但本机旧备份引用未清理完成，请重新检查。';
        }
      }
      if (
        !engine.ok(await git(['reflog', 'expire', '--expire=now', '--all'])) ||
        !engine.ok(await git(['gc', '--prune=now', '--quiet'], 600000))
      )
        localCleanupError = '远端历史已清除，但本机空间回收未完成，请重新检查。';
    }
    return {
      ok: true,
      removedCommits: preview.shallow ? null : Math.max(0, preview.commits - 1),
      commit: replaced,
      backup,
      deletedBranches,
      branchError,
      localCleanupError,
    };
  } finally {
    release();
  }
}
