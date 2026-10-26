import fs from 'node:fs';
import path from 'node:path';
import {
  LOCAL_DATA,
  safePath,
  digest,
  currentFile,
  atomicJson,
  atomicBytes,
  replaceBytes,
  REPLACE_TEMP_SUFFIX,
} from './recovery.js';
import { isSettingsFile, settingsProjection, restoreLocalSettings } from './settings-projection.js';
export { settingsProjection, restoreLocalSettings } from './settings-projection.js';
import { requireReview } from './review.js';
import { sessionIdOfLogPath } from './session-path.js';
import { applySessionTransfer, selectSessionGenerations } from './session-transfer.js';
import { parseSessionLog, validateSessionLog, deepEqual } from './merge.js';
import { chooseSessionHistory } from './branch-history.js';
import { recordGroupingTransition } from './host-grouping.js';
import { validateTransferSession } from './session-transfer.js';
import { parseWorkspaceRegistry } from './workspace-registry.js';
import { removedSessionIds, withoutRemovedSessions } from './session-removals.js';

export const FULL_SCOPE = { sessions: true, attachments: true, settings: true };
export function normalizeScope(value) {
  if (value === null || value === undefined) return { ...FULL_SCOPE };
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !Object.hasOwn(FULL_SCOPE, k)))
    throw new Error('无效的同步内容范围');
  const result = { ...FULL_SCOPE };
  for (const key of Object.keys(FULL_SCOPE)) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error('同步内容选项必须为布尔值');
    if (value[key] !== undefined) result[key] = value[key];
  }
  return result;
}

// Settings DSH reads, plus ChatSync's own preferences and ignore rules. Plugin
// install manifests, lock files, tool backups and anything else added to the
// data directory are machine-specific and never synced.
const SETTINGS_FILES =
  /^(?:settings\.yaml(?:\.imported)?|cordis\.patch\.yml|profiles\/[^/]+\/cordis\.patch\.yml|dsh-sync\.json|\.gitignore|storages\/session_projcache\.json)$/i;

/** The sync category of a data-directory file, or null when it stays on this machine. */
export function contentKind(file) {
  if (
    /^(?:sessions\/|storages\/session_projcache\/|storages\/workspace\.json$|storages\/sync-meta\/(?:sessions\/|storages\/workspace\.json))/i.test(
      file,
    )
  )
    return 'sessions';
  if (/^attachments\//i.test(file)) return 'attachments';
  if (SETTINGS_FILES.test(file)) return 'settings';
  // A merge ledger travels with the settings file it describes.
  const ledger = /^storages\/sync-meta\/(.+)\.vmap\.json$/i.exec(file);
  if (ledger && SETTINGS_FILES.test(ledger[1])) return 'settings';
  // DSH loads ~/.dsh/AGENTS.md and ~/.dsh/skills; sharing them is opt-in per machine.
  if (/^(?:AGENTS\.md$|skills\/)/i.test(file)) return 'instructions';
  return null;
}

// Which DSH version last wrote the shared settings. Lives only in the transport
// repository (contentKind is null), so it is never imported into the data directory.
export const SETTINGS_WRITER = 'storages/sync-meta/settings-writer.json';
async function settingsWriterVersion(mirror, cfg) {
  if (!cfg.remote) return null;
  const shown = await mirror.git(['show', `refs/remotes/origin/${cfg.branch}:${SETTINGS_WRITER}`]);
  if (!mirror.ok(shown)) return null;
  try {
    const version = JSON.parse(shown.out).dshVersion;
    return typeof version === 'string' && version ? version : null;
  } catch {
    return null;
  }
}
const versionPause = (own, other) =>
  `两台电脑的 DSH 版本不同（本机 ${own}，另一台 ${other}），本轮暂停同步设置；请把两台电脑的 DSH 更新到同一版本。会话和附件照常同步。`;

// Files the user confirmed for removal from the shared tree (lib/remote-cleanup.js).
// They are removed in the transport repository only; no machine's own copy changes.
const CLEANUP_APPROVAL = LOCAL_DATA + '/remote-cleanup.json';
export function pendingRemoteCleanup(home) {
  let approval;
  try {
    approval = JSON.parse(fs.readFileSync(safePath(home, CLEANUP_APPROVAL), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error('远端清理确认记录损坏，已停止同步；请重新检查后确认');
  }
  if (
    !Array.isArray(approval?.files) ||
    approval.files.some(file => typeof file !== 'string' || contentKind(file) !== null)
  )
    throw new Error('远端清理确认记录无效，已停止同步；请重新检查后确认');
  return new Set(approval.files);
}
export function saveRemoteCleanup(home, approval) {
  atomicJson(safePath(home, CLEANUP_APPROVAL), approval);
}
export function finishRemoteCleanup(home) {
  try {
    fs.unlinkSync(safePath(home, CLEANUP_APPROVAL));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

/** Selected categories for this machine: the shared content scope plus its own instructions switch. */
export function effectiveScope(cfg) {
  return { ...normalizeScope(cfg.contentScope), instructions: cfg.syncInstructions === true };
}

export function scopeMirrorPath(home, cfg) {
  const key = digest(Buffer.from(JSON.stringify([cfg.remote, cfg.branch]))).slice(0, 24);
  return safePath(home, LOCAL_DATA + '/main-views/' + key + '/tree');
}

const excludedPart =
  /^(?:\.git|\.chatsync-local|node_modules|workspace-repos|\.pnpm-store|\.npm-cache|\.dsh-market|\.plugin-manager)$/i;
export function transportable(file) {
  return (
    !file.split('/').some(part => excludedPart.test(part) || part.endsWith('.chatsync-backups')) &&
    !/^(?:\.credentials\.yaml|\.dsh-sync(?:[.-]|$)|\.dshw-|\.anonymous-user-id|storages\/workspace-local-paths\.json|cache\/|logs\/|electron(?:\/|$))/i.test(
      file,
    ) &&
    !/\.(?:log)$/i.test(file) &&
    !file.toLowerCase().endsWith(REPLACE_TEMP_SUFFIX) &&
    !/^sessions\/.*\/(?:session\.lock|.*\.(?:tmp|lock))$/i.test(file)
  );
}

function walk(root, prefix = '', result = []) {
  for (const item of fs.readdirSync(prefix ? safePath(root, prefix) : root, { withFileTypes: true })) {
    const file = prefix ? prefix + '/' + item.name : item.name;
    if (!transportable(file) || item.isSymbolicLink()) continue;
    if (item.isDirectory()) walk(root, file, result);
    else if (item.isFile()) result.push(file);
  }
  return result;
}

// Evaluate the user's ignore file against the live tree, even when that tree
// has no Git repository. --no-index also protects previously tracked sessions.
export async function ignoredScopePaths(parent, folder, files) {
  if (!files.length) return new Set();
  if (!fs.existsSync(path.join(folder, '.git'))) {
    const initialized = await parent.git(['-C', folder, 'init', '--quiet', '-b', parent.loadConfig().branch]);
    if (!parent.ok(initialized)) throw new Error('无法初始化忽略规则检查，已停止传输');
  }
  const result = await parent.gitInput(
    [
      '-C',
      parent.home,
      '--git-dir=' + path.join(folder, '.git'),
      '--work-tree=' + parent.home,
      'check-ignore',
      '--no-index',
      '-z',
      '--stdin',
    ],
    files.join('\0') + '\0',
  );
  if (result.code !== 0 && result.code !== 1) throw new Error('无法读取本机忽略规则，已停止传输');
  return new Set(result.out.split('\0').filter(Boolean));
}

export async function scopedPreview(parent, cfg, Engine) {
  const scope = effectiveScope(cfg);
  const folder = scopeMirrorPath(parent.home, cfg);
  if (!fs.existsSync(path.join(folder, '.git')))
    return {
      initialized: false,
      remoteFresh: false,
      scopes: [],
      contentScope: scope,
      hint: '内容范围尚未建立传输副本，数量未知；预览未初始化仓库或连接远端',
    };
  const mirror = new Engine(folder, { autoRepo: false });
  const listing = await mirror.git(['--no-optional-locks', 'ls-files', '-z']);
  if (!mirror.ok(listing)) throw new Error('无法读取传输副本');
  const tracked = new Set(listing.out.split('\0'));
  const candidates = walk(parent.home).filter(file => scope[contentKind(file)]);
  const localIgnored = await ignoredScopePaths(parent, folder, candidates);
  const names = candidates.filter(file => !localIgnored.has(file));
  const ignore = await mirror.gitInput(
    ['--no-optional-locks', 'check-ignore', '-z', '--stdin'],
    names.join('\0') + '\0',
  );
  if (ignore.code !== 0 && ignore.code !== 1) throw new Error('无法读取忽略规则');
  const ignored = new Set(ignore.out.split('\0'));
  let previous = {};
  try {
    previous = JSON.parse(fs.readFileSync(safePath(path.dirname(folder), 'scope-files.json'), 'utf8'));
  } catch {}
  const counts = { added: 0, modified: 0, deleted: 0, executable: 0, kind: 'main' };
  for (const file of names) {
    if (ignored.has(file)) continue;
    const raw = fs.readFileSync(safePath(parent.home, file));
    if (digest(raw) === previous[file]?.localHash && !isSettingsFile(file)) continue;
    const value = isSettingsFile(file) ? settingsProjection(raw, file).value : raw;
    const existing = currentFile(safePath(folder, file));
    if (existing && existing.equals(value)) continue;
    if (tracked.has(file)) counts.modified++;
    else counts.added++;
    if (/^(?:cordis\.patch\.yml$|patches\/|profiles\/)|\.(?:[cm]?js|ps1|cmd|bat|sh)$/i.test(file)) counts.executable++;
  }
  for (const file of Object.keys(previous)) if (scope[contentKind(file)] && !names.includes(file)) counts.deleted++;
  const scopes = [counts];
  if (cfg.workspaceSync !== false) {
    const workspacePreview = await parent.localPreview({ workspaceOnly: true });
    scopes.push(...workspacePreview.scopes.filter(item => item.kind !== 'main'));
  }
  return {
    initialized: true,
    remoteFresh: false,
    contentScope: scope,
    scopes,
    hint: '只读候选变化，忽略规则以传输副本为准；未连接远端，远端新改动不包含在数量中',
  };
}

// A host append can be caught mid-write. Re-read briefly before treating the
// log as damaged: a completed append continues normally, a file that keeps
// changing is reported as busy, and a stable invalid file is still refused.
export async function readSettledSession(file, first, { attempts = 4, delayMs = 400 } = {}) {
  let current = first;
  for (let i = 0; i < attempts; i++) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    const next = fs.readFileSync(file);
    if (parseSessionLog(next)) return { bytes: next };
    if (next.equals(current)) return { bytes: next };
    current = next;
  }
  return { bytes: current, changing: true };
}

// Create, or rebuild after an interrupted clone, the isolated transport copy.
// Early exits return the sync result itself, without a folder.
async function prepareMirrorFolder(parent, cfg, reason) {
  if (!cfg.remote && cfg.autoRepo !== false) {
    const remote = await parent.bootstrapRemote(cfg, { reason });
    if (parent._bootstrapError) return { error: parent._bootstrapError };
    if (remote) cfg.remote = remote;
  }
  // Seed from remote history, never from unsent local commits containing excluded data.
  if (cfg.remote) {
    parent.step('verify', '检查同步仓库连接与权限…');
    const verified = await parent.verifyPrivateRemote(cfg.remote);
    if (!verified.ok) return { error: verified.error };
    parent._verifiedPrivateRemote = cfg.remote;
  }
  const folder = scopeMirrorPath(parent.home, cfg);
  fs.mkdirSync(folder, { recursive: true });
  let first = !fs.existsSync(path.join(folder, '.git'));
  if (!first) {
    // Git clone leaves .invalid until its branch checkout completes. A killed
    // startup must not turn that partial clone into a permanent scan failure.
    let head;
    try {
      head = fs.readFileSync(path.join(folder, '.git', 'HEAD'), 'utf8').trim();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      head = '';
    }
    if (!head || head === 'ref: refs/heads/.invalid') {
      const archive = path.join(path.dirname(folder), `incomplete-clone-${Date.now()}-${process.pid}`);
      fs.renameSync(folder, archive);
      fs.mkdirSync(folder);
      parent._transport = null;
      first = true;
      parent.log('warn', '上次建立同步副本未完成，已保留原副本并重新取回；会话原件不变。');
    }
  }
  if (first && cfg.remote) {
    parent.step('fetch', '首次获取同步数据…');
    const probe = await parent.git(['ls-remote', '--heads', cfg.remote, 'refs/heads/' + cfg.branch]);
    if (!parent.ok(probe)) throw new Error('无法读取范围迁移的远端状态，未上传');
    if (probe.out.trim()) {
      // Reuse reachable history already present on this computer, then copy
      // borrowed objects so the mirror never depends on the old repository.
      const reference = fs.existsSync(path.join(parent.home, '.git'))
        ? ['--reference-if-able', parent.home, '--dissociate']
        : [];
      const clone = await parent.git(
        [
          'clone',
          '--progress',
          ...reference,
          '--config',
          'core.autocrlf=false',
          '--config',
          'core.safecrlf=false',
          '--config',
          'core.longpaths=true',
          '--single-branch',
          '--branch',
          cfg.branch,
          '--',
          cfg.remote,
          folder,
        ],
        120000,
        chunk => parent.liveTransfer('fetch', '同步副本', chunk),
      );
      if (!parent.ok(clone)) throw new Error('无法取回同步副本，请检查网络后重试，或本次离线使用；本机会话保留。');
    }
  }
  return { folder, first };
}

// The transport engine shares control, review and recovery state with its parent.
function transportMirror(parent, cfg, scope, folder, Engine) {
  const mirror = parent._transport?.home === folder ? parent._transport : new Engine(folder, {}, parent.log);
  // Only the parent may create or reuse a repository; the mirror never repeats that setup.
  mirror.overrides = {
    ...cfg,
    contentScope: null,
    workspaceSync: false,
    autoRestartAfterRepair: false,
    autoRepo: false,
  };
  mirror._isolatedTransport = true;
  mirror._syncControl = parent._syncControl;
  mirror._offlineSessionApply = parent._offlineSessionApply;
  mirror.loadTransferCatalog = parent.loadTransferCatalog;
  mirror.hasPendingSessionImport = () => parent.hasPendingSessionImport();
  mirror._safeUploadHeads = parent._safeUploadHeads;
  mirror.runWithRetry = (...args) => parent.runWithRetry.call(mirror, ...args);
  mirror.configPath = () => parent.configPath();
  mirror.recovery = parent.recovery;
  mirror.actorId = () => parent.actorId();
  mirror.verifyPrivateRemote = remote => parent.verifyPrivateRemote(remote);
  mirror.skipHandoff = true;
  mirror.reviewScope = scope;
  mirror.reviewIncludes = file => transportable(file) && scope[contentKind(file)];
  mirror.onPrivacyBlocked = report => {
    parent.recordPrivacyReport({ ...report, root: report.workspaceId ? report.root : parent.home });
  };
  mirror._pendingReviews = parent._pendingReviews;
  mirror._approvedReviews = parent._approvedReviews;
  mirror._reviewApproval = parent._reviewApproval;
  mirror.requireTransferReview = parent.requireTransferReview;
  mirror.onReviewRequired = review => {
    parent._reviewRequired = review;
  };
  // The mirror survives retries. Bind the original methods, never wrap a wrapper
  // from the preceding attempt (which duplicates progress on every retry).
  mirror.step = (stage, label) => {
    Engine.prototype.step.call(mirror, stage, label);
    parent.step(stage, label);
  };
  mirror.liveTransfer = (...args) => {
    Engine.prototype.liveTransfer.call(mirror, ...args);
    parent.liveTransfer(...args);
  };
  parent._transport = mirror;
  return mirror;
}

// Copy the selected local files into the transport tree. A session caught
// mid-write returns the sync result itself, without a manifest path.
/** @returns {Promise<any>} */
async function exportToMirror(parent, mirror, cfg, scope, folder, first, hostVersion) {
  const manifestPath = safePath(path.dirname(folder), 'scope-files.json');
  const exportPath = safePath(path.dirname(folder), 'scope-export.json');
  const policyPath = safePath(path.dirname(folder), 'scope-policy.json');
  let previousScope;
  try {
    previousScope = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error('同步范围记录损坏');
  }
  const beforeListing = await mirror.git(['ls-files', '-z']);
  if (!mirror.ok(beforeListing) && fs.existsSync(path.join(folder, '.git')))
    throw new Error('无法读取同步副本文件清单');
  const beforeTracked = new Set(mirror.ok(beforeListing) ? beforeListing.out.split('\0').filter(Boolean) : []);
  const cleanup = pendingRemoteCleanup(parent.home);
  const excludedTracked = [...beforeTracked].filter(file => !transportable(file) || cleanup?.has(file));
  if (excludedTracked.length) {
    const removed = await mirror.git(['rm', '-f', '--ignore-unmatch', '--', ...excludedTracked]);
    if (!mirror.ok(removed)) throw new Error('无法排除旧同步副本中的本机文件，已停止传输');
  }
  let previous = {};
  try {
    previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error('同步范围记录损坏，已停止');
  }
  let exported = {};
  try {
    exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error('传输副本导出记录损坏，已停止');
  }
  const candidates = walk(parent.home).filter(file => scope[contentKind(file)]);
  const ignored = await ignoredScopePaths(parent, folder, candidates);
  const removed = removedSessionIds(parent);
  const names = candidates.filter(file => !ignored.has(file) && !removed.has(sessionIdOfLogPath(file)));
  const namesSet = new Set(names);
  const initialHashes = {};
  const divergentExports = new Set();
  for (const file of names) {
    let original = fs.readFileSync(safePath(parent.home, file));
    if (sessionIdOfLogPath(file) && !parseSessionLog(original)) {
      const settled = await readSettledSession(safePath(parent.home, file), original);
      if (settled.changing)
        return {
          error: 'session-being-written',
          hint: '会话正在生成或写入，本轮已暂停传输，原件未改动。等这段回复结束后再同步：' + file,
        };
      original = settled.bytes;
      if (!parseSessionLog(original))
        return {
          error: validateSessionLog(original).reason || 'invalid-session-log',
          hint: '本机会话不完整或序号不连续，已停止传输；未修改原件：' + file,
        };
    }
    if (sessionIdOfLogPath(file)) await validateTransferSession(parent, file, original);
    if (file === 'storages/workspace.json') parseWorkspaceRegistry(original);
    initialHashes[file] = digest(original);
    const value = isSettingsFile(file) ? settingsProjection(original, file).value : original;
    const destination = safePath(folder, file);
    const existing = currentFile(destination);
    // An unchanged local copy must not replace updates downloaded while its scope was off.
    if (previous[file]?.localHash === initialHashes[file] || exported[file]?.localHash === initialHashes[file]) {
      if (isSettingsFile(file) && existing) fs.writeFileSync(destination, settingsProjection(existing, file).value);
      continue;
    }
    if (
      existing &&
      !existing.equals(value) &&
      (first || (previous[file] && digest(existing) !== previous[file].transportHash))
    ) {
      parent.recovery.save(
        {
          kind: 'main',
          path: file,
          status: 'merged',
          kept: 'local',
          reason: first ? 'scope-migration' : 'scope-overlap',
        },
        { local: original, remote: existing },
      );
    }
    // A deferred remote suffix must survive a retry exporting an older prefix.
    const selected = existing && sessionIdOfLogPath(file) ? await chooseSessionHistory(parent, value, existing) : null;
    if (selected && !selected.ok) divergentExports.add(file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, selected?.ok ? selected.value : value);
    exported[file] = { localHash: initialHashes[file] };
  }
  for (const file of new Set([...Object.keys(previous), ...Object.keys(exported)])) {
    if (ignored.has(file)) continue; // Excluding a local original is never a deletion request.
    if (transportable(file) && scope[contentKind(file)] && !namesSet.has(file)) {
      const destination = safePath(folder, file);
      if (fs.existsSync(destination)) fs.unlinkSync(destination);
      initialHashes[file] = null;
      exported[file] = { localHash: null };
    }
  }
  // A paused import must not export the same old source over the staged merge on retry.
  // Otherwise the next preview names a different commit and can never be accepted.
  atomicJson(exportPath, exported);
  if (scope.settings && hostVersion) {
    const writer = safePath(folder, SETTINGS_WRITER),
      record = Buffer.from(JSON.stringify({ dshVersion: hostVersion }) + '\n');
    if (!currentFile(writer)?.equals(record)) {
      fs.mkdirSync(path.dirname(writer), { recursive: true });
      fs.writeFileSync(writer, record);
    }
  }
  return {
    manifestPath,
    exportPath,
    policyPath,
    previousScope,
    beforeTracked,
    cleanup,
    previous,
    exported,
    ignored,
    removed,
    initialHashes,
    divergentExports,
  };
}

// An exit upload applies nothing; it only reports whether downloads remain.
async function finishUploadOnly(parent, mirror, folder, scope, { initialHashes, removed }, result, reason, opts) {
  const files = await mirror.git(['ls-files', '-z']);
  if (!mirror.ok(files)) throw new Error('无法核对退出上传后的待取回内容');
  const uploadCandidates = files.out
    .split('\0')
    .filter(
      file =>
        file &&
        !(file === '.gitignore' && !Object.hasOwn(initialHashes, file)) &&
        transportable(file) &&
        scope[contentKind(file)],
    );
  const uploadIgnored = await ignoredScopePaths(parent, folder, uploadCandidates);
  const uploadSessions = selectSessionGenerations(uploadCandidates);
  const pending = uploadCandidates
    .filter(
      file =>
        !uploadIgnored.has(file) &&
        !removed.has(sessionIdOfLogPath(file)) &&
        (!sessionIdOfLogPath(file) || uploadSessions.has(file)),
    )
    .some(file => {
      const own = currentFile(safePath(parent.home, file)),
        incoming = currentFile(safePath(folder, file));
      const value = isSettingsFile(file) && own ? settingsProjection(own, file).value : own;
      return value === null || incoming === null || !value.equals(incoming);
    });
  const workspaces = await parent.syncAllWorkspaces(parent.loadConfig(), reason, opts);
  return {
    ...result,
    workspaces,
    contentScope: scope,
    ...(pending ? { downloadPending: true, pendingReason: 'exit-upload-only' } : {}),
  };
}

// Import only selected tracked paths. Excluded remote files stay in the mirror.
async function collectIncomingChanges(
  parent,
  mirror,
  folder,
  scope,
  result,
  { ignored, removed, initialHashes, beforeTracked, previous },
) {
  const listing = await mirror.git(['ls-files', '-z']);
  if (!mirror.ok(listing)) throw new Error('无法读取传输结果');
  const incomingCandidates = listing.out
    .split('\0')
    .filter(file => file && transportable(file) && scope[contentKind(file)]);
  const ignoredIncoming = await ignoredScopePaths(parent, folder, incomingCandidates);
  const incoming = incomingCandidates.filter(
    file => !ignoredIncoming.has(file) && !removed.has(sessionIdOfLogPath(file)),
  );
  const incomingSet = new Set(incoming);
  const selectedSessions = selectSessionGenerations(incoming);
  parent.sendGuard?.require([...selectedSessions].map(sessionIdOfLogPath));
  const changes = [];
  const deferred = new Set();
  let localSessionChanged = false;
  for (const file of new Set([...incoming, ...Object.keys(initialHashes)])) {
    if (ignored.has(file) || ignoredIncoming.has(file)) continue;
    // Historical immutable generations remain in Git; only the host-selected
    // highest generation is eligible for import. Never materialize retired logs.
    if (sessionIdOfLogPath(file) && incomingSet.has(file) && !selectedSessions.has(file)) continue;
    const target = safePath(parent.home, file),
      before = currentFile(target);
    const expected = initialHashes[file] ?? null;
    if ((before === null ? null : digest(before)) !== expected) {
      result.scopeWarnings = [...(result.scopeWarnings || []), '同步期间本机文件发生变化，未覆盖：' + file];
      deferred.add(file);
      if (sessionIdOfLogPath(file)) localSessionChanged = true;
      continue;
    }
    let after = incomingSet.has(file) ? currentFile(safePath(folder, file)) : null;
    if (file === 'storages/workspace.json') after = withoutRemovedSessions(after, removed);
    if (after === null && !beforeTracked.has(file) && !previous[file]) continue;
    if (isSettingsFile(file) && after === null && before) {
      result.scopeWarnings = [...(result.scopeWarnings || []), '远端删除的设置保留本机原件：' + file];
      deferred.add(file);
      continue;
    }
    if (isSettingsFile(file) && after) after = restoreLocalSettings(after, before, file);
    if ((after === null ? null : digest(after)) !== expected) changes.push({ file, target, before, after });
  }
  return { incomingSet, selectedSessions, changes, deferred, localSessionChanged };
}

// Large, first-time, widened or executable downloads wait for confirmation.
async function downloadReview(parent, mirror, scope, previousScope, changes) {
  const counts = { added: 0, modified: 0, deleted: 0 };
  for (const change of changes) {
    if (change.after === null) counts.deleted++;
    else if (change.before === null) counts.added++;
    else counts.modified++;
  }
  const executable = changes
    .filter(c =>
      /^(?:settings\.yaml$|cordis\.patch\.yml$|patches\/|profiles\/[^/]+\/(?:cordis(?:\.patch)?\.ya?ml|package\.json)$)/i.test(
        c.file,
      ),
    )
    .map(c => c.file);
  const reasons = [];
  if (!previousScope && changes.some(c => c.file !== '.gitignore')) reasons.push('首次按内容范围写入本机');
  if (previousScope && Object.keys(scope).some(key => scope[key] && !previousScope[key]))
    reasons.push('扩大同步内容范围');
  if (counts.deleted >= 10 || (counts.deleted >= 3 && counts.deleted >= changes.length / 2)) reasons.push('删除较多');
  if (executable.length) reasons.push('设置或可执行配置变化');
  if (!reasons.length) return null;
  const review = requireReview(
    parent,
    {
      direction: 'download',
      scope,
      remote: parent.loadConfig().remote,
      to: await mirror.rev('HEAD'),
      changes: changes.map(c => ({
        file: c.file,
        before: c.before === null ? null : digest(c.before),
        after: c.after === null ? null : digest(c.after),
      })),
    },
    reasons,
    counts,
    executable,
  );
  return review;
}

// Transactional import, with originals stored outside the transported tree.
async function applyIncomingChanges(
  parent,
  folder,
  scope,
  result,
  { previous, exported, manifestPath, exportPath, policyPath },
  { changes, deferred, incomingSet, localSessionChanged },
  appliedSessions,
  sessionsBefore,
) {
  const control = parent._syncControl;
  if (control) control.maskDepth = (control.maskDepth || 0) + 1;
  try {
    const backups = changes.map(change =>
      parent.recovery.save(
        { kind: 'scope-backup', path: change.file, status: 'pending' },
        { local: change.before, remote: change.after },
      ),
    );
    const applied = [];
    try {
      // Ordinary file rollback must never rewrite a session that has been appended.
      for (const change of changes.filter(
        c => !c.file.startsWith('sessions/') && c.file !== 'storages/workspace.json',
      )) {
        const current = currentFile(change.target);
        if ((current === null ? null : digest(current)) !== (change.before === null ? null : digest(change.before)))
          throw new Error('导入前文件已变化，已停止并回滚');
        applied.push(change);
        if (change.after === null) {
          if (fs.existsSync(change.target)) fs.unlinkSync(change.target);
        } else replaceBytes(change.target, change.after);
      }
    } catch (e) {
      for (const change of applied.reverse()) {
        if (change.before === null) {
          if (fs.existsSync(change.target)) fs.unlinkSync(change.target);
        } else replaceBytes(change.target, change.before);
      }
      throw e;
    }
    parent.step('apply', '通过宿主应用会话；保留正在写入的本机内容…');
    for (const change of changes.filter(c => c.file.startsWith('sessions/'))) {
      const outcome = await applySessionTransfer(parent, change.file, change.after, change.before);
      if (outcome.applied) appliedSessions.add(sessionIdOfLogPath(change.file));
      if (outcome.deferred) {
        deferred.add(change.file);
        result.sessionDeferred = [...(result.sessionDeferred || []), { file: change.file, ...outcome }];
        result.scopeWarnings = [...(result.scopeWarnings || []), outcome.hint + '：' + change.file];
      }
    }
    for (const change of changes.filter(c => c.file === 'storages/workspace.json')) {
      // Never advertise membership for session content that is not yet applied.
      if (result.sessionDeferred?.length || localSessionChanged) {
        deferred.add(change.file);
        continue;
      }
      const current = currentFile(change.target);
      if ((current === null ? null : digest(current)) !== (change.before === null ? null : digest(change.before))) {
        deferred.add(change.file);
        result.scopeWarnings = [...(result.scopeWarnings || []), '项目登记在同步期间变化，保留本机版本'];
        continue;
      }
      if (change.after !== null) {
        parseWorkspaceRegistry(change.after);
        recordGroupingTransition(parent, change.before, change.after);
        fs.mkdirSync(path.dirname(change.target), { recursive: true });
        atomicBytes(change.target, change.after);
      } else {
        deferred.add(change.file);
        result.scopeWarnings = [...(result.scopeWarnings || []), '远端删除的项目登记保留本机原件'];
      }
    }
    for (let i = 0; i < backups.length; i++)
      parent.recovery.finish(backups[i].id, { status: deferred.has(changes[i].file) ? 'deferred' : 'applied' });
    const next = { ...previous };
    for (const file of Object.keys(next)) if (scope[contentKind(file)] && !deferred.has(file)) delete next[file];
    for (const file of walk(parent.home))
      if (scope[contentKind(file)] && incomingSet.has(file)) {
        if (deferred.has(file)) continue;
        const local = fs.readFileSync(safePath(parent.home, file));
        const projected = isSettingsFile(file) ? settingsProjection(local, file).value : local;
        const remote = currentFile(safePath(folder, file));
        // Do not mark a concurrent append, or host format migration, as uploaded.
        const sessionEqual =
          remote && sessionIdOfLogPath(file) && deepEqual(parseSessionLog(local), parseSessionLog(remote));
        if (!remote || (!projected.equals(remote) && !sessionEqual)) {
          deferred.add(file);
          continue;
        }
        next[file] = { localHash: digest(local), transportHash: digest(remote) };
      }
    atomicJson(manifestPath, next);
    atomicJson(exportPath, {
      ...exported,
      ...Object.fromEntries(Object.entries(next).map(([file, value]) => [file, { localHash: value.localHash }])),
    });
    atomicJson(policyPath, scope);
    if (
      changes.some(change => change.file === 'storages/workspace.json' && !deferred.has(change.file)) ||
      [...parent.localSessionIds()].some(id => !sessionsBefore.has(id))
    )
      result.restartRequired = true;
  } finally {
    if (control) control.maskDepth--;
  }
}

// Main-session proof is independent of unrelated project upload failures.
// Compare the actual host bytes with the merged, fetched history. A deferred
// write, excluded session, or preserved divergent branch cannot release sends.
async function verifySentSessions(
  parent,
  folder,
  result,
  selectedSessions,
  deferred,
  divergentExports,
  appliedSessions,
) {
  const blocked = new Set([...divergentExports, ...(result.sessionWarnings || []).map(w => w.path)]);
  const verified = [];
  for (const file of selectedSessions) {
    if (!blocked.has(file) && appliedSessions.has(sessionIdOfLogPath(file))) {
      verified.push(sessionIdOfLogPath(file));
      continue;
    }
    if (deferred.has(file) || blocked.has(file)) continue;
    const local = currentFile(safePath(parent.home, file)),
      remote = currentFile(safePath(folder, file));
    if (!local || !remote) continue;
    const choice = await chooseSessionHistory(parent, local, remote);
    if (choice.ok && choice.value.equals(local)) verified.push(sessionIdOfLogPath(file));
  }
  parent.sendGuard.verify(verified);
  result.verifiedSessionIds = verified;
}

export async function scopedSync(parent, cfg, reason, opts, Engine) {
  const scope = effectiveScope(cfg);
  const sessionsBefore = new Set(parent.localSessionIds());
  const prepared = await prepareMirrorFolder(parent, cfg, reason);
  if (!prepared.folder) return prepared;
  const { folder, first } = prepared;
  parent.step('analyze', '核对本机会话、附件与设置…');
  const mirror = transportMirror(parent, cfg, scope, folder, Engine);
  // Another DSH version may write settings in a format this one cannot read, and
  // the reverse; while they differ, neither side sends or applies settings.
  const hostVersion = parent.hostDshVersion();
  let settingsPausedBy = null;
  const pauseSettingsFor = async () => {
    const other = scope.settings && hostVersion ? await settingsWriterVersion(mirror, cfg) : null;
    if (other && other !== hostVersion) {
      settingsPausedBy = other;
      scope.settings = false;
    }
  };
  await pauseSettingsFor();
  const exportState = await exportToMirror(parent, mirror, cfg, scope, folder, first, hostVersion);
  if (!exportState.manifestPath) return exportState;
  const { cleanup, divergentExports } = exportState;
  const result = await mirror._syncOnce(reason, opts);
  parent._verifiedPrivateRemote = mirror._verifiedPrivateRemote;
  parent.throwIfCancelled();
  if (result.error) return result;
  // A confirmed cleanup is done once the shared tree no longer holds those files.
  if (cleanup && cfg.remote) {
    const remaining = await mirror.git(['ls-tree', '-r', '-z', '--name-only', `refs/remotes/origin/${cfg.branch}`]);
    if (mirror.ok(remaining) && !remaining.out.split('\0').some(file => cleanup.has(file))) {
      finishRemoteCleanup(parent.home);
      result.remoteCleanup = cleanup.size;
    }
  }
  // The fetch may have brought settings written by a different DSH version.
  await pauseSettingsFor();
  // A notice, not a failure: nothing was lost and the cure is aligning DSH versions.
  if (settingsPausedBy) result.settingsPause = versionPause(hostVersion, settingsPausedBy);
  if (opts.uploadOnly) return finishUploadOnly(parent, mirror, folder, scope, exportState, result, reason, opts);
  const incoming = await collectIncomingChanges(parent, mirror, folder, scope, result, exportState);
  const { changes, deferred, selectedSessions, localSessionChanged } = incoming;
  const review = await downloadReview(parent, mirror, scope, exportState.previousScope, changes);
  if (review) return { ...result, error: '同步已暂停，等待确认预览', needsReview: true, review };
  parent.throwIfCancelled();
  const appliedSessions = new Set();
  await applyIncomingChanges(parent, folder, scope, result, exportState, incoming, appliedSessions, sessionsBefore);
  parent.throwIfCancelled();
  if (parent.sendGuard && cfg.remote)
    await verifySentSessions(parent, folder, result, selectedSessions, deferred, divergentExports, appliedSessions);
  const workspaces = await parent.syncAllWorkspaces(parent.loadConfig(), reason, opts);
  const lifecyclePending =
    localSessionChanged ||
    result.sessionDeferred?.some(d =>
      ['session-api-unavailable', 'host-running', 'session-writer-held'].includes(d.reason),
    );
  if (lifecyclePending) {
    result.downloadPending = true;
    result.pendingReason = 'host-running';
  }
  return {
    ...result,
    workspaces,
    contentScope: scope,
    ...(result.scopeWarnings?.length && !lifecyclePending
      ? { error: '部分内容未应用，已保留本机原件；请查看提示后重试' }
      : {}),
  };
}
