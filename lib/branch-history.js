import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { mergeSessionLog } from './merge.js';
import { decodeRecoverySession, importRecoverySession, hostSessionCatalog } from './session-recovery.js';
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
  return {
    commonEvents: common,
    localEvents: left.events.length,
    remoteEvents: right.events.length,
    divergent: common < Math.min(left.events.length, right.events.length),
    meaning: '共同历史只比较一次；两端独立发生的对话保留为各自可继续的会话，不混排工具调用和事件序号。',
  };
}

// Preserve any branch absent from the active original, using the host's fork
// preparation and durable import journal. Repeated clicks reuse the same fork.
export async function preserveRecoveryBranches(
  engine,
  ctx,
  { id, workspaceId, expectedLocalHash, expectedRemoteHash },
) {
  const record = engine.recovery.read(id);
  if (record.kind !== 'main' || record.status !== 'merged') throw new Error('请先完成同步并预览双方原件');
  if (expectedLocalHash !== record.versions.local?.sha256 || expectedRemoteHash !== record.versions.remote?.sha256)
    throw new Error('双方原件已变化，请重新预览');
  const current = (() => {
    try {
      const active = engine.scanSessions().find(item => item.id === sessionIdOfLogPath(record.path));
      return fs.readFileSync(active?.file || safePath(engine.home, record.path));
    } catch {
      return null;
    }
  })();
  const catalog = await (engine.loadRecoveryCatalog || hostSessionCatalog)();
  const directory = safePath(engine.home, LOCAL_DATA + '/branch-preservations');
  fs.mkdirSync(directory, { recursive: true });
  const results = [];
  for (const side of ['local', 'remote']) {
    const source = engine.recovery.version(record, side);
    if (!source) continue;
    if (current) {
      const choice = await chooseSessionHistory(engine, current, source);
      if (choice.ok && choice.value.equals(current)) continue;
    }
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
  return {
    ok: true,
    branches: results,
    hint: results.length
      ? '两端独有对话已保留为可分别继续的会话；原会话和来源记录保留。'
      : '当前会话已包含这些记录，无需重复建立分支。',
  };
}
