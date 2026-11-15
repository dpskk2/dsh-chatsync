// HTTP layer of the plugin entry (lib/index.js): recovery, repair and local storage routes.
import path from 'node:path';
import { recoveryCategory, unhandledConflictSides } from '../recovery.js';
import { recoveryGuide } from '../recovery-guide.js';
import { sessionRecoveryOptions, importRecoverySession } from '../session-recovery.js';
import { previewSessionRelocation, importRelocatedSession } from '../session-relocation.js';
import { saveSyncStatus } from '../session-safety.js';
import { scheduleOfflineSync } from '../host-sync.js';
import { desktopRestartSupported } from '../sync.js';
import {
  scanDataHealth,
  workspaceLocations,
  previewDataRepair,
  previewDataRollback,
  queueDataRepair,
  queuedDataRepairs,
  cancelQueuedDataRepairs,
  pendingDataVerification,
  acknowledgeDataRepairs,
} from '../data-health.js';
import { compareRecoveryBranches, preserveRecoveryBranches, keepCurrentConflictVersion } from '../branch-history.js';
import { canonicalWorkspacePath, checkWorkspaceDirectory, workspacePathsOverlap } from '../workspace-target.js';
import { isLocalAbsolute } from '../workspace-path.js';
import { scanLocalStorage, previewStorageCleanup, applyStorageCleanup, saveStoragePolicy } from '../local-storage.js';
import { listSyncedSessions } from '../synced-sessions.js';
import { removeSessionsFromSync } from '../session-removals.js';
import { recordSessionTitle, sessionPreview } from '../session-info.js';
import { sessionIdOfLogPath, sessionIdPattern } from '../session-path.js';
import { json, readBody } from './guard.js';

export function storageRoutes({ engine }) {
  return [
    ...['scan', 'preview', 'apply', 'policy'].map(action => ({
      kind: 'exact',
      path: '/dsh-sync/api/local-storage/' + action,
      handler: async (req, res) => {
        if (req.method !== (action === 'scan' ? 'GET' : 'POST'))
          return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          const body = action === 'scan' ? {} : JSON.parse((await readBody(req)) || '{}');
          const result =
            action === 'scan'
              ? await scanLocalStorage(engine)
              : action === 'preview'
                ? await previewStorageCleanup(engine, body)
                : action === 'apply'
                  ? await applyStorageCleanup(engine, body)
                  : saveStoragePolicy(engine, body);
          json(res, 200, result);
        } catch (error) {
          json(res, 200, { ok: false, error: error.message });
        }
      },
    })),
  ];
}

export function recordsRoutes(deps) {
  return [...recoveryRoutes(deps), ...dataHealthRoutes(deps), ...sessionListRoutes(deps)];
}

function recoveryRoutes({ ctx, engine, dshVersion }) {
  return [
    ...[
      ['preview', () => engine.localPreview()],
      ['doctor', () => engine.doctor()],
      [
        'recovery',
        () => {
          const records = engine.recovery.list();
          const projects = new Map();
          if (records.some(record => record.conflictResolution)) {
            try {
              const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : ctx.workspaceRegistry;
              for (const project of registry?.list() || []) {
                for (const id of project.sessionIds || [])
                  projects.set(id, projects.has(id) ? null : project.title || path.basename(project.path || ''));
              }
            } catch {
              // Recovery copies remain available when the host registry is absent.
            }
          }
          return {
            records: records.map(record => {
              const sessionConflict = Boolean(engine.recovery.sessionFork(record));
              const canArchive = record.status === 'deferred' && sessionConflict;
              const conflictComplete =
                sessionConflict && (Boolean(record.forkHandled) || !unhandledConflictSides(record).length);
              return {
                ...record,
                category: conflictComplete
                  ? 'history'
                  : canArchive && record.reviewState !== 'archived'
                    ? 'attention'
                    : recoveryCategory(record),
                canArchive,
                sessionConflict,
                conflictComplete,
                guide: recoveryGuide(record, dshVersion),
                sessionTitle: recordSessionTitle(engine, record),
                ...(record.conflictResolution ? { projectTitle: projects.get(sessionIdOfLogPath(record.path)) } : {}),
              };
            }),
            pendingSessionForks: engine.recovery.pendingSessionForks(records),
          };
        },
      ],
    ].map((/** @type {[string, () => object]} */ [endpoint, operation]) => ({
      kind: 'exact',
      path: '/dsh-sync/api/' + endpoint,
      handler: async (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          json(res, 200, { ok: true, ...(await operation()) });
        } catch (e) {
          json(res, 200, { ok: false, error: e.message });
        }
      },
    })),
    ...['preview', 'restore', 'import-session', 'resolve-session', 'preserve-branches', 'archive'].map(action => ({
      kind: 'exact',
      path: '/dsh-sync/api/recovery/' + action,
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          const body = JSON.parse(await readBody(req));
          if (action === 'archive') {
            if (engine.inFlight) throw new Error('同步正在进行，请稍后归档');
            const release = engine.acquireProcessLock();
            if (!release) throw new Error('另一 DSH 进程正在同步，请稍后归档');
            try {
              return json(res, 200, engine.recovery.archive(body.id, body.expectedVersions, body.archived !== false));
            } finally {
              release();
            }
          }
          if (action === 'preview') {
            let branches = null;
            if (!body.offsets) {
              try {
                branches = await compareRecoveryBranches(engine, body.id);
              } catch {}
            }
            return json(res, 200, {
              ok: true,
              ...engine.recoveryPreview(body.id, { offsets: body.offsets }),
              branches,
              sessionImport: await sessionRecoveryOptions(engine, ctx, body.id),
            });
          }
          if (action === 'resolve-session') return json(res, 200, await keepCurrentConflictVersion(engine, body));
          if (action === 'preserve-branches') return json(res, 200, await preserveRecoveryBranches(engine, ctx, body));
          if (action === 'import-session') return json(res, 200, await importRecoverySession(engine, ctx, body));
          if (body.expectedHash !== null && !/^[a-f0-9]{64}$/.test(body.expectedHash || ''))
            throw new Error('请先预览当前文件');
          json(res, 200, await engine.restoreRecovery(body.id, body.side, body.expectedHash));
        } catch (e) {
          json(res, 200, { ok: false, error: e.message });
        }
      },
    })),
  ];
}

function dataHealthRoutes({ ctx, engine, home, startup }) {
  return [
    ...['scan', 'workspaces', 'preview', 'queue', 'restart', 'cancel', 'workspace-path', 'import', 'verify'].map(
      action => ({
        kind: 'exact',
        path: '/dsh-sync/api/data-health/' + action,
        handler: async (req, res) => {
          if (req.method !== (['scan', 'workspaces'].includes(action) ? 'GET' : 'POST'))
            return json(res, 405, { ok: false, error: 'method not allowed' });
          try {
            if (action === 'workspaces') return json(res, 200, { ok: true, workspaces: workspaceLocations(engine) });
            if (action === 'scan')
              return json(res, 200, {
                ok: true,
                ...scanDataHealth(engine),
                verificationPending: pendingDataVerification(engine).length > 0,
                closeAndRepair: desktopRestartSupported(),
              });
            const body = JSON.parse(await readBody(req));
            if (action === 'preview') {
              const scan = scanDataHealth(engine);
              const issue =
                scan.issues.find(item => item.key === body.key) ||
                (body.relocate
                  ? scan.ungroupedSessions.find(item => item.key === body.key || item.sessionId === body.sessionId)
                  : null);
              if (issue?.kind === 'relocate' || body.relocate)
                return json(res, 200, { ok: true, ...(await previewSessionRelocation(engine, ctx, issue)) });
              return json(res, 200, {
                ok: true,
                ...(body.backupId ? previewDataRollback(engine, body.backupId) : await previewDataRepair(engine, body)),
              });
            }
            if (engine.inFlight) throw new Error('同步正在进行，请完成后再修复');
            if (action === 'verify') {
              const verified = acknowledgeDataRepairs(engine);
              engine.lastOutcome = { repaired: true, verificationAcknowledged: true };
              saveSyncStatus(home, engine.lastOutcome, 'data-verified');
              return json(res, 200, { ok: true, ...verified });
            }
            if (action === 'import') return json(res, 200, await importRelocatedSession(engine, ctx, body));
            if (action === 'workspace-path') {
              const workspaces = engine.workspaces();
              const input = typeof body.localPath === 'string' ? body.localPath.trim() : '';
              if (!workspaces.some(ws => ws.id === body.workspaceId) || !isLocalAbsolute(input))
                throw new Error('请选择已登记项目并填写本机完整目录。');
              const localPath = path.normalize(input);
              const { canonical, exists } = checkWorkspaceDirectory(localPath);
              if (workspacePathsOverlap(canonical, canonicalWorkspacePath(home)))
                throw new Error('项目目录不能与 DSH 数据目录重叠。');
              const config = engine.loadConfig();
              for (const ws of workspaces) {
                if (ws.id === body.workspaceId) continue;
                const other = engine.workspaceRealPathOf(ws, config);
                // A project on an unavailable drive can be fixed independently.
                let otherCanonical;
                try {
                  otherCanonical = other && canonicalWorkspacePath(other);
                } catch {
                  continue;
                }
                if (otherCanonical && workspacePathsOverlap(canonical, otherCanonical))
                  throw new Error(`此目录与项目「${ws.title || ws.path}」的本机目录重叠。`);
              }
              engine.setLocalWorkspacePath(body.workspaceId, localPath);
              return json(res, 200, {
                ok: true,
                localPath,
                hint: exists
                  ? '已保存本机位置，文件夹可访问。'
                  : '已保存本机位置，首次取回项目文件时将创建这个文件夹。',
              });
            }
            if (action === 'cancel') return json(res, 200, { ok: true, ...cancelQueuedDataRepairs(engine) });
            if (action === 'queue') return json(res, 200, { ok: true, ...queueDataRepair(engine, body.planId) });
            const activity = engine.sessionActivity();
            if (!activity.available || activity.activeCount > 0) throw new Error('请等待当前对话结束，再关闭并修复');
            if (!queuedDataRepairs(engine).length) throw new Error('没有已确认的修复计划');
            const result = scheduleOfflineSync(engine, { repair: true });
            if (!result.scheduled) throw new Error(result.reason);
            startup.phase = 'restarting';
            json(res, 200, { ok: true, hint: '将关闭应用，修复已确认的项目，然后重新打开；不会连接同步仓库。' });
          } catch (e) {
            json(res, 200, { ok: false, error: e.message });
          }
        },
      }),
    ),
  ];
}

// The sync page lists the synced sessions and removes chosen ones from sync.
function sessionListRoutes({ engine }) {
  return [
    {
      kind: 'exact',
      path: '/dsh-sync/api/sessions',
      handler: async (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          json(res, 200, listSyncedSessions(engine));
        } catch (error) {
          json(res, 200, { ok: false, error: error.message });
        }
      },
    },
    {
      kind: 'exact',
      path: '/dsh-sync/api/sessions/preview',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          const { id } = JSON.parse((await readBody(req)) || '{}');
          if (!sessionIdPattern.test(String(id || ''))) throw new Error('会话编号无效');
          json(res, 200, await sessionPreview(engine, id));
        } catch (error) {
          json(res, 200, { ok: false, error: error.message });
        }
      },
    },
    {
      kind: 'exact',
      path: '/dsh-sync/api/sessions/remove',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          if (engine.inFlight) throw new Error('同步正在进行，请完成后再操作');
          const body = JSON.parse((await readBody(req)) || '{}');
          json(res, 200, { ok: true, ...removeSessionsFromSync(engine, body?.ids) });
        } catch (error) {
          json(res, 200, { ok: false, error: error.message });
        }
      },
    },
  ];
}
