export function hostService(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : ctx?.[name];
  } catch {
    return undefined;
  }
}

// DSH 0.2.2-rc.3's native importer refreshes the projection from the complete,
// durable event log before attaching the session to its workspace.
export function refreshSessionProjection(ctx, engine, header, inheritedEventCount, events) {
  try {
    hostService(ctx, 'sessionProjectionCache')?.coldSnapshot?.(header, inheritedEventCount, events);
  } catch {
    // DSH can rebuild this derived cache from the log; the verified session is intact.
    engine.log('warn', '会话列表缓存暂未更新，DSH 可从已保存的会话重建');
  }
}
