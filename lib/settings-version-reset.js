// "Clear version record": this computer takes over settings sync from a DSH version
// that is no longer in use. The shared settings are first saved as recovery records;
// the shared repository changes only through the next ordinary sync.
import fs from 'node:fs';
import { atomicJson, currentFile, LOCAL_DATA, safePath } from './recovery.js';
import { mirrorOf } from './remote-cleanup.js';
import { contentKind, SETTINGS_WRITER } from './scope.js';

export const SETTINGS_RESET_MARKER = LOCAL_DATA + '/settings-version-reset.json';

/**
 * The recorded version this computer agreed to replace; null without a usable marker.
 * @param {string} home
 * @returns {{ acknowledged: string, own: string, remote: string, branch: string, remoteCommit: string, backups: number, at: number } | null}
 */
export function readSettingsVersionReset(home) {
  try {
    const value = JSON.parse(fs.readFileSync(safePath(home, SETTINGS_RESET_MARKER), 'utf8'));
    return value && typeof value.acknowledged === 'string' && value.acknowledged ? value : null;
  } catch {
    return null;
  }
}

export function clearSettingsVersionReset(home) {
  try {
    fs.unlinkSync(safePath(home, SETTINGS_RESET_MARKER));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

/**
 * @param {any} engine
 * @param {{ expectedVersion?: unknown }} body
 */
export async function resetSettingsVersion(engine, body) {
  const expected = body && typeof body.expectedVersion === 'string' ? body.expectedVersion : '';
  if (!expected) throw new Error('请刷新同步状态后重试。');
  if (engine.inFlight || engine.progress?.running) throw new Error('同步正在进行，请完成后再清除版本记录。');
  const own = engine.hostDshVersion();
  if (!own) throw new Error('无法检测这台电脑的 DSH 版本，没有清除版本记录。');
  const release = engine.acquireProcessLock();
  if (!release) throw new Error('另一同步或恢复进程正在运行，请稍后再试。');
  try {
    const { cfg, folder, git } = mirrorOf(engine);
    const ref = `refs/remotes/origin/${cfg.branch}`;
    const tip = await git(['rev-parse', '--verify', ref + '^{commit}']);
    if (!engine.ok(tip)) throw new Error('还没有远端同步记录，请先同步一次。');
    const remoteCommit = tip.out.trim();
    let recorded = null;
    const shown = await git(['show', `${remoteCommit}:${SETTINGS_WRITER}`]);
    if (engine.ok(shown)) {
      try {
        recorded = JSON.parse(shown.out).dshVersion;
      } catch {
        /* an unreadable record matches no version */
      }
    }
    if (recorded !== expected)
      throw new Error('同步仓库中的版本记录已变化，请先「立即同步」查看最新状态；没有清除任何记录。');
    if (recorded === own) throw new Error('版本记录与这台电脑的 DSH 相同，无需清除。');
    const listed = await git(['ls-tree', '-r', '-z', '--name-only', remoteCommit]);
    if (!engine.ok(listed)) throw new Error('无法读取同步仓库中的设置，没有清除版本记录。');
    const files = listed.out.split('\0').filter(file => file && contentKind(file) === 'settings');
    // Every backup is written before anything changes; a failure stops here.
    let backups = 0;
    for (const file of files) {
      const remote = await engine.gitBytes(['-C', folder, 'show', `${remoteCommit}:${file}`]);
      if (!engine.ok(remote) || !Buffer.isBuffer(remote.out))
        throw new Error(`无法读取同步仓库中的 ${file}，没有清除版本记录。`);
      const local = currentFile(safePath(engine.home, file));
      engine.recovery.save(
        {
          kind: 'settings-version-reset',
          path: file,
          status: 'saved',
          otherVersion: recorded,
          ownVersion: own,
          remoteCommit,
        },
        { local, remote: remote.out },
      );
      backups++;
    }
    atomicJson(safePath(engine.home, SETTINGS_RESET_MARKER), {
      acknowledged: recorded,
      own,
      remote: cfg.remote,
      branch: cfg.branch,
      remoteCommit,
      backups,
      at: Date.now(),
    });
    return { from: recorded, to: own, backups };
  } finally {
    release();
  }
}
