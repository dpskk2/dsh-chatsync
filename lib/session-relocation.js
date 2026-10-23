import fs from 'node:fs';
import path from 'node:path';
import { safePath, LOCAL_DATA, atomicJson, digest } from './recovery.js';
import { sessionIdOfLogPath } from './session-path.js';
import { importRecoverySession, sessionRecoveryOptions } from './session-recovery.js';

export async function previewSessionRelocation(engine, ctx, issue) {
  if (!issue || !['relocate', 'membership', 'grouping'].includes(issue.kind) || issue.archived || !issue.file) throw new Error('问题已变化，请重新检查');
  if (engine.inFlight) throw new Error('同步正在进行，请稍后选择项目');
  const release = engine.acquireProcessLock();
  if (!release) throw new Error('另一 DSH 进程正在同步，请稍后选择项目');
  try {
    const bytes = fs.readFileSync(safePath(engine.home, issue.file)), hash = digest(bytes);
    const folder = safePath(engine.home, LOCAL_DATA + '/data-forks'); fs.mkdirSync(folder, { recursive: true });
    const state = path.join(folder, hash + '.json'); let recordId;
    try { recordId = JSON.parse(fs.readFileSync(state, 'utf8')).recordId; }
    catch (e) { if (e.code !== 'ENOENT') throw new Error('迁移恢复记录损坏'); }
    if (recordId) {
      const saved = engine.recovery.read(recordId);
      if (saved.path !== issue.file || saved.versions.local?.sha256 !== hash) throw new Error('迁移原件记录不一致，请保留原件并检查');
    } else {
      recordId = engine.recovery.save({ kind: 'main', path: issue.file, status: 'merged', kept: 'local',
        reason: 'local-project-unavailable' }, { local: bytes, remote: bytes }).id;
      atomicJson(state, { recordId });
    }
    const options = await sessionRecoveryOptions(engine, ctx, recordId);
    if (!options.available) throw new Error(options.hint);
    return { issue, relocation: true, recoveryId: recordId, expectedHash: hash, workspaces: options.workspaces,
      warning: '将在所选项目中恢复会话，并归档旧会话。请选择项目文件已准备好的本机项目。' };
  } finally { release(); }
}

export async function importRelocatedSession(engine, ctx, body, importer = importRecoverySession) {
  const record = engine.recovery.read(body.recoveryId);
  if (record.reason !== 'local-project-unavailable') throw new Error('请先预览项目迁移方案');
  const sourceId = sessionIdOfLogPath(record.path);
  const source = safePath(engine.home, record.path);
  const check = () => {
    if (digest(fs.readFileSync(source)) !== body.expectedHash) throw new Error('原会话已变化，请重新预览；已恢复内容仍保留');
    const activity = engine.sessionActivity();
    if (!activity.available || activity.activeIds?.includes(sourceId) || (activity.activeCount > 0 && !activity.activeIds)) throw new Error('原会话正在使用或活动状态未知，请结束后再迁移');
  };
  check();
  const result = await importer(engine, ctx, { id: body.recoveryId, side: 'local', expectedHash: body.expectedHash, workspaceId: body.workspaceId });
  if (!body.archiveSource) return result;
  const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : ctx.workspaceRegistry;
  if (typeof registry?.archiveSession !== 'function') throw new Error('新会话已校验，但宿主不能归档原会话；原件保留，请手动归档旧会话');
  if (engine.inFlight) throw new Error('新会话已校验，同步正在进行；请稍后重试归档原会话');
  const release = engine.acquireProcessLock();
  if (!release) throw new Error('新会话已校验，另一进程正在同步；请稍后重试归档原会话');
  try {
    check();
    await registry.archiveSession(sourceId);
    if (!registry.archivedSessionIds?.includes(sourceId)) throw new Error('新会话已校验，原会话归档读回失败，请重新检查');
    check();
    engine.recovery.finish(record.id, { relocation: { sourceSessionId: sourceId, sessionId: result.sessionId,
      workspaceId: body.workspaceId, sourceHash: body.expectedHash, archivedSource: true, at: Date.now() }, reviewState: 'archived', reviewedAt: Date.now() });
    return { ...result, archivedSource: true, hint: '已在所选项目恢复并读回校验，旧会话已归档，双方原件完整保留。' };
  } finally { release(); }
}
