/* ---------- 挂载 ---------- */
let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  try {
    const el = document.createElement('style');
    el.setAttribute('data-dsh-chatsync', '');
    el.textContent = STYLE;
    document.head.appendChild(el);
  } catch {
    /* ignore */
  }
}
function apply(ctx) {
  if (typeof ctx.inject === 'function')
    ctx.inject(['layout'], guarded => {
      repairNavigation = guarded.layout;
      guarded.effect(() => () => {
        if (repairNavigation === guarded.layout) repairNavigation = null;
      });
    });
  if (typeof ctx.inject === 'function')
    ctx.inject(['conversation'], guarded => {
      const restore = installSendProtection(guarded.conversation);
      guarded.effect(() => restore);
    });
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'dsh-sync-sidebar-preference', order: 90 },
      SidebarVisibilityProvider,
    ),
  );
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'dsh-sync-startup', order: 100 }, StartupSyncOverlay),
  );
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'dsh-sync-grouping', order: 110 }, GroupingRepairOverlay),
  );
  injectStyles(); // 侧栏胶囊按钮等样式全局注入,不依赖设置分节挂载
  // Same native panel contract as dshmarket; opening it never starts an upload.
  ctx.slots.inject('sidebar.panellist', () => {
    const main = ctx.slots.register({ name: 'main', key: 'dsh-sync', id: 'dsh-sync-panel' }, SyncPanel);
    const repair = ctx.slots.register(
      { name: 'main', key: 'dsh-sync-repair', id: 'dsh-sync-repair-panel' },
      RepairPage,
    );
    let removeEntry = null;
    const show = visible => {
      if (visible && !removeEntry)
        removeEntry = ctx.slots.register(
          { name: 'sidebar.panellist', id: 'dsh-sync', order: 450, label: '同步' },
          SidebarSyncIcon,
        );
      else if (!visible && removeEntry) {
        removeEntry();
        removeEntry = null;
      }
    };
    sidebarBinding = show;
    if (sidebarState.value !== null) show(sidebarState.value);
    return () => {
      if (sidebarBinding === show) sidebarBinding = null;
      removeEntry?.();
      main?.();
      repair?.();
    };
  });
  // 设置面板分节:同步状态卡(只读状态 + 上次结果(含错误) + 立即同步)
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'dsh-sync-manage',
        order: 400,
        label: '同步',
      },
      Section,
    ),
  );
}

module.exports = {
  name: 'dsh-chatsync',
  inject: ['slots'],
  apply,
};
