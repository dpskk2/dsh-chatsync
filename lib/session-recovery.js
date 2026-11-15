import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sessionIdPattern, sessionIdOfLogPath } from './session-path.js';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { digest, safePath, atomicJson, unhandledConflictSides } from './recovery.js';
import { isDeepStrictEqual } from 'node:util';
import { ZSTD_MAGIC, decodeZstdFrames } from './merge.js';
import { prepareImportRescue } from './session-repair.js';
import { hostService, refreshSessionProjection } from './session-host.js';

// Resolve only the host's published package export, never its private files.
export async function hostSessionCatalog() {
  const entries = [process.env.DSH_SYNC_HOST_ENTRY, process.argv[1], import.meta.url].filter(Boolean);
  for (const entry of entries) {
    try {
      const require = createRequire(entry);
      const resolved = require.resolve('@deepseek-ai/dsh-session-format-catalog');
      const { sessionFormatCatalog, createSessionFormatCatalogWithChildren } = await import(
        pathToFileURL(resolved).href
      );
      const { buildForkSeed } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href);
      if (sessionFormatCatalog?.createRestore && typeof buildForkSeed === 'function') {
        // This is an independent transcript fork, not migration of the original live tree.
        // The public catalog requires explicit child evidence for historical bodies.
        const transcriptCatalog =
          typeof createSessionFormatCatalogWithChildren === 'function'
            ? createSessionFormatCatalogWithChildren(Object.freeze([]))
            : sessionFormatCatalog;
        return {
          createRestore: (...args) => transcriptCatalog.createRestore(...args),
          buildForkSeed,
          encodeHeader: (header, inherited) =>
            sessionFormatCatalog.encodeCurrentHeader(
              { ...header, delegationDepth: header.delegationDepth ?? 0 },
              inherited,
            ),
          encodeEvent: event => sessionFormatCatalog.encodeCurrentEvent(event),
        };
      }
    } catch {
      /* optional host capability; older hosts keep read-only recovery */
    }
  }
  throw new Error('此宿主未提供已验证的会话格式接口，原件仍可预览');
}

const MAX_LOG = 256 * 1024 * 1024;
export function decodeRecoverySession(buffer, catalog, maxBytes = MAX_LOG) {
  if (!buffer || buffer.length > maxBytes)
    throw new Error('会话原件为空或超过 ' + maxBytes / (1024 * 1024) + ' MiB，已停止导入');
  const compressed = buffer.subarray(0, 4).equals(ZSTD_MAGIC);
  const text = compressed ? decodeZstdFrames(buffer, maxBytes) : buffer.toString('utf8');
  if (text === null || Buffer.byteLength(text) > maxBytes)
    throw new Error('会话解码失败或超过 ' + maxBytes / (1024 * 1024) + ' MiB，已停止导入');
  const rows = text.split('\n').filter(row => row.trim());
  if (rows.length > 2000004) throw new Error('会话记录过多，已停止导入');
  const restore = catalog.createRestore(JSON.parse(rows.shift()), { recovery: 'strict', validation: 'current' });
  for (const row of rows) restore.decodeRow(JSON.parse(row));
  const artifact = restore.finish();
  if (!sessionIdPattern.test(artifact.header.id)) throw new Error('会话身份格式不受支持');
  return artifact;
}

function sourceRecord(engine, id) {
  const record = engine.recovery.read(id);
  if (
    !sessionIdOfLogPath(record.path) ||
    !(
      (record.kind === 'main' && record.status === 'merged') ||
      (record.status === 'deferred' && engine.recovery.sessionFork(record))
    )
  ) {
    throw new Error('此原件不是已完成处理的会话冲突');
  }
  return record;
}
function capable(ctx) {
  return Boolean(
    ctx.sessions?.prepare &&
    ctx.sessionPersistence?.create &&
    ctx.sessionPersistence?.open &&
    ctx.sessionPersistence?.stat &&
    ctx.sessionQuery?.readSession &&
    ctx.workspaceRegistry?.list,
  );
}
function hostServices(ctx) {
  return Object.fromEntries(
    ['sessions', 'sessionPersistence', 'sessionQuery', 'workspaceRegistry', 'attachments'].map(name => [
      name,
      hostService(ctx, name),
    ]),
  );
}
function registeredWorkspace(registry, workspace) {
  const current =
    typeof registry.get === 'function'
      ? registry.get(workspace.id)
      : registry.list().find(ws => ws.id === workspace.id);
  if (
    !current ||
    current.path !== workspace.path ||
    !fs.statSync(current.path, { throwIfNoEntry: false })?.isDirectory()
  )
    throw new Error('所选项目已移除或位置已变化');
  return current;
}
function originalWorkspace(workspaces, record) {
  const id = sessionIdOfLogPath(record.path);
  const matches = workspaces.filter(ws => ws.sessionIds?.includes(id));
  return matches.length === 1 ? matches[0] : null;
}

export async function sessionRecoveryOptions(engine, ctx, id, loadCatalog = hostSessionCatalog) {
  try {
    ctx = hostServices(ctx);
    const record = sourceRecord(engine, id);
    if (!capable(ctx)) throw new Error('此宿主缺少会话导入或读回接口，原件仍可预览');
    const catalog = await loadCatalog();
    if (typeof catalog.buildForkSeed !== 'function') throw new Error('此宿主缺少已验证的会话另存接口，原件仍可预览');
    const registered = ctx.workspaceRegistry.list();
    const original = originalWorkspace(registered, record);
    const project = ({ id, title, path: folder }) => ({ id, title: title || path.basename(folder), path: folder });
    return {
      available: true,
      sourceProject: original ? project(original) : null,
      workspaces: registered
        .filter(ws => fs.existsSync(ws.path) && path.resolve(ws.path) !== path.resolve(engine.home))
        .map(project),
    };
  } catch (e) {
    return { available: false, hint: e.message };
  }
}

export function currentRecoverySession(engine, record) {
  try {
    const active = engine.scanSessions().find(item => item.id === sessionIdOfLogPath(record.path));
    return fs.readFileSync(active?.file || safePath(engine.home, record.path));
  } catch {
    return null;
  }
}

export function recoveryVersionIncluded(live, version) {
  return (
    isDeepStrictEqual(live.header, version.header) &&
    live.inheritedEventCount === version.inheritedEventCount &&
    version.events.every((event, index) => isDeepStrictEqual(live.events[index], event))
  );
}

function currentConflictHash(engine, record, catalog) {
  try {
    const current = currentRecoverySession(engine, record);
    if (!current) return null;
    const live = decodeRecoverySession(current, catalog);
    for (const side of ['local', 'remote']) {
      const original = decodeRecoverySession(engine.recovery.version(record, side), catalog);
      if (recoveryVersionIncluded(live, original)) return record.versions[side].sha256;
    }
  } catch {
    // Only a verified prefix can count as already present.
  }
  return null;
}

async function verifyAttachments(events, ctx) {
  const refs = new Map();
  const stack = [...events];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (['file', 'image'].includes(value.type) && value.attachment?.attachmentId) {
      refs.set(value.type + ':' + value.attachment.attachmentId, value);
    }
    stack.push(...Object.values(value).filter(v => v && typeof v === 'object'));
  }
  if (refs.size > 1000) throw new Error('附件引用过多，已停止导入');
  for (const value of refs.values()) {
    if (value.type === 'image') {
      if (!ctx.attachments?.readImage) throw new Error('宿主不能校验图片附件');
      await ctx.attachments.readImage(value.attachment);
    } else {
      if (!ctx.attachments?.readFileStream) throw new Error('宿主不能校验文件附件');
      // The public store verifies the content-addressed bytes while streaming.
      for await (const _chunk of ctx.attachments.readFileStream(value.attachment)) {
        /* drain verification */
      }
    }
  }
  return refs.size;
}
const eventHash = events => digest(Buffer.from(JSON.stringify(events)));

function validatedRescuePayload(catalog, prepared, plan) {
  if (typeof catalog.encodeHeader !== 'function' || typeof catalog.encodeEvent !== 'function') return null;
  const rows = [
    catalog.encodeHeader(prepared.header, plan.inheritedEventCount),
    ...plan.events.map(event => catalog.encodeEvent(event)),
  ];
  const payload = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const decoded = decodeRecoverySession(payload, catalog, MAX_LOG + 1024 * 1024);
  if (
    decoded.header.id !== prepared.header.id ||
    decoded.header.cwd !== plan.meta.cwd ||
    decoded.header.parentSession !== plan.meta.parentSession ||
    decoded.header.isSeeded !== plan.meta.isSeeded ||
    decoded.inheritedEventCount !== plan.inheritedEventCount ||
    eventHash(decoded.events) !== eventHash(plan.events)
  ) {
    throw new Error('停机修复种子未通过宿主校验，已停止导入');
  }
  return payload;
}

function importPlan(engine, record, side, artifact, workspace, sourceHash, catalog, ctx) {
  const file = safePath(engine.recovery.directory(), record.id + '/import-' + side + '.json');
  let attempt = record.imports?.[side];
  // Preserve identities made by the previous replay implementation, including partial writes.
  if (attempt && !attempt.planHash)
    return {
      attempt,
      events: artifact.events,
      inheritedEventCount: artifact.inheritedEventCount,
      meta: {
        cwd: workspace.path,
        createdAt: attempt.createdAt,
        isSeeded: artifact.header.isSeeded,
        ...(artifact.header.parentSession ? { parentSession: artifact.header.parentSession } : {}),
      },
    };
  let plan;
  if (fs.existsSync(file)) {
    if (fs.statSync(file).size > MAX_LOG + 1024 * 1024) throw new Error('会话导入方案过大，已停止导入');
    const bytes = fs.readFileSync(file);
    if (attempt && digest(bytes) !== attempt.planHash) throw new Error('会话导入方案校验失败，原件保留');
    plan = JSON.parse(bytes.toString('utf8'));
    if (
      plan.format !== 1 ||
      plan.sourceHash !== sourceHash ||
      plan.workspaceId !== workspace.id ||
      plan.sourceSessionId !== artifact.header.id ||
      plan.meta?.cwd !== workspace.path ||
      plan.meta?.parentSession !== artifact.header.id ||
      plan.meta?.isSeeded !== true ||
      !Number.isSafeInteger(plan.meta?.createdAt) ||
      !/^session-[0-9a-f-]{36}$/i.test(plan.sessionId || '') ||
      (attempt && plan.sessionId !== attempt.sessionId) ||
      plan.inheritedEventCount !== artifact.events.length ||
      !Array.isArray(plan.events) ||
      eventHash(plan.events.slice(0, artifact.events.length)) !== eventHash(artifact.events)
    ) {
      throw new Error('会话导入方案与原件或项目不一致，已停止导入');
    }
  } else {
    if (attempt) throw new Error('会话导入方案缺失，已停止导入；会话原件保留');
    if (typeof catalog.buildForkSeed !== 'function') throw new Error('此宿主缺少已验证的会话另存接口');
    if (!artifact.events.length) throw new Error('此原件没有可另存的会话内容');
    plan = {
      format: 1,
      sessionId: 'session-' + randomUUID(),
      workspaceId: workspace.id,
      sourceSessionId: artifact.header.id,
      sourceHash,
      inheritedEventCount: artifact.events.length,
      meta: { cwd: workspace.path, createdAt: Date.now(), isSeeded: true, parentSession: artifact.header.id },
      events: catalog.buildForkSeed(artifact.events, artifact.events.length - 1),
    };
    if (Buffer.byteLength(JSON.stringify(plan, null, 2) + '\n') > MAX_LOG + 1024 * 1024)
      throw new Error('会话导入方案过大，已停止导入');
    const prepared = ctx.sessions.prepare(plan.sessionId, {
      seed: plan.events,
      inheritedEventCount: plan.inheritedEventCount,
      meta: plan.meta,
    });
    validatedRescuePayload(catalog, prepared, plan);
    // Persist synthetic closers once: retries must replay exactly the same seed and identity.
    atomicJson(file, plan);
  }
  if (!attempt) {
    attempt = {
      sessionId: plan.sessionId,
      createdAt: plan.meta.createdAt,
      workspaceId: workspace.id,
      sourceHash,
      planHash: digest(fs.readFileSync(file)),
      status: 'pending',
    };
    engine.recovery.finish(record.id, { imports: { ...record.imports, [side]: attempt } });
  }
  return { attempt, events: plan.events, inheritedEventCount: plan.inheritedEventCount, meta: plan.meta };
}

// A new durable identity is written through the host. The active original is never replaced.
// A readable failed creation retries the same identity; an unreadable partial log fails closed.
export async function importRecoverySession(
  engine,
  ctx,
  { id, side, expectedHash, workspaceId, sourceProjectOnly = false },
  loadCatalog = hostSessionCatalog,
) {
  const hostContext = ctx;
  ctx = hostServices(ctx);
  if (!capable(ctx)) throw new Error('此宿主缺少会话导入或读回接口');
  if (engine.inFlight) throw new Error('同步正在进行，请稍后导入');
  const release = engine.acquireProcessLock();
  if (!release) throw new Error('另一 DSH 进程正在同步，请稍后导入');
  try {
    const record = sourceRecord(engine, id);
    if (record.versions[side]?.bytes > MAX_LOG) throw new Error('会话原件超过 256 MiB，已停止导入');
    const buffer = engine.recovery.version(record, side);
    if (!/^[a-f0-9]{64}$/.test(expectedHash || '') || !buffer || digest(buffer) !== expectedHash)
      throw new Error('请重新预览所选会话原件');
    const workspaces = ctx.workspaceRegistry.list();
    const workspace = sourceProjectOnly
      ? originalWorkspace(workspaces, record)
      : workspaces.find(ws => ws.id === workspaceId);
    if (
      !workspace ||
      !fs.statSync(workspace.path, { throwIfNoEntry: false })?.isDirectory() ||
      path.resolve(workspace.path) === path.resolve(engine.home)
    )
      throw new Error(sourceProjectOnly ? '原项目在本机不可用，已保留两份记录。' : '请选择本机已登记且可用的项目');
    if (sourceProjectOnly && workspace.id !== workspaceId) throw new Error('原会话的项目已变化，请重新打开冲突记录。');
    const catalog = await loadCatalog();
    if (sourceProjectOnly && record.forkHandled) throw new Error('此会话冲突已处理完成');
    const attempt = record.imports?.[side];
    if (sourceProjectOnly && !attempt) {
      if (!engine.recovery.sessionFork(record)) throw new Error('请选择一条会话冲突记录');
      const currentHash = currentConflictHash(engine, record, catalog);
      if (!currentHash || currentHash === expectedHash) throw new Error('当前会话已变化，请重新打开冲突记录。');
    }
    const artifact = decodeRecoverySession(buffer, catalog);
    if (!record.path.includes('/' + artifact.header.id + '/')) throw new Error('原件会话身份与恢复记录不一致');
    const attachmentCount = await verifyAttachments(artifact.events, ctx);
    if (attempt && (attempt.sourceHash !== expectedHash || attempt.workspaceId !== workspace.id))
      throw new Error('此原件已有导入记录，请在原项目继续验收或使用另一侧原件');
    const plan = importPlan(engine, record, side, artifact, workspace, expectedHash, catalog, ctx);
    const target = plan.attempt;
    // Prepare validates seed semantics and projections without publishing a live session.
    const prepared = ctx.sessions.prepare(target.sessionId, {
      seed: plan.events,
      inheritedEventCount: plan.inheritedEventCount,
      meta: plan.meta,
    });
    // Save the host-validated full seed before any new-session bytes are published.
    // Older hosts without public encoders retain the existing read-only fallback.
    if (
      /^[a-f0-9]{64}$/.test(target.planHash || '') &&
      typeof catalog.encodeHeader === 'function' &&
      typeof catalog.encodeEvent === 'function'
    ) {
      const payload = validatedRescuePayload(catalog, prepared, plan);
      target.rescue = prepareImportRescue(engine, record.id, side, target, payload, prepared.header.version);
    }
    let handle,
      appendStarted = false;
    try {
      const found = await ctx.sessionPersistence.stat(target.sessionId);
      registeredWorkspace(ctx.workspaceRegistry, workspace);
      handle = found
        ? await ctx.sessionPersistence.open(target.sessionId, 'write')
        : await ctx.sessionPersistence.create(prepared.header, { inheritedEventCount: plan.inheritedEventCount });
      if (
        handle.header.id !== target.sessionId ||
        handle.header.cwd !== workspace.path ||
        handle.header.createdAt !== plan.meta.createdAt ||
        handle.inheritedEventCount !== plan.inheritedEventCount ||
        handle.header.parentSession !== plan.meta.parentSession ||
        handle.header.isSeeded !== plan.meta.isSeeded
      )
        throw new Error('已有恢复会话的身份或项目已变化');
      const prefix = (await handle.read()).events;
      if (prefix.length > plan.events.length || eventHash(prefix) !== eventHash(plan.events.slice(0, prefix.length)))
        throw new Error('已有恢复会话已修改，停止重复导入');
      appendStarted = true;
      await handle.append(plan.events.slice(prefix.length));
      await handle.flush();
    } catch (e) {
      let staged = false;
      if (handle && appendStarted) {
        try {
          // A seeded partial log may not reopen until its inherited marker exists.
          // Complete a verified prefix through the still-owned public handle before closing.
          const prefix = (await handle.read()).events;
          if (
            prefix.length > plan.events.length ||
            eventHash(prefix) !== eventHash(plan.events.slice(0, prefix.length))
          )
            throw new Error('前缀变化');
          if (prefix.length < plan.events.length) await handle.append(plan.events.slice(prefix.length));
          await handle.flush();
          staged = true;
        } catch {
          /* persistent disk/ownership failures remain unverified and retain the source */
        }
      }
      throw new Error(
        '恢复会话 ' +
          target.sessionId +
          ' 尚未验收完成；' +
          (staged
            ? '已补齐暂存内容，重试会接续同一身份。'
            : target.rescue
              ? '原件保留；若重试仍无法打开，可关闭全部 DSH 后按停机修复指南处理。'
              : '原件保留；若宿主无法重新打开该身份，请勿直接覆盖会话文件。') +
          e.message,
      );
    } finally {
      if (handle) await handle.close();
    }
    const readback = await ctx.sessionQuery.readSession(target.sessionId);
    if (
      readback.session.id !== target.sessionId ||
      readback.session.cwd !== workspace.path ||
      readback.session.parentSession !== plan.meta.parentSession ||
      readback.session.isSeeded !== plan.meta.isSeeded ||
      readback.inheritedEventCount !== plan.inheritedEventCount ||
      eventHash(readback.events) !== eventHash(plan.events)
    )
      throw new Error('恢复会话读回校验失败；原件保留，请重试');
    refreshSessionProjection(hostContext, engine, readback.session, readback.inheritedEventCount, readback.events);
    try {
      const current = registeredWorkspace(ctx.workspaceRegistry, workspace);
      await current.attachSession(target.sessionId);
      if (!registeredWorkspace(ctx.workspaceRegistry, workspace).sessionIds.includes(target.sessionId))
        throw new Error('项目归属读回失败');
    } catch (error) {
      throw new Error(`会话 ${target.sessionId} 已保存，项目归属尚未完成。原件保留。${error.message}`, {
        cause: error,
      });
    }
    const imports = { ...record.imports, [side]: { ...target, status: 'verified', attachmentCount } };
    const sessionConflict = engine.recovery.sessionFork(record);
    const forkReviewKept = sessionConflict ? currentConflictHash(engine, record, catalog) : undefined;
    const conflictComplete =
      Boolean(sessionConflict) &&
      (record.forkHandled === true || !unhandledConflictSides({ ...record, imports, forkReviewKept }).length);
    engine.recovery.finish(id, {
      imports,
      ...(sessionConflict ? { forkReviewKept } : {}),
      ...(conflictComplete ? { reviewState: 'archived' } : {}),
    });
    return {
      ok: true,
      sessionId: target.sessionId,
      sourceSessionId: artifact.header.id,
      attachmentCount,
      workspaceId: workspace.id,
      projectTitle: workspace.title || path.basename(workspace.path),
      conflictComplete,
      restartRequired: true,
      hint: '已创建独立会话并读回校验；刷新或重启 DSH 后在所选项目查看。',
    };
  } finally {
    release();
  }
}
