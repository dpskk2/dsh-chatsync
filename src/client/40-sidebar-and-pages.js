/* ---------- 侧栏入口与页面 ---------- */
let sidebarBinding = null,
  preferenceLoad = null;
let pluginPreferences = { config: null, saving: false, error: '' };
const preferenceListeners = new Set();
function publishPreferences(patch) {
  pluginPreferences = { ...pluginPreferences, ...patch };
  for (const listener of preferenceListeners) listener(pluginPreferences);
}
function acceptPreferences(data) {
  if (!data?.ok || !data.config) throw new Error(data?.error || '无法读取插件设置');
  if (pluginPreferences.config?.autoCheckUpdates !== data.config.autoCheckUpdates) updateRequest = null;
  sidebarBinding?.(data.config.showSidebarSync !== false);
  publishPreferences({ config: data.config });
}
function loadPluginPreferences() {
  if (preferenceLoad) return preferenceLoad;
  publishPreferences({ error: '' });
  preferenceLoad = API.config()
    .then(acceptPreferences)
    .catch(error => {
      if (!pluginPreferences.config) sidebarBinding?.(true);
      publishPreferences({ error: error.message || '无法读取插件设置' });
    })
    .finally(() => {
      preferenceLoad = null;
    });
  return preferenceLoad;
}
function usePluginPreferences() {
  const [state, setState] = useState(pluginPreferences);
  useEffect(() => {
    preferenceListeners.add(setState);
    setState(pluginPreferences);
    if (!pluginPreferences.config) loadPluginPreferences();
    return () => preferenceListeners.delete(setState);
  }, []);
  return state;
}
function pluginPreferenceEnabled(config, key) {
  if (key === 'automatic') return config.automatic ?? config.enabled !== false;
  return config[key] !== false;
}
async function togglePluginPreference(key) {
  if (!pluginPreferences.config || pluginPreferences.saving) return;
  const next = !pluginPreferenceEnabled(pluginPreferences.config, key);
  publishPreferences({ saving: true, error: '' });
  try {
    const data = await API.saveConfig({ [key]: next });
    acceptPreferences(data);
    if (pluginPreferenceEnabled(data.config, key) !== next) publishPreferences({ error: '宿主配置固定了此选项。' });
  } catch (error) {
    try {
      acceptPreferences(await API.config());
      publishPreferences({ error: error.message || '保存失败，请重试' });
    } catch {
      publishPreferences({ config: null, error: '保存状态未知，请重新读取。' });
    }
  } finally {
    publishPreferences({ saving: false });
  }
}
function SidebarVisibilityProvider() {
  usePluginPreferences();
  return null;
}
function PluginPreferences({ view } = {}) {
  const { config, saving, error } = usePluginPreferences();
  if (view === 'summary') return null;
  return e(
    'div',
    { className: 'dss-plugin-prefs' },
    ...[
      ['showSidebarSync', '侧边栏显示同步', '关闭后仍可从「设置 → 同步」打开。'],
      ['automatic', '自动同步', '按同步设置中的选项，在启动或退出 DSH 时自动同步。关闭后仍可手动同步。'],
      ['autoCheckUpdates', '自动检查更新', '检查 ChatSync 的新版本并显示更新提醒。'],
    ].map(([key, label, description]) => {
      const checked = Boolean(config && pluginPreferenceEnabled(config, key));
      const descriptionId = 'dss-plugin-preference-' + key;
      return e(
        'div',
        { className: 'dss-rowline', key },
        e('div', { className: 'dss-rowtext' }, e('span', null, label), e('small', { id: descriptionId }, description)),
        e(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-label': label,
            'aria-describedby': descriptionId,
            'aria-checked': checked,
            disabled: !config || saving,
            className: 'dss-switch' + (checked ? ' dss-switch-on' : ''),
            onClick: () => togglePluginPreference(key),
          },
          e('span', { className: 'dss-switch-knob' }),
        ),
      );
    }),
    error ? e('p', { role: 'alert', className: 'dss-err' }, error) : null,
    !config && error ? pill('重新读取', loadPluginPreferences) : null,
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
let conflictRequest = null;
function openSessionConflict(record) {
  conflictRequest = record;
  repairNavigation.selectPanel('dsh-sync-conflict');
}
function SessionConflictPage() {
  const { busy, refresh } = useSync();
  const request = conflictRequest;
  const close = () => repairNavigation.selectPanel('dsh-sync');
  return e(
    ManagementPage,
    { className: 'dss-conflict-page' },
    request
      ? e(RecoveryItem, {
          record: request,
          busy,
          page: true,
          initiallyOpen: true,
          onRestored: refresh,
          onPreviewClosed: close,
        })
      : e(SyncPageHeading, { title: '会话同步冲突' }),
  );
}
const syncBackupTitle = '历史冲突会话备份';
function usePageStart() {
  const root = useRef(null);
  useLayoutEffect(() => {
    const page = root.current;
    if (!page) return;
    const parent = scrollParent(page);
    if (parent) parent.scrollTop = 0;
    page.scrollTop = 0;
    page.focus({ preventScroll: true });
  }, []);
  return root;
}
function ManagementPage({ title, className = '', children }) {
  const root = usePageStart();
  return e(
    'div',
    { className: 'dss-panel dss-management-panel' },
    e(
      'main',
      { className: 'dss-wrap dss-manage-page ' + className, tabIndex: -1, ref: root, 'aria-label': title },
      title ? e(SyncPageHeading, { title }) : null,
      children,
    ),
  );
}
function SyncPageHeading({ title }) {
  return e(
    'header',
    { className: 'dss-page-heading' },
    e('h1', null, title),
    pill('返回同步', () => repairNavigation.selectPanel('dsh-sync')),
  );
}
function ConnectionPage() {
  const { busy, status } = useSync();
  return e(
    ManagementPage,
    { title: '更换同步仓库' },
    e(ConnectionSettings, { manage: true, busy, remote: status?.remote, branch: status?.branch }),
  );
}
function isSyncBackup(record) {
  return Boolean(record.conflictResolution) || record.kind === 'settings-version-reset';
}
function SyncBackupPage() {
  const [section, setSection] = useState('conflicts');
  const [query, setQuery] = useState('');
  const [records, setRecords] = useState(null);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const data = await API.recovery();
      if (!data.ok) throw new Error(data.error);
      setRecords(data.records.filter(isSyncBackup));
      setError('');
    } catch (error) {
      setError(error.message || String(error));
    }
  };
  useEffect(() => {
    load();
  }, []);
  const remove = async () => {
    if (busy || !selection) return;
    setBusy(true);
    setError('');
    try {
      const preview = await API.localStorage('preview', { recoveryId: selection.id });
      if (!preview.ok) throw new Error(preview.error);
      const result = await API.localStorage('apply', { token: preview.token, confirm: true });
      if (!result.ok) throw new Error(result.error || result.results?.find(item => !item.ok)?.error || '删除失败');
      setSelection(null);
      await load();
      setStatus('已删除备份。');
    } catch (error) {
      setError(error.message || String(error));
    } finally {
      setBusy(false);
    }
  };
  const matches = (records || []).filter(
    record =>
      Boolean(record.conflictResolution) === (section === 'conflicts') &&
      [record.projectTitle, record.sessionTitle, record.path]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const projects = Map.groupBy(matches, record => (record.conflictResolution ? record.projectTitle || '' : ''));
  return e(
    ManagementPage,
    { className: 'dss-sync-backups', title: syncBackupTitle },
    e(
      'div',
      { className: 'dss-help-tabs', role: 'group', 'aria-label': '备份类型' },
      ...[
        ['conflicts', '冲突会话'],
        ['settings', '设置'],
      ].map(([id, title]) =>
        e(
          'button',
          {
            key: id,
            type: 'button',
            className: 'dss-help-tab',
            'aria-pressed': id === section,
            onClick: () => {
              setSection(id);
              setQuery('');
            },
          },
          title,
        ),
      ),
    ),
    e('input', {
      className: 'dss-input',
      value: query,
      type: 'search',
      'aria-label': '搜索备份',
      placeholder: section === 'conflicts' ? '搜索项目或会话' : '搜索设置文件',
      onChange: event => setQuery(event.target.value),
    }),
    status ? e('p', { role: 'status' }, status) : null,
    error && !selection ? e('p', { role: 'alert', className: 'dss-err' }, error, ' ', pill('重新读取', load)) : null,
    !records && !error
      ? e('p', { role: 'status' }, '正在读取…')
      : records && !matches.length
        ? e('p', { role: 'status' }, query.trim() ? '没有匹配的备份。' : '暂无备份。')
        : null,
    ...Array.from(projects, ([project, rows]) =>
      e(
        'section',
        { key: project },
        project ? e('h2', { className: 'dss-subtitle' }, '项目「' + project + '」') : null,
        ...rows.map(record =>
          e(
            'div',
            { className: 'dss-backup-record', key: record.id },
            e(RecoveryItem, { record, onRestored: load, readOnly: true }),
            pill(
              '删除备份',
              () => {
                setError('');
                setStatus('');
                setSelection(record);
              },
              { disabled: busy },
            ),
          ),
        ),
      ),
    ),
    selection
      ? e(
          Modal,
          {
            title: '永久删除本机备份？',
            onClose: () => {
              if (!busy) {
                setSelection(null);
                setError('');
              }
            },
          },
          dialogBody(
            e('p', null, selection.sessionTitle || selection.path),
            error ? e('p', { role: 'alert', className: 'dss-err' }, error) : null,
          ),
          dialogActions(
            '',
            pill(
              '取消',
              () => {
                setSelection(null);
                setError('');
              },
              { disabled: busy },
            ),
            pill(busy ? '正在删除…' : '永久删除', remove, { kind: 'danger', disabled: busy }),
          ),
        )
      : null,
  );
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
  const root = usePageStart();
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
      className: 'dss-panel dss-management-panel',
      ref: root,
      tabIndex: -1,
      'aria-label': grouping ? '处理未分组会话' : '修复会话问题（实验性）',
    },
    e(
      'div',
      { className: 'dss-wrap' },
      e('style', null, STYLE),
      e(SyncPageHeading, { title: grouping ? '处理未分组会话' : '修复会话问题（实验性）' }),
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
