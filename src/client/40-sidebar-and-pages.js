/* ---------- 侧栏入口与页面 ---------- */
let sidebarBinding = null,
  sidebarLoad = null;
let sidebarState = { value: null, loading: false, saving: false, error: '' };
const sidebarListeners = new Set();
function publishSidebarState(patch) {
  sidebarState = { ...sidebarState, ...patch };
  for (const listener of sidebarListeners) listener(sidebarState);
}
function acceptSidebarConfig(data) {
  if (!data?.ok || !data.config) throw new Error(data?.error || '无法读取侧边栏设置');
  const value = data.config.showSidebarSync !== false;
  sidebarBinding?.(value);
  publishSidebarState({ value });
  return value;
}
function loadSidebarPreference() {
  if (sidebarLoad) return sidebarLoad;
  publishSidebarState({ loading: true, error: '' });
  sidebarLoad = API.config()
    .then(acceptSidebarConfig)
    .catch(error => {
      if (sidebarState.value === null) sidebarBinding?.(true);
      publishSidebarState({ error: error.message || '无法读取侧边栏设置' });
    })
    .finally(() => {
      sidebarLoad = null;
      publishSidebarState({ loading: false });
    });
  return sidebarLoad;
}
function useSidebarPreference() {
  const [state, setState] = useState(sidebarState);
  useEffect(() => {
    sidebarListeners.add(setState);
    setState(sidebarState);
    if (sidebarState.value === null) loadSidebarPreference();
    return () => sidebarListeners.delete(setState);
  }, []);
  return state;
}
async function toggleSidebarPreference() {
  if (sidebarState.value === null || sidebarState.saving) return;
  const next = !sidebarState.value;
  publishSidebarState({ saving: true, error: '' });
  try {
    const actual = acceptSidebarConfig(await API.saveConfig({ showSidebarSync: next }));
    if (actual !== next) publishSidebarState({ error: '受宿主设置限制，已显示实际选择。' });
  } catch (error) {
    try {
      acceptSidebarConfig(await API.config());
      publishSidebarState({ error: error.message || '保存失败，请重试' });
    } catch {
      publishSidebarState({ value: null, error: '保存状态未知，请重新读取。' });
    }
  } finally {
    publishSidebarState({ saving: false });
  }
}
function SidebarVisibilityProvider() {
  useSidebarPreference();
  return null;
}
function SidebarVisibilityToggle() {
  const state = useSidebarPreference();
  return e(
    'div',
    { className: 'dss-sidebar-pref' },
    e('span', null, '侧边栏显示同步'),
    e(
      'button',
      {
        type: 'button',
        role: 'switch',
        'aria-label': '在侧边栏显示同步',
        'aria-checked': state.value === true,
        'aria-busy': state.loading || state.saving,
        disabled: state.value === null || state.saving,
        className: 'dss-switch' + (state.value === true ? ' dss-switch-on' : ''),
        onClick: toggleSidebarPreference,
      },
      e('span', { className: 'dss-switch-knob' }),
    ),
    state.error ? e('span', { role: 'alert', className: 'dss-err' }, state.error) : null,
    state.value === null && state.error
      ? e(
          'button',
          { type: 'button', className: 'dss-pill', disabled: state.loading, onClick: loadSidebarPreference },
          '重新读取',
        )
      : null,
  );
}

function SidebarSyncIcon(props = {}) {
  const { busy, progress, status } = useSync();
  const title = busy ? progress?.label || '同步中…' : status?.lastOk === false ? '同步需要处理，点击查看' : '打开同步';
  return e(
    'span',
    { className: 'dss-nav-progress', title, 'aria-label': title },
    e(SyncIcon, { spin: busy, size: props.size || 16 }),
  );
}
function SyncPanel() {
  return e('div', { className: 'dss-panel' }, e(Section));
}
let repairNavigation = null,
  repairRequest = { mode: 'all', sequence: 0 };
const repairListeners = new Set();
function openRepairPage(request = {}) {
  if (!repairNavigation) throw new Error('处理页面尚未就绪，请稍后重试');
  repairRequest = { ...request, sequence: repairRequest.sequence + 1 };
  repairNavigation.selectPanel('dsh-sync-repair');
  for (const listener of repairListeners) listener(repairRequest);
}
function RepairPage() {
  const [request, setRequest] = useState(repairRequest);
  const { busy, refresh } = useSync();
  useEffect(() => {
    repairListeners.add(setRequest);
    return () => repairListeners.delete(setRequest);
  }, []);
  const grouping = request.mode === 'grouping';
  return e(
    'main',
    {
      id: 'dss-repair-page',
      className: 'dss-panel',
      'aria-label': grouping ? '处理未分组会话' : '修复会话问题（实验性）',
    },
    e(
      'div',
      { className: 'dss-wrap' },
      e('style', null, STYLE),
      e(
        'header',
        { className: 'dss-repair-heading' },
        e('h1', null, grouping ? '处理未分组会话' : '修复会话问题（实验性）'),
        e(
          'button',
          { type: 'button', className: 'dss-pill', onClick: () => repairNavigation.selectPanel('dsh-sync') },
          '返回同步',
        ),
      ),
      e(DataHealth, {
        key: request.sequence,
        expanded: true,
        grouping,
        initialIssueKey: request.initialIssueKey,
        busy,
        onVerified: refresh,
      }),
    ),
  );
}

function recoveryFileInfo(record) {
  const file = record.path.replace(/\\/g, '/');
  if (typeof record.sessionTitle === 'string')
    return {
      name:
        '会话「' +
        (record.sessionTitle || '未命名') +
        '」' +
        (/^storages\/session_projcache\//.test(file) ? '的列表信息' : ''),
      location: '',
    };
  const project = record.kind === 'ws' || record.kind === 'restore-backup';
  const title =
    record.guide?.title ||
    (/^storages\/sync-meta\/.+\.vmap\.json$/.test(file) ? '同步内部账本' : project ? '项目文件' : '用途待确认');
  return {
    name: file.split('/').pop() + '（' + title + '）',
    location: '文件地址：' + (project ? file : '.dsh/' + file),
  };
}
