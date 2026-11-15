function ConnectionSettings({
  busy,
  onSaved,
  onSavingChange,
  remote,
  branch,
  setup = false,
  candidate,
  manage = false,
  onManage,
}) {
  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [helpTab, setHelpTab] = useState(null);
  const [otherDraft, setOtherDraft] = useState(false);
  const [manageDefault, setManageDefault] = useState(false);
  const [githubOwner, setGithubOwner] = useState(candidate?.defaultOwner || '');
  const original = useRef(null);
  const dirty = useRef(false);
  const savingRef = useRef(false);
  const showForm = config && (editing || (manage && !manageDefault && config.remote));
  const showDefault = config && !showForm && (!config.remote || manageDefault);
  useEffect(() => {
    if (dirty.current) return;
    let alive = true;
    setError('');
    API.config()
      .then(d => {
        if (!d || !d.ok || !d.config) throw new Error((d && d.error) || '无法读取仓库配置');
        if (alive && !dirty.current) {
          original.current = d.config;
          const selected =
            candidate?.expectedRemote === (d.config.remote || '') &&
            candidate.expectedBranch === d.config.branch &&
            candidate.expectedAutoRepo === d.config.autoRepo
              ? candidate
              : null;
          setConfig(selected?.config || d.config);
          setDraft((selected?.config || d.config).remote || '');
          if (setup) setMessage(selected?.hint || '');
        }
      })
      .catch(err => {
        if (alive) setError(err.message || String(err));
      });
    return () => {
      alive = false;
    };
  }, [attempt, remote, branch, candidate, setup]);
  useEffect(() => {
    if (!showDefault || githubOwner) return;
    let alive = true;
    API.githubAccount()
      .then(data => {
        if (alive && data.ok && data.owner) setGithubOwner(data.owner);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [showDefault, githubOwner]);
  const startEditing = (other = false) => {
    if (busy || savingRef.current) return;
    dirty.current = true;
    setDraft(other && config.remoteWeb?.label === 'GitHub' ? '' : config.remote || '');
    setOtherDraft(other);
    setManageDefault(false);
    setEditing(true);
    setHelpTab(other ? 'other' : null);
    setError('');
    setMessage('');
  };
  const chooseDefault = () => {
    if (busy || savingRef.current) return;
    dirty.current = true;
    setManageDefault(true);
    setEditing(false);
    setHelpTab('github');
    setMessage('');
    setError('');
  };
  const cancel = () => {
    if (savingRef.current) return;
    dirty.current = false;
    setEditing(false);
    setOtherDraft(false);
    setManageDefault(false);
    setHelpTab(null);
    setError('');
    setDraft(config.remote || '');
    setAttempt(attempt + 1);
  };
  const save = async event => {
    event.preventDefault();
    if (!config || savingRef.current || busy || (!setup && !manage && config.remote && !editing)) return;
    const address = showDefault ? '' : draft.trim();
    if (showDefault) setHelpTab('github');
    if (!showDefault && !address) {
      setError('请输入私有仓库地址。');
      return;
    }
    const choice = {
      remote: address,
      expectedRemote: original.current.remote || '',
      ...(setup ? { expectedBranch: original.current.branch, expectedAutoRepo: original.current.autoRepo } : {}),
    };
    savingRef.current = true;
    setSaving(true);
    onSavingChange?.(true);
    setMessage('');
    setError('');
    try {
      if (manage && showDefault) {
        const checked = await API.saveConnection({ ...choice, validateOnly: true });
        if (!checked?.ok || !checked.defaultOwner) throw new Error(checked?.error || '无法确认 GitHub 账号，请重试。');
        setGithubOwner(checked.defaultOwner);
      }
      const d = await API.saveConnection(setup ? { ...choice, validateOnly: true } : choice);
      if (!d || !d.ok || !d.config) throw new Error((d && d.error) || '保存失败，请重试');
      if (setup) {
        if (!d.config.remote && !d.defaultOwner) throw new Error('无法确认默认仓库所属的 GitHub 账号，请重试。');
        if (d.defaultOwner) setGithubOwner(d.defaultOwner);
        onSaved?.({ ...choice, remote: d.config.remote, config: d.config, hint: d.hint, defaultOwner: d.defaultOwner });
        return;
      }
      setConfig(d.config);
      original.current = d.config;
      setDraft(d.config.remote || '');
      setEditing(false);
      setManageDefault(false);
      setHelpTab(null);
      dirty.current = false;
      setMessage(d.hint || (d.config.remote ? '已验证并保存同步仓库。' : '已选择 GitHub 仓库。'));
      if (!manage && !d.config.remote) {
        // The default backup connects on the first sync; check gh now so problems show immediately.
        setMessage('已使用默认仓库，正在检查 GitHub 登录…');
        const check = await API.checkConnection().catch(err => ({ ok: false, message: err.message || String(err) }));
        if (check?.ok) setMessage(check.message);
        else {
          setMessage('已使用默认仓库。');
          setError((check && check.message) || '无法检查 GitHub 登录，请稍后重试。');
        }
      }
      onSaved?.();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      savingRef.current = false;
      setSaving(false);
      onSavingChange?.(false);
    }
  };
  const parsedLink = config?.remoteWeb || null;
  const addressTab = showForm ? repositoryHelpTab(draft) : null;
  const addressProvider = addressTab || (otherDraft ? 'other' : defaultHelpTab(config));
  const activeHelpTab = helpTab || addressProvider;
  const autoRepoDescription =
    '使用 GitHub 仓库时，自动创建或复用' +
    (githubOwner ? ' ' + githubOwner + ' ' : '当前登录的 GitHub ') +
    '账号下的 dsh-sync 私有仓库。';
  const selectHelpTab = (id, focus = false) => {
    setHelpTab(id);
    if (focus && typeof document !== 'undefined')
      setTimeout(() => document.getElementById(HELP_TAB_ID + id)?.focus(), 0);
  };
  return e(
    'form',
    {
      className: 'dss-sec dss-setting-card' + (setup ? ' dss-setup-connect' : ''),
      id: 'dss-connect',
      tabIndex: -1,
      onSubmit: save,
    },
    manage
      ? null
      : setup
        ? stepHeading(1, '设置同步仓库')
        : e(
            'div',
            { className: 'dss-storage-head dss-connection-heading' },
            e(
              'div',
              { className: 'dss-title-status' },
              e('h2', { className: 'dss-section-title' }, '同步仓库'),
              config?.remote && parsedLink
                ? e('span', { className: 'dss-status-light', 'data-tone': 'blue' }, '已连接')
                : null,
            ),
            config?.remote
              ? e(
                  'button',
                  {
                    type: 'button',
                    className: 'dss-pill',
                    'aria-expanded': Boolean(showForm),
                    disabled: saving || (busy && !showForm),
                    onClick: showForm ? cancel : onManage || (() => startEditing()),
                  },
                  showForm ? '取消' : '更换同步仓库',
                )
              : null,
          ),
    !config && !error ? e('div', { className: 'dss-desc' }, '正在读取连接设置…') : null,
    error ? e('div', { className: 'dss-err dss-form-error', role: 'alert' }, error) : null,
    !config && error
      ? e('button', { type: 'button', className: 'dss-pill', onClick: () => setAttempt(attempt + 1) }, '重新读取')
      : null,
    config && !showForm && (setup || manage || !config.remote || !parsedLink)
      ? e(
          'div',
          null,
          setup && config.remote && parsedLink && !showDefault
            ? e('span', { className: 'dss-status-light', 'data-tone': 'blue' }, '已选同步仓库')
            : null,
          showDefault
            ? e('div', { className: 'dss-desc' }, autoRepoDescription)
            : parsedLink
              ? null
              : e(
                  'div',
                  { className: 'dss-err', role: 'alert' },
                  '现有地址不受支持，请更换为私有 Git 仓库的 HTTPS 或 SSH 地址。',
                ),
          e(
            'div',
            { className: 'dss-actions dss-connection-actions' },
            showDefault
              ? e(
                  'button',
                  { type: 'submit', className: 'dss-pill', disabled: busy || saving },
                  saving ? (setup ? '正在检查…' : '正在保存…') : '使用 GitHub 仓库',
                )
              : null,
            setup || manage || !config.remote
              ? pill(showDefault ? '使用其他仓库（实验性）' : '更换同步仓库', () => startEditing(showDefault), {
                  disabled: busy || saving,
                })
              : null,
            setup && parsedLink
              ? e(
                  'button',
                  { type: 'submit', className: 'dss-pill dss-primary', disabled: busy || saving },
                  saving ? '正在检查…' : '继续选择内容',
                )
              : null,
          ),
        )
      : null,
    showForm
      ? e(
          'fieldset',
          {
            className: 'dss-connection-form',
            disabled: saving || busy,
            style: { border: 0, margin: 0, padding: 0, minWidth: 0 },
          },
          e(
            'label',
            { className: 'dss-field' },
            '仓库地址',
            e('input', {
              className: 'dss-input',
              type: 'text',
              value: draft,
              required: true,
              placeholder:
                addressProvider === 'github'
                  ? '例如 https://github.com/用户名/dsh-sync.git'
                  : '例如 https://gitee.com/用户名/dsh-sync.git',
              autoComplete: 'off',
              spellCheck: false,
              onChange: ev => {
                dirty.current = true;
                setDraft(ev.target.value);
                const tab = repositoryHelpTab(ev.target.value);
                if (tab) setHelpTab(tab);
                setMessage('');
                setError('');
              },
            }),
          ),
          e(
            'div',
            { className: 'dss-desc' },
            e(
              'p',
              null,
              !otherDraft && addressProvider === 'github'
                ? '填写已有 GitHub 私有仓库的 HTTPS 或 SSH 克隆地址。已有 ChatSync 仓库可以直接用，新建仓库请保持为空。'
                : '从 GitHub、Gitee、GitLab 等托管站的私有仓库复制 HTTPS 或 SSH 克隆地址。已有 ChatSync 仓库可以直接用，新建仓库请保持为空。',
            ),
            otherDraft || addressProvider !== 'github'
              ? e(
                  'p',
                  null,
                  'GitHub 以外的站点还需支持用 HTTPS 检查仓库是否私有。若使用 SSH，同一主机名和路径也要能通过 HTTPS 访问。',
                )
              : null,
          ),
          e(
            'div',
            { className: 'dss-actions dss-connection-actions' },
            e(
              'button',
              { type: 'submit', className: 'dss-pill dss-primary' },
              saving ? (setup ? '正在检查…' : '正在检查并保存…') : setup ? '验证并继续' : '保存仓库设置',
            ),
            manage ? pill('使用 GitHub 仓库', chooseDefault) : null,
            !manage && (setup || !config.remote) ? pill('取消', cancel) : null,
          ),
        )
      : null,
    message ? e('div', { className: 'dss-save-state', role: 'status' }, message) : null,
    setup || manage || showForm
      ? e(
          'section',
          { className: 'dss-tip dss-login-help', 'aria-label': '登录帮助' },
          e('h3', null, '登录帮助'),
          loginHelpTabs(activeHelpTab, selectHelpTab),
          helpTabPanel(activeHelpTab),
        )
      : null,
  );
}

const HELP_TAB_ID = 'dss-login-help-tab-';
const HELP_PANEL_ID = 'dss-login-help-panel';
const HELP_TABS = [
  { id: 'github', label: 'GitHub 仓库' },
  { id: 'other', label: 'Gitee、GitLab 等其他托管站' },
];
/** The help tab for the repository in use: GitHub until another host is connected. */
function defaultHelpTab(config) {
  if (!config || !config.remote) return 'github';
  return config.remoteWeb?.label === 'GitHub' ? 'github' : 'other';
}
function repositoryHelpTab(address) {
  const host = /^(?:(?:https|ssh):\/\/(?:[^@/]+@)?|[^@/:]+@)([a-z0-9.-]+)(?=[:/])/i.exec(address.trim())?.[1];
  return host ? (host.toLowerCase() === 'github.com' ? 'github' : 'other') : null;
}
function loginHelpTabs(active, select) {
  const onKeyDown = event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = HELP_TABS.findIndex(tab => tab.id === active);
    const step = event.key === 'ArrowRight' ? 1 : HELP_TABS.length - 1;
    select(HELP_TABS[(index + step) % HELP_TABS.length].id, true);
  };
  return e(
    'div',
    { className: 'dss-help-tabs', role: 'tablist', 'aria-label': '仓库类型', onKeyDown },
    HELP_TABS.map(tab =>
      e(
        'button',
        {
          key: tab.id,
          type: 'button',
          role: 'tab',
          id: HELP_TAB_ID + tab.id,
          className: 'dss-help-tab',
          'aria-selected': tab.id === active,
          'aria-controls': HELP_PANEL_ID,
          tabIndex: tab.id === active ? 0 : -1,
          onClick: () => select(tab.id),
        },
        tab.label,
      ),
    ),
  );
}
// Annotated, account-free picture of the gh auth login terminal output.
function githubLoginDiagram() {
  const badge = n => e('span', { className: 'dss-gh-badge', 'aria-hidden': true }, n);
  const row = (n, line, note, dim = false) =>
    e(
      'div',
      { className: 'dss-gh-row' + (n ? ' dss-gh-act' : '') + (dim ? ' dss-gh-dim' : '') },
      e('span', { className: 'dss-gh-n' }, n ? badge(n) : null),
      e('span', { className: 'dss-gh-t' }, ...line),
      note ? e('span', { className: 'dss-gh-note' }, note) : null,
    );
  const warn = e('span', { className: 'dss-gh-warn' }, '!');
  const ok = e('span', { className: 'dss-gh-ok' }, '✓');
  return e(
    'div',
    {
      className: 'dss-gh-diagram dss-gh-term',
      role: 'img',
      'aria-label':
        '终端授权过程示意：1 粘贴命令并按 Enter；2 输入 Y 并按 Enter；3 一次性代码已自动复制；4 按 Enter 打开授权页；5 终端显示 Logged in as 你的用户名，授权完成',
    },
    e('div', { className: 'dss-gh-bar' }, 'Windows PowerShell'),
    row(1, ['PS C:\\Users\\你> gh auth login --hostname github.com --git-protocol https --web'], '粘贴命令，按 Enter'),
    row(
      null,
      [warn, ' Did you know that expiring tokens can be requested with --expiring? …'],
      '提示信息，不用管',
      true,
    ),
    row(
      2,
      [
        e('span', { className: 'dss-gh-ok' }, '?'),
        ' Authenticate Git with your GitHub credentials? (Y/n) ',
        e('span', { className: 'dss-gh-you' }, 'Y'),
      ],
      '输入 Y，按 Enter',
    ),
    row(
      3,
      [warn, ' One-time code (', e('span', { className: 'dss-gh-code' }, 'ABCD-1234'), ') copied to clipboard'],
      '一次性代码，已经自动复制好了',
    ),
    row(
      4,
      [
        'Press ',
        e('span', { className: 'dss-gh-you' }, 'Enter'),
        ' to open https://github.com/login/device in your browser...',
      ],
      '再按一次 Enter，浏览器会打开授权页',
    ),
    row(null, [ok, ' Authentication complete.']),
    row(5, [ok, ' Logged in as 你的用户名'], '看到这一行就完成了，回到这里点「立即同步」'),
  );
}
const GIT_DOWNLOAD = () => e('li', null, '安装 ', helpLink('Git', 'https://git-scm.com/downloads'));
function helpTabPanel(active) {
  let body;
  if (active === 'github')
    body = [
      e(
        'ol',
        { key: 'steps' },
        GIT_DOWNLOAD(),
        e('li', null, '安装 ', helpLink('GitHub CLI', 'https://cli.github.com/')),
        e(
          'li',
          null,
          '在“终端”运行',
          e('code', { className: 'dss-command' }, 'gh auth login --hostname github.com --git-protocol https --web'),
          e(
            'strong',
            { className: 'dss-gh-proxy' },
            '如需通过代理访问 GitHub，请确保已通过环境变量为 GitHub CLI（gh）配置可用代理，或已启用能够代理 GitHub 流量的 TUN 模式',
          ),
        ),
        e('li', null, '根据指引完成授权。'),
      ),
      e('div', { key: 'diagram' }, githubLoginDiagram()),
    ];
  else
    body = [
      e(
        'ol',
        { key: 'steps' },
        GIT_DOWNLOAD(),
        e(
          'li',
          null,
          'HTTPS 地址：打开“终端”，运行（换成你的仓库地址）',
          e('code', { className: 'dss-command' }, 'git ls-remote https://gitee.com/用户名/dsh-sync.git'),
          '按 Git 的提示输入该站的账号和密码或访问令牌。',
          e(
            'div',
            { className: 'dss-help-alt' },
            '或 SSH 地址：为这台电脑生成 SSH 密钥，把公钥添加到托管站的「SSH 公钥」设置，再运行 git ls-remote 加仓库地址。',
          ),
        ),
      ),
      e(
        'nav',
        { key: 'links', className: 'dss-links', 'aria-label': '其他托管站帮助' },
        helpLink('其他托管站说明', DOCS + 'configuration.md#其他-git-托管站'),
      ),
    ];
  return e(
    'div',
    {
      className: 'dss-help-panel',
      role: 'tabpanel',
      id: HELP_PANEL_ID,
      'aria-labelledby': HELP_TAB_ID + active,
    },
    ...body,
  );
}
function WorkspaceLocations({ busy, setup = false, onPendingChange, lastSyncAt }) {
  const [workspaces, setWorkspaces] = useState(null);
  const [paths, setPaths] = useState({}),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState('');
  const [editing, setEditing] = useState('');
  const savingRef = useRef(false);
  const seenSync = useRef(lastSyncAt);
  const load = async () => {
    setPending(true);
    setMessage('');
    try {
      const data = await API.workspaceLocations();
      if (!data.ok) throw new Error(data.error);
      setWorkspaces(data.workspaces || []);
    } catch (error) {
      setMessage(error.message || String(error));
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (setup || pending || seenSync.current === lastSyncAt) return;
    seenSync.current = lastSyncAt;
    load();
  }, [lastSyncAt, pending, setup]);
  const hasUnsavedPath = Boolean(
    workspaces?.some(ws => !ws.localPath || (paths[ws.id] ?? ws.localPath) !== ws.localPath),
  );
  useEffect(() => {
    onPendingChange?.(pending || workspaces === null || hasUnsavedPath);
  }, [onPendingChange, pending, workspaces, hasUnsavedPath]);
  const fields = e(
    'div',
    { className: 'dss-stack' },
    pending ? e('p', { className: 'dss-desc', role: 'status' }, '正在读取…') : null,
    workspaces?.length === 0 ? e('p', { className: 'dss-desc' }, '暂无项目。') : null,
    (workspaces || []).map(ws => {
      const value = paths[ws.id] ?? ws.localPath ?? '';
      const label = '项目「' + ws.title + '」';
      if (ws.localPath && editing !== ws.id)
        return e(
          'div',
          { key: ws.id, className: 'dss-rowline dss-workspace-location-row' },
          e('div', { className: 'dss-rowtext' }, label, e('span', { className: 'dss-desc' }, ws.localPath)),
          e(
            'button',
            {
              type: 'button',
              className: 'dss-pill',
              disabled: busy || pending,
              'aria-label': '更改' + label + '的本机目录',
              onClick: () => {
                setEditing(ws.id);
                setPaths({});
                setMessage('');
              },
            },
            '更改',
          ),
        );
      return e(
        'div',
        { key: ws.id, className: 'dss-workspace-location-field' },
        e(
          'label',
          { className: 'dss-field' },
          label + '的本机目录',
          e('input', {
            className: 'dss-input',
            value,
            disabled: busy || pending,
            onChange: event => {
              setPaths({ ...paths, [ws.id]: event.target.value });
              setMessage('');
            },
          }),
        ),
        ws.path && ws.path !== ws.localPath ? e('p', { className: 'dss-desc' }, '项目登记位置：' + ws.path) : null,
        e(
          'div',
          { className: 'dss-workspace-location-buttons' },
          e(
            'button',
            {
              type: 'button',
              className: 'dss-pill',
              disabled: busy || pending || !value.trim() || value === ws.localPath,
              onClick: async () => {
                if (busy || savingRef.current) return;
                savingRef.current = true;
                setPending(true);
                setMessage('');
                try {
                  const data = await API.dataRepair('workspace-path', {
                    workspaceId: ws.id,
                    localPath: value.trim(),
                  });
                  if (!data.ok) throw new Error(data.error);
                  const localPath = data.localPath || value.trim();
                  setWorkspaces(previous => previous.map(item => (item.id === ws.id ? { ...item, localPath } : item)));
                  setPaths(previous => ({ ...previous, [ws.id]: localPath }));
                  setEditing('');
                  setMessage(data.hint || '已保存本机位置。');
                } catch (error) {
                  setMessage(error.message || String(error));
                } finally {
                  savingRef.current = false;
                  setPending(false);
                }
              },
            },
            '保存本机位置',
          ),
          ws.localPath
            ? pill(
                '取消',
                () => {
                  setEditing('');
                  setPaths({});
                  setMessage('');
                },
                { disabled: busy || pending },
              )
            : null,
        ),
      );
    }),
    message ? e('p', { role: 'status', className: 'dss-desc' }, message) : null,
    workspaces === null && !pending
      ? e('button', { type: 'button', className: 'dss-pill', onClick: load }, '重新读取')
      : null,
  );
  return e(
    'section',
    { className: 'dss-span-all dss-workspace-locations' + (setup ? ' dss-setup-workspace-locations' : '') },
    e('h3', { className: 'dss-subtitle', id: 'dss-workspace-locations-title' }, '项目文件保存位置（实验性）'),
    fields,
  );
}

function syncScopeChoices(config) {
  return [
    {
      key: 'sessions',
      label: '会话',
      checked: config.contentScope?.sessions !== false,
      description: '对话记录与项目分组',
    },
    {
      key: 'attachments',
      label: '聊天附件',
      checked: config.contentScope?.attachments !== false,
      description: '上传到对话的图片、文件',
    },
    {
      key: 'settings',
      label: '设置',
      checked: config.contentScope?.settings !== false,
      description: '模型、界面与插件偏好',
    },
    {
      key: 'syncInstructions',
      label: '指令与技能（实验性）',
      checked: config.syncInstructions === true,
      description: 'AGENTS.md 与 skills 文件夹',
    },
    {
      key: 'workspaceSync',
      label: '项目文件',
      checked: config.workspaceSync !== false,
      description: '项目文件夹中的文件',
    },
  ];
}

const EMPTY_SETUP_SCOPE = {
  contentScope: { sessions: false, attachments: false, settings: false },
  syncInstructions: false,
  workspaceSync: false,
};
function SyncPreferences({
  lastSyncAt,
  busy,
  onSaved,
  onChanged,
  onSavingChange,
  setup = false,
  setupScope = EMPTY_SETUP_SCOPE,
  onScopeChange,
}) {
  const [projectLocationsPending, setProjectLocationsPending] = useState(true);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [uncertain, setUncertain] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const savingRef = useRef(false);
  const confirmed = useRef(null);
  const automatic = config?.automatic ?? config?.enabled !== false;
  const accept = actual => {
    acceptPreferences({ ok: true, config: actual });
    confirmed.current = actual;
    setConfig(actual);
    setUncertain(false);
    setSaveFailed(false);
  };
  useEffect(() => {
    let alive = true;
    setError('');
    API.config()
      .then(d => {
        if (!d?.ok || !d.config) throw new Error(d?.error || '无法读取同步偏好');
        if (alive) accept(d.config);
      })
      .catch(err => {
        if (alive) setError(err.message || String(err));
      });
    return () => {
      alive = false;
    };
  }, [attempt]);
  const save = async patch => {
    if (!confirmed.current || savingRef.current || busy || uncertain) return false;
    const previous = confirmed.current;
    savingRef.current = true;
    setSaving(true);
    onSavingChange?.(true);
    setError('');
    setMessage('');
    setConfig({ ...previous, ...patch });
    try {
      const d = await API.saveConfig(patch);
      if (!d?.ok || !d.config) throw new Error(d?.error || '无法确认保存结果');
      const actual = d.config;
      const overridden = Object.keys(patch).some(key =>
        key === 'contentScope'
          ? Object.keys(patch.contentScope).some(k => actual.contentScope?.[k] !== patch.contentScope[k])
          : key === 'automatic'
            ? (actual.automatic ?? actual.enabled !== false) !== patch.automatic
            : actual[key] !== patch[key],
      );
      accept(actual);
      if (overridden) setMessage('受宿主配置限制，已显示实际值');
      onChanged?.();
      return !overridden;
    } catch (err) {
      // A lost response can follow a committed write. Read back before presenting a value.
      try {
        const d = await API.config();
        if (!d?.ok || !d.config) throw new Error('readback failed');
        accept(d.config);
        setError(err.message || String(err));
      } catch {
        setConfig(previous);
        setUncertain(true);
        setError('保存状态未知，请重新读取设置。');
      }
      setSaveFailed(true);
      onChanged?.();
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
      onSavingChange?.(false);
    }
  };
  const choices = config ? syncScopeChoices(setup ? { ...config, ...setupScope } : config) : [];
  const projectsSelected = choices.some(choice => choice.key === 'workspaceSync' && choice.checked);
  const setChoice = (key, checked) => {
    if (setup && key === 'workspaceSync' && checked) setProjectLocationsPending(true);
    const scope = setup ? setupScope : confirmed.current;
    const patch =
      key === 'workspaceSync' || key === 'syncInstructions'
        ? { [key]: checked }
        : {
            contentScope: { sessions: true, attachments: true, settings: true, ...scope.contentScope, [key]: checked },
          };
    return setup ? onScopeChange?.({ ...scope, ...patch }) : save(patch);
  };
  return e(
    'div',
    { className: 'dss-sec dss-setting-card', id: 'dss-scope', tabIndex: -1 },
    setup ? stepHeading(2, '选择同步内容') : e('h2', { className: 'dss-section-title' }, '同步设置'),
    !config && !error ? e('div', { className: 'dss-desc' }, '正在读取偏好…') : null,
    error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null,
    (!config && error) || uncertain || (setup && saveFailed)
      ? e('button', { type: 'button', className: 'dss-pill', onClick: () => setAttempt(attempt + 1) }, '重新读取')
      : null,
    config
      ? e(
          'fieldset',
          {
            className: 'dss-scope-fields',
            disabled: saving || busy || uncertain,
            style: { border: 0, margin: 0, padding: 0, minWidth: 0 },
          },
          choices.map(({ key, label, description, checked }) =>
            e(
              'label',
              { key, className: 'dss-check' },
              e('input', {
                type: 'checkbox',
                'aria-label': key === 'syncInstructions' ? '指令与技能' : label,
                checked,
                'aria-describedby': key === 'workspaceSync' && checked ? 'dss-workspace-locations-title' : undefined,
                onChange: event => setChoice(key, event.target.checked),
              }),
              e('span', { className: 'dss-choice' }, label, e('small', null, description)),
            ),
          ),
          projectsSelected
            ? e(WorkspaceLocations, {
                busy: busy || saving || uncertain,
                setup,
                lastSyncAt,
                onPendingChange: setup ? setProjectLocationsPending : undefined,
              })
            : null,
          e(
            'div',
            { className: 'dss-rowline dss-subsection-heading dss-span-all' },
            e('div', { className: 'dss-rowtext' }, e('h4', { className: 'dss-subtitle' }, '自动同步（实验性）')),
            e(
              'button',
              {
                type: 'button',
                role: 'switch',
                'aria-label': '自动同步',
                'aria-checked': automatic,
                className: 'dss-switch' + (automatic ? ' dss-switch-on' : ''),
                onClick: () => save({ automatic: !automatic }),
              },
              e('span', { className: 'dss-switch-knob' }),
            ),
          ),
          !automatic ? e('div', { className: 'dss-desc dss-span-all' }, '自动操作已暂停，仍可手动同步') : null,
          e(
            'div',
            { className: 'dss-auto-options dss-span-all' },
            e(
              'label',
              { className: 'dss-check' },
              e('input', {
                type: 'checkbox',
                'aria-label': '启动时自动同步',
                checked: config.autoPullOnStart !== false,
                onChange: event => save({ autoPullOnStart: event.target.checked }),
              }),
              e('span', { className: 'dss-choice' }, '启动时自动同步'),
            ),
            e(
              'label',
              { className: 'dss-check' },
              e('input', {
                type: 'checkbox',
                'aria-label': '退出时自动同步',
                checked: config.autoPushOnExit !== false,
                onChange: event => save({ autoPushOnExit: event.target.checked }),
              }),
              e('span', { className: 'dss-choice' }, '退出时自动同步'),
            ),
          ),
          setup
            ? e(
                'button',
                {
                  type: 'button',
                  className: 'dss-pill dss-primary',
                  disabled:
                    saveFailed ||
                    !choices.some(choice => choice.checked) ||
                    (projectsSelected && projectLocationsPending),
                  style: { marginTop: '12px' },
                  'data-continue': 'true',
                  onClick: async () => {
                    if (
                      !choices.some(choice => choice.checked) ||
                      saveFailed ||
                      (projectsSelected && projectLocationsPending)
                    )
                      return;
                    if (await save(setupScope)) onSaved?.(confirmed.current);
                  },
                },
                '继续',
              )
            : null,
        )
      : null,
    e('div', { className: 'dss-save-state', role: 'status', 'aria-live': 'polite' }, saving ? '正在保存…' : message),
  );
}

function isRecoveryJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function withoutJsonWhitespace(text) {
  return text.replace(/"(?:[^"\\]|\\.)*"|[ \t\r\n]+/g, token => (token[0] === '"' ? token : ''));
}

function recoveryRows(left, right, ignoreWhitespace = false) {
  const lines = text => (text ? text.split(/\r?\n/) : []);
  const leftLines = lines(left),
    rightLines = lines(right);
  const documents = ignoreWhitespace && isRecoveryJson(left) && isRecoveryJson(right);
  const keys = original => {
    if (!ignoreWhitespace) return original;
    return original.map(line => {
      if (!line.trim()) return null;
      // Compare lexemes without reserializing values or changing original line numbers.
      return documents || isRecoveryJson(line) ? withoutJsonWhitespace(line) : line;
    });
  };
  const a = keys(leftLines),
    b = keys(rightLines);
  const reflowed = documents && withoutJsonWhitespace(left) === withoutJsonWhitespace(right);
  const comparison = alignRecoveryRows(a, b);
  return {
    ...comparison,
    rows: comparison.rows.map(([i, j, different]) => [
      leftLines[i],
      rightLines[j],
      i == null ? null : i + 1,
      j == null ? null : j + 1,
      different && !reflowed,
    ]),
  };
}

function alignRecoveryRows(a, b) {
  const indices = keys => keys.flatMap((key, i) => (key === null ? [] : [i]));
  const left = indices(a),
    right = indices(b);
  const shared = Math.min(left.length, right.length);
  let prefix = 0,
    suffix = 0;
  while (prefix < shared && a[left[prefix]] === b[right[prefix]]) prefix++;
  while (prefix + suffix < shared && a[left[left.length - 1 - suffix]] === b[right[right.length - 1 - suffix]])
    suffix++;
  const x = left.slice(prefix, left.length - suffix),
    y = right.slice(prefix, right.length - suffix);
  // Bound memory and work for large logs; never present positional rows as an exact diff.
  const length = Math.max(a.length, b.length);
  if (length > 3000 || (x.length + 1) * (y.length + 1) > 400000) {
    return {
      limited: true,
      clipped: length > 3000,
      rows: Array.from({ length: Math.min(3000, length) }, (_, i) => [
        i < a.length ? i : null,
        i < b.length ? i : null,
        false,
      ]),
    };
  }
  const table = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      table[i][j] = a[x[i]] === b[y[j]] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const rows = [];
  let ai = 0,
    bi = 0;
  const add = (i, j, different) => {
    while (a[ai] === null || b[bi] === null)
      rows.push([a[ai] === null ? ai++ : null, b[bi] === null ? bi++ : null, false]);
    if (i != null) ai = i + 1;
    if (j != null) bi = j + 1;
    if (i != null || j != null) rows.push([i, j, different]);
  };
  for (let i = 0; i < prefix; i++) add(left[i], right[i], false);
  let i = 0,
    j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && a[x[i]] === b[y[j]]) {
      add(x[i++], y[j++], false);
    } else if (i < x.length && (j === y.length || table[i + 1][j] >= table[i][j + 1])) {
      add(x[i++], null, true);
    } else {
      add(null, y[j++], true);
    }
  }
  for (let i = suffix; i > 0; i--) add(left[left.length - i], right[right.length - i], false);
  add(null, null, false);
  // Keep equal rows and real blank lines as anchors. Pair opposing edits
  // within each block so replacements can be read side by side.
  const aligned = [];
  let local = [],
    remote = [];
  const flush = () => {
    for (let index = 0; index < Math.max(local.length, remote.length); index++)
      aligned.push([local[index] ?? null, remote[index] ?? null, true]);
    local = [];
    remote = [];
  };
  for (const [i, j, changed] of rows) {
    if (changed) {
      if (i != null) local.push(i);
      if (j != null) remote.push(j);
    } else {
      flush();
      aligned.push([i, j, false]);
    }
  }
  flush();
  return { limited: false, rows: aligned };
}
