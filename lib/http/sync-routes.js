// HTTP layer of the plugin entry (lib/index.js): sync run, status and startup routes.
import fs from 'node:fs';
import { isDesktopHostProcess } from '../sync.js';
import { queuedDataRepairs, pendingDataVerification } from '../data-health.js';
import { groupingRepairStatus } from '../host-grouping.js';
import { json, readBody } from './guard.js';
import { summarize, lastDetail } from './summary.js';

// —— API 路由:供浏览器端原生 UI(侧栏按钮 / 设置同步状态卡)调用 ——
export function syncRoutes(deps) {
  return [...startupRoutes(deps), ...runRoutes(deps), ...statusRoutes(deps)];
}

function startupRoutes({ engine, startup, runStartup, goOffline, checkUpdates }) {
  return [
    {
      kind: 'exact',
      path: '/dsh-sync/api/send-check',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          const body = JSON.parse((await readBody(req)) || '{}');
          const state = engine.sendGuard.check(body?.sessionId);
          json(res, 200, { ok: true, ...state });
        } catch {
          json(res, 400, { ok: false, allowed: false, message: '发送前检查失败，消息未发送。' });
        }
      },
    },
    {
      kind: 'exact',
      path: '/dsh-sync/api/startup',
      handler: async (req, res) => {
        if (req.method === 'GET') return json(res, 200, { ok: true, startup, progress: engine.progress || {} });
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        let body;
        try {
          body = JSON.parse((await readBody(req)) || '{}');
        } catch {
          return json(res, 400, { ok: false, error: '启动同步请求格式无效' });
        }
        if (!body || typeof body !== 'object') return json(res, 400, { ok: false, error: '启动同步请求格式无效' });
        if (body.action === 'offline' && ['running', 'review', 'error', 'cancelling'].includes(startup.phase)) {
          await goOffline();
        } else if (body.action === 'confirm') {
          const answers = startup.review?.id
            ? [startup.review.id, ...(startup.review.alternatives || []).map(choice => choice.id)]
            : [];
          if (startup.phase !== 'review' || !answers.includes(body.approval))
            return json(res, 409, { ok: false, error: '预览已变化，请查看当前内容后重新确认。', startup });
          runStartup(body.approval);
        } else if (body.action === 'retry' && startup.phase !== 'cancelling' && startup.phase !== 'restarting')
          runStartup();
        else return json(res, 400, { ok: false, error: '当前不能执行此操作' });
        json(res, 200, { ok: startup.phase !== 'error', startup });
      },
    },
    {
      kind: 'exact',
      path: '/dsh-sync/api/update',
      handler: async (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
        json(res, 200, await checkUpdates(isDesktopHostProcess() ? 'desktop' : 'web'));
      },
    },
  ];
}

function runRoutes({ engine }) {
  return [
    {
      kind: 'exact',
      path: '/dsh-sync/api/run',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        try {
          // 手动触发:免提交节流,点一下立刻提交
          const body = JSON.parse((await readBody(req)) || '{}');
          const r = await engine.syncOnce('web-button', { forceCommit: true, approval: body.approval });
          json(res, 200, {
            ok:
              !r.error &&
              !r.cancelled &&
              !r.needsReview &&
              !r.downloadPending &&
              !r.deferred &&
              !r.workspaces?.errors?.length,
            summary: summarize(r),
            detail: r,
          });
        } catch (e) {
          json(res, 200, { ok: false, error: String((e && e.message) || e) });
        }
      },
    },
    {
      kind: 'exact',
      path: '/dsh-sync/api/cancel',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        let body;
        try {
          body = JSON.parse((await readBody(req)) || '{}');
        } catch {
          return json(res, 400, { ok: false, error: '取消请求格式无效' });
        }
        if (!body || typeof body.runId !== 'string' || !body.runId)
          return json(res, 400, { ok: false, error: '请先读取当前同步状态' });
        if (!engine.inFlight || engine._syncControl?.id !== body.runId)
          return json(res, 409, { ok: false, error: '本轮同步已结束或已切换，请查看最新状态。' });
        try {
          await engine.cancelSync();
          json(res, 200, { ok: true, runId: body.runId, message: '已停止本轮同步；已完成的保存或上传保留。' });
        } catch (e) {
          json(res, 200, { ok: false, error: e.message });
        }
      },
    },
    {
      kind: 'exact',
      path: '/dsh-sync/api/grouping',
      handler: (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          json(res, 200, { ok: true, ...groupingRepairStatus(engine) });
        } catch (e) {
          json(res, 200, { ok: false, error: e.message });
        }
      },
    },
  ];
}

function statusRoutes({ engine, startup, scheduler, previousSync, buildRevision, dshVersion }) {
  return [
    {
      kind: 'exact',
      path: '/dsh-sync/api/status',
      handler: (req, res) => {
        const c = engine.loadConfig();
        const autoWanted = c.enabled !== false;
        // 会话活动(是否有会话正在生成):供界面提示「重启会打断哪些会话」;探测失败按未知处理,不影响接口
        const activity = engine.sessionActivity({ titles: true });
        const activeIds = Array.isArray(activity.activeIds) ? activity.activeIds.map(String) : [];
        const activeTitles = activity.titles && typeof activity.titles === 'object' ? activity.titles : {};
        json(res, 200, {
          ok: true,
          remote: c.remote || '',
          remoteNotice: c.remote ? '' : engine.remoteNotice(),
          configError: c.configError || null,
          queuedRepairs: queuedDataRepairs(engine).length,
          dataVerificationPending: pendingDataVerification(engine).length > 0,
          autoRepo: c.autoRepo !== false,
          branch: c.branch,
          contentScope: c.contentScope,
          workspaceSync: c.workspaceSync !== false,
          mode: c.mode || 'manual',
          automatic: c.enabled !== false,
          auto: scheduler.active,
          autoConfigured: autoWanted,
          gitMissing: engine.gitMissing,
          workspaceCount: typeof engine.workspaces === 'function' ? engine.workspaces().length : 0,
          ungroupedCount: typeof engine.ungroupedSessionIds === 'function' ? engine.ungroupedSessionIds().length : 0,
          activeSessionCount: activity.activeCount || 0,
          activeSessionIds: activeIds,
          /* 界面显示用:会话名(name 解析不到时为空,由前端退化为工作目录名/短 id) */
          activeSessions: activeIds.slice(0, 5).map(id => ({ id, name: activeTitles[id] || '' })),
          sessionActivitySource: activity.source || 'none',
          lastSyncAt: engine.lastSyncAt,
          lastOk: engine.lastOutcome
            ? !engine.lastOutcome.error &&
              !engine.lastOutcome.cancelled &&
              !engine.lastOutcome.downloadPending &&
              !engine.lastOutcome.deferred &&
              !engine.lastOutcome.workspaces?.errors?.length
            : null,
          lastMessage: engine.lastOutcome ? summarize(engine.lastOutcome) : '',
          lastDetail: lastDetail(engine.lastOutcome),
          startup,
          previousExitSync: previousSync,
          autoRestartAfterRepair: c.autoRestartAfterRepair === true,
          restartAvailable: engine.restartAvailable(),
          hostKind: isDesktopHostProcess() ? 'desktop' : 'web',
          buildRevision,
          dshVersion,
          currentVersion: JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version,
          handoff: engine.handoffStatus(),
        });
      },
    },
    {
      kind: 'exact',
      path: '/dsh-sync/api/progress',
      handler: (req, res) => {
        const p = engine.progress || {};
        json(res, 200, {
          ok: true,
          running: Boolean(p.running),
          runId: engine.inFlight ? engine._syncControl?.id || null : null,
          cancelling: Boolean(engine.inFlight && engine._syncControl?.cancelled),
          canCancel: Boolean(engine.inFlight && engine._syncControl && !engine._syncControl.cancelled),
          stage: p.stage || null,
          label: p.label || '',
          transfer: p.transfer || null,
          startedAt: p.startedAt || 0,
          lastSyncAt: engine.lastSyncAt,
          lastOk: engine.lastOutcome
            ? !engine.lastOutcome.error &&
              !engine.lastOutcome.cancelled &&
              !engine.lastOutcome.needsReview &&
              !engine.lastOutcome.downloadPending &&
              !engine.lastOutcome.deferred &&
              !engine.lastOutcome.workspaces?.errors?.length
            : null,
          lastMessage: engine.lastOutcome ? summarize(engine.lastOutcome) : '',
        });
      },
    },
  ];
}
