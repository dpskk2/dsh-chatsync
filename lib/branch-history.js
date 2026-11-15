import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { mergeSessionLog } from './merge.js';
import {
  decodeRecoverySession,
  importRecoverySession,
  hostSessionCatalog,
  currentRecoverySession,
  recoveryVersionIncluded,
} from './session-recovery.js';
import { transferCatalog } from './session-transfer.js';
import { digest, safePath, LOCAL_DATA, atomicJson } from './recovery.js';
import { sessionIdOfLogPath } from './session-path.js';

export async function chooseSessionHistory(engine, ours, theirs) {
  const physical = mergeSessionLog(ours, theirs);
  if (physical.ok) return physical;
  try {
    const catalog = await (engine.loadTransferCatalog || transferCatalog)();
    const a = decodeRecoverySession(ours, catalog),
      b = decodeRecoverySession(theirs, catalog);
    if (!isDeepStrictEqual(a.header, b.header) || a.inheritedEventCount !== b.inheritedEventCount) return physical;
    const shared = Math.min(a.events.length, b.events.length);
    for (let i = 0; i < shared; i++) if (!isDeepStrictEqual(a.events[i], b.events[i])) return physical;
    return { ok: true, value: a.events.length >= b.events.length ? ours : theirs, logicalPrefix: true };
  } catch {
    return physical;
  }
}

export async function compareRecoveryBranches(engine, id) {
  const record = engine.recovery.read(id);
  if (!sessionIdOfLogPath(record.path)) return null;
  const a = engine.recovery.version(record, 'local'),
    b = engine.recovery.version(record, 'remote');
  if (!a || !b) return null;
  const catalog = await (engine.loadRecoveryCatalog || hostSessionCatalog)();
  const left = decodeRecoverySession(a, catalog),
    right = decodeRecoverySession(b, catalog);
  let common = 0;
  if (isDeepStrictEqual(left.header, right.header) && left.inheritedEventCount === right.inheritedEventCount)
    while (
      common < Math.min(left.events.length, right.events.length) &&
      isDeepStrictEqual(left.events[common], right.events[common])
    )
      common++;
  const current = currentRecoverySession(engine, record);
  let live = null;
  try {
    if (current) live = decodeRecoverySession(current, catalog);
  } catch {
    // The saved versions can still be compared when the live log is being written.
  }
  return {
    commonEvents: common,
    localEvents: left.events.length,
    remoteEvents: right.events.length,
    divergent: common < Math.min(left.events.length, right.events.length),
    currentVersions: live
      ? { local: recoveryVersionIncluded(live, left), remote: recoveryVersionIncluded(live, right) }
      : null,
  };
}

export async function keepCurrentConflictVersion(engine, { id, keep, expectedVersions }) {
  if (!['local', 'remote'].includes(keep)) throw new Error('请选择要保留的版本');
  if (engine.inFlight) throw new Error('同步正在进行，请稍后处理冲突');
  const release = engine.acquireProcessLock();
  if (!release) throw new Error('另一 DSH 进程正在同步，请稍后处理冲突');
  try {
    const record = engine.recovery.read(id);
    const fork = engine.recovery.sessionFork(record);
    if (!fork || ['local', 'remote'].some(side => record.versions[side].sha256 !== expectedVersions?.[side]))
      throw new Error('冲突记录已变化，请重新打开');
    const reviewedAt = record.conflictResolution?.kept === keep ? record.reviewedAt : Date.now();
    if (record.conflictResolution?.kept !== keep) {
      if (record.forkHandled || record.reviewState === 'archived' || Object.keys(record.imports || {}).length)
        throw new Error('这条冲突记录已有处理结果，请重新打开');
      const { currentVersions } = await compareRecoveryBranches(engine, id);
      const discarded = keep === 'local' ? 'remote' : 'local';
      if (!currentVersions?.[keep] || currentVersions[discarded]) throw new Error('当前会话已变化，请重新打开冲突记录');
      engine.recovery.finish(id, {
        forkHandled: true,
        forkReviewKept: record.versions[keep].sha256,
        reviewState: 'archived',
        reviewedAt,
        conflictResolution: { kept: keep, discarded },
      });
    }
    // An equivalent pending snapshot must not reappear if this backup is deleted.
    for (const other of engine.recovery.list()) {
      if (
        other.id !== id &&
        engine.recovery.sessionFork(other)?.key === fork.key &&
        !other.forkHandled &&
        !Object.keys(other.imports || {}).length
      )
        engine.recovery.finish(other.id, { forkHandled: true, reviewState: 'archived', reviewedAt });
    }
    return { ok: true, conflictComplete: true };
  } finally {
    release();
  }
}

async function containsVersion(engine, current, source) {
  const choice = await chooseSessionHistory(engine, current, source);
  return choice.ok && choice.value.equals(current);
}

// Preserve any branch absent from the active original, using the host's fork
// preparation and durable import journal. Repeated clicks reuse the same fork.
export async function preserveRecoveryBranches(
  engine,
  ctx,
  { id, workspaceId, expectedLocalHash, expectedRemoteHash },
) {
  const record = engine.recovery.read(id);
  if (!(
    (record.kind === 'main' && record.status === 'merged') ||
    (record.status === 'deferred' && engine.recovery.sessionFork(record))
  ))
    throw new Error('请先预览双方会话原件');
  if (expectedLocalHash !== record.versions.local?.sha256 || expectedRemoteHash !== record.versions.remote?.sha256)
    throw new Error('双方原件已变化，请重新预览');
  const current = currentRecoverySession(engine, record);
  const catalog = await (engine.loadRecoveryCatalog || hostSessionCatalog)();
  const directory = safePath(engine.home, LOCAL_DATA + '/branch-preservations');
  fs.mkdirSync(directory, { recursive: true });
  const results = [];
  for (const side of ['local', 'remote']) {
    const source = engine.recovery.version(record, side);
    if (!source) continue;
    if (current && (await containsVersion(engine, current, source))) continue;
    const key = digest(Buffer.from(JSON.stringify([record.path, digest(source), workspaceId]))),
      state = directory + '/' + key + '.json';
    let prior;
    try {
      prior = JSON.parse(fs.readFileSync(state, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error('分支恢复记录损坏');
    }
    // Journal the recovery source before importing, so a failed response never
    // creates a second fork from a different recovery record on retry.
    if (!prior) {
      prior = { id, side, hash: digest(source), workspaceId };
      atomicJson(state, prior);
    }
    const saved = engine.recovery.read(prior.id).imports?.[prior.side];
    if (saved?.status === 'verified') {
      const query = typeof ctx.get === 'function' ? ctx.get('sessionQuery') : ctx.sessionQuery;
      const existing = await query.readSession(saved.sessionId);
      if (existing.session.id !== saved.sessionId || existing.session.parentSession !== sessionIdOfLogPath(record.path))
        throw new Error('已恢复分支的身份发生变化，请查看恢复记录');
      results.push({ ok: true, sessionId: saved.sessionId, existing: true });
      continue;
    }
    const result = await importRecoverySession(
      engine,
      ctx,
      { id: prior.id, side: prior.side, expectedHash: prior.hash, workspaceId },
      async () => catalog,
    );
    results.push(result);
  }
  if (engine.recovery.sessionFork(record)) {
    if (engine.inFlight) throw new Error('同步正在进行，请稍后处理会话冲突');
    const release = engine.acquireProcessLock();
    if (!release) throw new Error('另一 DSH 进程正在同步，请稍后处理会话冲突');
    try {
      const latest = engine.recovery.read(id);
      if (latest.versions.local.sha256 !== expectedLocalHash || latest.versions.remote.sha256 !== expectedRemoteHash)
        throw new Error('双方原件已变化，请重新预览');
      engine.recovery.finish(id, { forkHandled: true, reviewState: 'archived' });
    } finally {
      release();
    }
  }
  return {
    ok: true,
    branches: results,
    hint: results.length ? '已另存到所选项目。' : '当前会话已包含两个版本的内容。',
  };
}
