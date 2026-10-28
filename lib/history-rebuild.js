// Clear the history of the sync branch: keep only the current content as one
// commit. The full old history is first saved on this computer as a Git bundle.
// Every other computer must run a version that detects a rebuilt history, or it
// would merge the old history back and push it again.
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL_DATA, safePath, digest } from './recovery.js';
import { CLEANUP_MIN_VERSION, mirrorOf, deviceBlockers } from './remote-cleanup.js';

export const HISTORY_BACKUPS = LOCAL_DATA + '/history-backups';

async function inspect(engine) {
  const mirror = mirrorOf(engine);
  const { cfg, git } = mirror;
  const remoteRef = `refs/remotes/origin/${cfg.branch}`;
  const fetched = await git(['fetch', '--quiet', 'origin', `+refs/heads/${cfg.branch}:${remoteRef}`]);
  if (!engine.ok(fetched)) throw new Error('无法读取同步仓库，请检查网络后重试。');
  const tip = await git(['rev-parse', '--verify', remoteRef + '^{commit}']);
  const head = await git(['rev-parse', '--verify', 'HEAD^{commit}']);
  if (!engine.ok(tip)) throw new Error('还没有远端同步记录，请先同步一次。');
  if (!engine.ok(head) || head.out.trim() !== tip.out.trim())
    throw new Error('这台电脑的同步副本和同步仓库不一致，请先同步一次再清除。');
  const count = await git(['rev-list', '--count', tip.out.trim()]);
  const heads = await engine.git(['ls-remote', '--heads', cfg.remote, 'refs/heads/backup/*'], 60000);
  if (!engine.ok(count) || !engine.ok(heads)) throw new Error('无法读取同步仓库的历史。');
  const backupBranches = heads.out
    .split('\n')
    .map(line => line.split('\t')[1]?.replace(/^refs\/heads\//, ''))
    .filter(Boolean)
    .sort();
  return { mirror, tip: tip.out.trim(), commits: Number(count.out.trim()) || 0, backupBranches };
}

/** What clearing the history would do, and the computers that must upgrade first. */
export async function previewHistoryRebuild(engine) {
  const { mirror, tip, commits, backupBranches } = await inspect(engine);
  const blockers = await deviceBlockers(engine, mirror);
  const previewId = digest(
    Buffer.from(JSON.stringify([tip, commits, backupBranches, blockers.map(b => [b.deviceId, b.reason])])),
  );
  return { ok: true, tip, commits, backupBranches, blockers, minVersion: CLEANUP_MIN_VERSION, previewId };
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
    if (preview.commits <= 1 && !(deleteBackupBranches && preview.backupBranches.length))
      return { ok: true, removedCommits: 0, backup: null, deletedBranches: [] };
    const { cfg, git } = mirrorOf(engine);
    const remoteRef = `refs/remotes/origin/${cfg.branch}`;
    let backup = null,
      replaced = preview.tip;
    if (preview.commits > 1) {
      // 1. The whole old history, saved on this computer.
      const folder = safePath(engine.home, HISTORY_BACKUPS);
      fs.mkdirSync(folder, { recursive: true });
      const name = new Date().toISOString().replace(/[:.]/g, '-') + '-' + preview.tip.slice(0, 12) + '.bundle';
      const file = path.join(folder, name);
      const bundled = await git(['bundle', 'create', file, remoteRef], 600000);
      const verified = engine.ok(bundled) && (await git(['bundle', 'verify', '--quiet', file], 600000));
      if (!verified || !engine.ok(verified)) {
        fs.rmSync(file, { force: true });
        throw new Error('无法保存旧历史的备份，没有清除任何历史。');
      }
      backup = HISTORY_BACKUPS + '/' + name;
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
          'origin',
          `${replaced}:refs/heads/${cfg.branch}`,
        ],
        600000,
      );
      if (!engine.ok(pushed))
        throw new Error('同步仓库在检查后有了新的改动，或无法上传；没有清除任何历史，旧历史备份已保存。');
      // 4. The transport copy follows; its tree is unchanged, so only the refs move.
      await git(['update-ref', remoteRef, replaced]);
      await git(['reset', '--soft', replaced]);
      await git(['reflog', 'expire', '--expire=now', '--all']);
      await git(['gc', '--prune=now', '--quiet'], 600000);
    }
    const deletedBranches = [];
    let branchError = null;
    if (deleteBackupBranches && preview.backupBranches.length) {
      const deleted = await git(['push', 'origin', '--delete', ...preview.backupBranches], 300000);
      if (engine.ok(deleted)) deletedBranches.push(...preview.backupBranches);
      else branchError = '同步前备份分支没有删除，可以稍后重试。';
    }
    return {
      ok: true,
      removedCommits: preview.commits > 1 ? preview.commits - 1 : 0,
      commit: replaced,
      backup,
      deletedBranches,
      branchError,
    };
  } finally {
    release();
  }
}
