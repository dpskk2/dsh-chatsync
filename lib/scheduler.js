/** Lifecycle automation only. Editing and old interval preferences never sync.
 * Exit upload is owned by the host shutdown worker. */
export function createSyncScheduler({ loadConfig, sync, afterSync = () => {}, log = () => {}, clock = globalThis }) {
  let stopped = false, startupAttempted = false, running = null, retry = null, failures = 0;
  const enabled = () => !stopped && loadConfig().enabled !== false;
  const retryLater = () => {
    if (!enabled() || loadConfig().autoPullOnStart === false || retry) return;
    retry = clock.setTimeout(() => { retry = null; runStartup(); }, Math.min(60000, 15000 * 2 ** Math.min(failures++, 2)));
    retry?.unref?.();
  };
  const runStartup = () => {
    if (running) return running;
    running = Promise.resolve().then(async () => {
      const c = loadConfig();
      if (!enabled() || c.autoPullOnStart === false) return;
      const result = await sync('startup');
      if (!stopped) await afterSync(result, 'startup');
      if (result && !result.cancelled && !result.privacy && (result.error || result.deferred || result.downloadPending || result.workspaces?.errors?.length)) retryLater();
      else failures = 0;
      return result;
    })
      .catch((e) => { log('warn', `启动同步失败: ${e?.message || e}`); retryLater(); })
      .finally(() => { running = null; });
    return running;
  };
  function refresh({ startup = false } = {}) {
    if (startup && !startupAttempted) { startupAttempted = true; runStartup(); }
    return enabled();
  }
  return {
    refresh,
    get active() { return enabled(); },
    // Compatibility for older callers; activity is deliberately inert.
    onActivity() {},
    stop() { stopped = true; if (retry) clock.clearTimeout(retry); retry = null; },
  };
}
