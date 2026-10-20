/** Lifecycle automation only. Editing and old interval preferences never sync.
 * Exit upload is owned by the host shutdown worker. */
export function createSyncScheduler({ loadConfig, sync, afterSync = () => {}, log = () => {} }) {
  let stopped = false, startupAttempted = false, running = null;
  const enabled = () => !stopped && loadConfig().enabled !== false;
  const runStartup = () => {
    if (running) return running;
    running = Promise.resolve().then(async () => {
      const c = loadConfig();
      if (!enabled() || c.autoPullOnStart === false) return;
      const result = await sync('startup');
      if (!stopped) await afterSync(result, 'startup');
      return result;
    })
      .catch((e) => log('warn', `启动同步失败: ${e?.message || e}`))
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
    stop() { stopped = true; },
  };
}
