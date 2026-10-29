import fs from 'node:fs';
import path from 'node:path';
import { digest } from './recovery.js';
import { contentKind, transportable, scopeMirrorPath, SETTINGS_WRITER, saveRemoteCleanup } from './scope.js';

// Versions from this one on never sync machine-only files and never import their
// removal, so the shared tree can drop them without deleting anyone's own copy.
export const CLEANUP_MIN_VERSION = '0.21.0';
const DEVICE_RE = /^[0-9a-f-]{36}$/;
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;

/** True when a release version (pre-release tags ignored) is at least `min`. */
export function versionAtLeast(version, min) {
  const parts = value =>
    /^(\d+)\.(\d+)\.(\d+)/
      .exec(String(value || ''))
      ?.slice(1)
      .map(Number);
  const a = parts(version),
    b = parts(min);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

export function mirrorOf(engine) {
  const cfg = engine.loadConfig();
  if (cfg.configError) throw new Error(cfg.configError);
  if (!cfg.remote) throw new Error('尚未连接同步仓库，没有需要清理的远端文件。');
  engine.applyProxyEnv(cfg);
  engine._transport?.applyProxyEnv(cfg);
  if (engine.inFlight || engine.progress?.running) throw new Error('同步正在进行，请完成后再检查。');
  const folder = scopeMirrorPath(engine.home, cfg);
  if (!fs.existsSync(path.join(folder, '.git'))) throw new Error('还没有建立同步副本，请先同步一次。');
  return { cfg, folder, git: (args, timeout = 120000) => engine.git(['-C', folder, ...args], timeout) };
}

// Every other computer must have published a fresh receipt from a version that
// treats these files as machine-only; otherwise it would import their removal.
export async function deviceBlockers(engine, { cfg, git }, { deadline = Date.now() + 30000, remoteHeads = null } = {}) {
  const run = args => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('读取各电脑回执超时，请检查网络后重试。');
    return git(args, remaining);
  };
  let devices;
  if (remoteHeads) {
    // Use the same advertisement as the history preview. Cached immutable
    // receipts need no network request. Fetch only new device objects.
    const advertised = remoteHeads.filter(h => h.ref.startsWith('refs/heads/chatsync-device/'));
    if (advertised.length > 100) throw new Error('设备回执超过 100 项，未完成全部核对，不能清理。');
    const missing = [];
    for (const h of advertised) {
      if (!DEVICE_RE.test(h.ref.split('/').at(-1))) throw new Error('设备回执分支无效，不能清理。');
      if (!engine.ok(await run(['cat-file', '-e', h.sha + '^{commit}']))) missing.push(h);
    }
    if (missing.length) {
      const fetched = await run([
        'fetch',
        '--no-tags',
        cfg.remote,
        ...missing.map(h => '+' + h.ref + ':' + h.ref.replace('refs/heads/chatsync-device/', 'refs/chatsync-devices/')),
      ]);
      if (!engine.ok(fetched)) throw new Error('无法读取其他电脑的同步回执，请检查网络后重试；未清理任何文件。');
      for (const h of missing)
        if (!engine.ok(await run(['cat-file', '-e', h.sha + '^{commit}'])))
          throw new Error('其他电脑的同步回执已变化，请重新检查。');
    }
    devices = advertised.map(h => ({ id: h.ref.split('/').at(-1), revision: h.sha }));
  } else {
    const fetched = await run([
      'fetch',
      '--no-tags',
      cfg.remote,
      '+refs/heads/chatsync-device/*:refs/chatsync-devices/*',
      '--prune',
    ]);
    if (!engine.ok(fetched)) throw new Error('无法读取其他电脑的同步回执，请检查网络后重试；未清理任何文件。');
    const refs = await run(['for-each-ref', '--format=%(refname)', 'refs/chatsync-devices/']);
    if (!engine.ok(refs)) throw new Error('无法读取其他电脑的同步回执；未清理任何文件。');
    devices = refs.out
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(ref => ({ id: ref.split('/').at(-1), revision: ref }));
  }
  const self = engine.actorId(),
    blockers = [];
  if (devices.length > 100) throw new Error('设备回执超过 100 项，未完成全部核对，不能清理。');
  for (const { id, revision } of devices) {
    if (!DEVICE_RE.test(id) || id === self) continue;
    const shown = await run(['show', revision + ':receipt.json']);
    let receipt = null;
    try {
      receipt = engine.ok(shown) ? JSON.parse(shown.out) : null;
    } catch {}
    const appliedAt = Number.isSafeInteger(receipt?.appliedAt) ? receipt.appliedAt : null;
    const version = typeof receipt?.pluginVersion === 'string' ? receipt.pluginVersion : null;
    const reason =
      !receipt || receipt.branch !== cfg.branch
        ? '回执无法读取'
        : !appliedAt || Date.now() - appliedAt > MAX_AGE
          ? '超过 30 天没有同步'
          : !versionAtLeast(version, CLEANUP_MIN_VERSION)
            ? version
              ? `仍是 ${version}`
              : '版本未知（旧版本）'
            : null;
    if (reason)
      blockers.push({ deviceId: id, deviceName: '设备 ' + id.slice(0, 8), appliedAt, pluginVersion: version, reason });
  }
  return blockers;
}

/** Files in the shared tree that no longer belong to any sync category, and the computers that must upgrade first. */
export async function previewRemoteCleanup(engine) {
  const mirror = mirrorOf(engine);
  const head = await mirror.git(['rev-parse', '--verify', `refs/remotes/origin/${mirror.cfg.branch}`]);
  if (!engine.ok(head)) throw new Error('还没有远端同步记录，请先同步一次。');
  const listing = await mirror.git(['ls-tree', '-r', '-z', '--name-only', head.out.trim()]);
  if (!engine.ok(listing)) throw new Error('无法读取远端文件清单；未清理任何文件。');
  const files = listing.out
    .split('\0')
    .filter(file => file && transportable(file) && contentKind(file) === null && file !== SETTINGS_WRITER)
    .sort();
  const blockers = await deviceBlockers(engine, mirror);
  const previewId = digest(
    Buffer.from(JSON.stringify([head.out.trim(), files, blockers.map(b => [b.deviceId, b.reason])])),
  );
  return { ok: true, files, blockers, previewId, minVersion: CLEANUP_MIN_VERSION };
}

/**
 * Remove the previewed files from the shared tree with one ordinary sync. Each
 * computer listed as a blocker must be confirmed as retired by the user.
 * @param {any} engine
 * @param {{ previewId?: string, retiredDevices?: string[] }} [confirmation]
 */
export async function applyRemoteCleanup(engine, { previewId, retiredDevices = [] } = {}) {
  const preview = await previewRemoteCleanup(engine);
  if (typeof previewId !== 'string' || previewId !== preview.previewId)
    throw new Error('远端内容或其他电脑的状态已变化，请重新检查后再确认。');
  const retired = new Set(Array.isArray(retiredDevices) ? retiredDevices : []);
  const waiting = preview.blockers.filter(b => !retired.has(b.deviceId));
  if (waiting.length)
    throw new Error(
      `还有电脑未升级到 ${CLEANUP_MIN_VERSION}：${waiting.map(b => b.deviceName + '（' + b.reason + '）').join('、')}。请先在这些电脑上升级并同步一次；不再使用的电脑可以勾选后继续。`,
    );
  if (!preview.files.length) return { ok: true, removed: 0 };
  saveRemoteCleanup(engine.home, { files: preview.files, previewId, approvedAt: Date.now() });
  const result = await engine.syncOnce('remote-cleanup', { forceCommit: true });
  return { ok: !result.error, removed: result.remoteCleanup || 0, result };
}
