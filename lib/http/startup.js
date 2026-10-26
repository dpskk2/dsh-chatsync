// HTTP layer of the plugin entry (lib/index.js): the startup sync gate.
import { pendingDataVerification } from '../data-health.js';
import { syncIssues } from '../diagnostics.js';
import { summarize, lastDetail } from './summary.js';

export function createStartup({ engine, cfg, previousSync }) {
  // First-run setup stays accessible until a repository has been configured.
  const startupRequired =
    Boolean(cfg.remote) &&
    cfg.autoPullOnStart !== false &&
    cfg.enabled !== false &&
    !pendingDataVerification(engine).length;
  const startup = { required: startupRequired, phase: startupRequired ? 'running' : 'ready', message: '' };
  let startupPromise = null;
  let startupAttempt = 0;
  const runStartup = approval => {
    if (startupPromise) return startupPromise;
    const attempt = ++startupAttempt;
    startup.phase = 'running';
    startup.message = '启动同步中，请稍候…';
    delete startup.review;
    delete startup.issues;
    delete startup.detail;
    startupPromise = engine
      .syncOnce('startup', { forceCommit: true, waitForLock: true, approval })
      .then(result => {
        if (attempt !== startupAttempt) return result;
        if (result.cancelled) {
          startup.phase = 'offline';
          startup.message = '本次同步已取消，离线使用。';
          return result;
        }
        if (result.needsReview && !result.privacy && result.review) {
          startup.review = result.review;
          startup.phase = 'review';
          startup.message = '同步等待你的确认，尚未完成。';
          return result;
        }
        if (result.error || result.workspaces?.errors?.length) {
          startup.issues = syncIssues(result);
          startup.detail = lastDetail(result);
          throw new Error(summarize(result));
        }
        startup.phase = result.downloadPending ? 'pending' : 'ready';
        startup.message = result.downloadPending ? '部分旧会话等待安全写入；新会话与草稿可继续使用。' : '';
        return result;
      })
      .catch(e => {
        if (attempt === startupAttempt) {
          startup.phase = 'error';
          startup.message = e.message;
          startup.issues ||= syncIssues({ error: e.message });
        }
        return { error: e.message };
      })
      .finally(() => {
        startupPromise = null;
      });
    return startupPromise;
  };
  if (
    startup.required &&
    previousSync?.source === 'startup-offline' &&
    !previousSync.result?.needsReview &&
    !/另一 DSH 进程正在同步/.test(previousSync.result?.error || '') &&
    (previousSync.result?.error ||
      previousSync.result?.downloadPending ||
      previousSync.result?.workspaces?.errors?.length)
  ) {
    startup.phase = 'error';
    startup.message = summarize(previousSync.result);
    startup.issues = syncIssues(previousSync.result);
    startup.detail = lastDetail(previousSync.result);
  }
  engine.onSyncOutcome = result => {
    // A later successful manual round supersedes an old offline/review snapshot.
    if (result.error || result.cancelled || result.deferred || result.needsReview || result.downloadPending) return;
    delete startup.review;
    delete startup.issues;
    delete startup.detail;
    startup.phase = 'ready';
    startup.message = '';
  };
  // Going offline abandons the running attempt; its late result is ignored.
  const goOffline = async () => {
    ++startupAttempt; // A late result must not reopen the gate or schedule a restart.
    startup.phase = 'cancelling';
    startup.message = '正在停止同步，已保存的改动会保留…';
    await engine.cancelSync();
    if (startupPromise) await startupPromise;
    startup.phase = 'offline';
    startup.message = '本次离线使用，尚未确认远端最新数据。';
  };
  return { startup, runStartup, goOffline };
}
