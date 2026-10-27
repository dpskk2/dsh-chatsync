// HTTP layer of the plugin entry (lib/index.js): recovery, repair and local storage routes.
import path from 'node:path';
import { previewWorkspaceHistory, applyWorkspaceHistory } from '../workspace-history.js';
import { recoveryCategory } from '../recovery.js';
import { recoveryGuide } from '../recovery-guide.js';
import { sessionRecoveryOptions, importRecoverySession } from '../session-recovery.js';
import { previewSessionRelocation, importRelocatedSession } from '../session-relocation.js';
import { saveSyncStatus } from '../session-safety.js';
import { scheduleOfflineSync } from '../host-sync.js';
import {
  scanDataHealth,
  previewDataRepair,
  previewDataRollback,
  queueDataRepair,
  queuedDataRepairs,
  cancelQueuedDataRepairs,
  pendingDataVerification,
  acknowledgeDataRepairs,
} from '../data-health.js';
import { compareRecoveryBranches, preserveRecoveryBranches } from '../branch-history.js';
import { canonicalWorkspacePath } from '../workspace-target.js';
import { scanLocalStorage, previewStorageCleanup, applyStorageCleanup, saveStoragePolicy } from '../local-storage.js';
import { listSyncedSessions } from '../synced-sessions.js';
import { removeSessionsFromSync } from '../session-removals.js';
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
        () => ({
          records: engine.recovery.list().map(record => ({
            ...record,
            category: recoveryCategory(record),
            guide: recoveryGuide(record, dshVersion),
          })),
        }),
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
    ...['preview', 'apply'].map(action => ({
      kind: 'exact',
      path: '/dsh-sync/api/workspace-history/' + action,
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          const body = JSON.parse(await readBody(req));
          json(
            res,
            200,
            action === 'preview'
              ? await previewWorkspaceHistory(engine, body.workspaceId)
              : await applyWorkspaceHistory(engine, body.previewId),
          );
        } catch (error) {
          json(res, 200, { ok: false, error: error.message });
        }
      },
    })),
    ...['preview', 'restore', 'import-session', 'preserve-branches', 'archive'].map(action => ({
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
            try {
              branches = await compareRecoveryBranches(engine, body.id);
            } catch {}
            return json(res, 200, {
              ok: true,
              ...engine.recoveryPreview(body.id),
              branches,
              sessionImport: await sessionRecoveryOptions(engine, ctx, body.id),
            });
          }
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
    ...['scan', 'preview', 'queue', 'restart', 'cancel', 'workspace-path', 'import', 'verify'].map(action => ({
      kind: 'exact',
      path: '/dsh-sync/api/data-health/' + action,
      handler: async (req, res) => {
        if (req.method !== (action === 'scan' ? 'GET' : 'POST'))
          return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          if (action === 'scan')
            return json(res, 200, {
              ok: true,
              ...scanDataHealth(engine),
              verificationPending: pendingDataVerification(engine).length > 0,
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
            if (!engine.workspaces().some(ws => ws.id === body.workspaceId) || !path.isAbsolute(body.localPath || ''))
              throw new Error('请选择已登记项目并填写本机完整目录');
            const target = canonicalWorkspacePath(body.localPath),
              data = canonicalWorkspacePath(home);
            if (target === data || target.startsWith(data + path.sep) || data.startsWith(target + path.sep))
              throw new Error('项目目录不能与 DSH 数据目录重叠');
            engine.setLocalWorkspacePath(body.workspaceId, body.localPath);
            return json(res, 200, { ok: true, hint: '已保存本机项目位置，下次同步前会重新核对目录是否重叠。' });
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
    })),
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
