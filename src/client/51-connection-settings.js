function ConnectionSettings({ busy, onSaved, remote, branch, setup = false }) {
  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [helpTab, setHelpTab] = useState(null);
  const dirty = useRef(false);
  const savingRef = useRef(false);
  useEffect(() => {
    if (dirty.current) return;
    let alive = true;
    setError('');
    API.config()
      .then(d => {
        if (!d || !d.ok || !d.config) throw new Error((d && d.error) || '无法读取仓库配置');
        if (alive && !dirty.current) {
          setConfig(d.config);
          setDraft(d.config.remote || '');
        }
      })
      .catch(err => {
        if (alive) setError(err.message || String(err));
      });
    return () => {
      alive = false;
    };
  }, [attempt, remote, branch]);
  const startEditing = () => {
    if (busy || savingRef.current) return;
    dirty.current = true;
    setDraft(config.remote || '');
    setEditing(true);
    setError('');
    setMessage('');
  };
  const cancel = () => {
    if (savingRef.current) return;
    dirty.current = false;
    setEditing(false);
    setError('');
    setDraft(config.remote || '');
    setAttempt(attempt + 1);
  };
  const save = async event => {
    event.preventDefault();
    if (!config || savingRef.current || busy || (config.remote && !editing)) return;
    savingRef.current = true;
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const d = await API.saveConnection({ remote: draft.trim(), expectedRemote: config.remote || '' });
      if (!d || !d.ok || !d.config) throw new Error((d && d.error) || '保存失败，请重试');
      setConfig(d.config);
      setDraft(d.config.remote || '');
      setEditing(false);
      dirty.current = false;
      setMessage(
        d.hint ||
          (d.config.remote ? '已验证并保存同步仓库。' : '已使用默认仓库；首次同步时自动创建或复用 dsh-sync 私有仓库。'),
      );
      let ready = true;
      if (!d.config.remote) {
        // The default backup connects on the first sync; check gh now so problems show immediately.
        setMessage('已使用默认仓库，正在检查 GitHub 登录…');
        const check = await API.checkConnection().catch(err => ({ ok: false, message: err.message || String(err) }));
        ready = Boolean(check && check.ok);
        if (ready) setMessage(check.message);
        else {
          setMessage('已使用默认仓库。');
          setError((check && check.message) || '无法检查 GitHub 登录，请稍后重试。');
        }
      }
      // In setup, stay on this step when the check failed, so the reason stays visible.
      if (onSaved && (ready || !setup)) onSaved();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const showForm = config && editing;
  const parsedLink = config?.remoteWeb || null;
  // Login help opens on the tab for the repository in use; a choice lasts for this page only.
  const activeHelpTab = helpTab || defaultHelpTab(config);
  const selectHelpTab = (id, focus = false) => {
    setHelpTab(id);
    if (focus && typeof document !== 'undefined')
      setTimeout(() => document.getElementById(HELP_TAB_ID + id)?.focus(), 0);
  };
  return e(
    'form',
    { className: 'dss-sec dss-setting-card', id: 'dss-connect', tabIndex: -1, onSubmit: save },
    setup ? stepHeading(1, '设置同步仓库') : e('h2', { className: 'dss-section-title' }, '同步仓库'),
    !config && !error ? e('div', { className: 'dss-desc' }, '正在读取连接设置…') : null,
    error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null,
    !config && error
      ? e('button', { type: 'button', className: 'dss-pill', onClick: () => setAttempt(attempt + 1) }, '重新读取')
      : null,
    config && !showForm
      ? e(
          'div',
          null,
          e(
            'div',
            { className: 'dss-connection-status' },
            config.remote ? (parsedLink ? '已连接同步仓库' : '请更换同步仓库') : '使用默认仓库',
          ),
          !config.remote
            ? e(
                'div',
                { className: 'dss-desc' },
                '首次同步时，自动创建或复用当前 GitHub 账号下的 dsh-sync 私有仓库。想放在 Gitee、GitLab 等其他托管站，点「使用其他仓库」。',
              )
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
            !config.remote
              ? e(
                  'button',
                  { type: 'submit', className: 'dss-pill', disabled: busy || saving },
                  saving ? '正在保存…' : setup ? '使用默认仓库并继续' : '使用默认仓库',
                )
              : null,
            e(
              'button',
              { type: 'button', className: 'dss-pill', disabled: busy || saving, onClick: startEditing },
              config.remote ? '更换同步仓库' : '使用其他仓库',
            ),
            setup && config.remote
              ? e(
                  'button',
                  { type: 'button', className: 'dss-pill', disabled: busy || saving, onClick: () => onSaved?.() },
                  '继续选择内容',
                )
              : null,
          ),
          parsedLink
            ? e(
                'nav',
                { className: 'dss-links', 'aria-label': '同步仓库' },
                helpLink('在 ' + parsedLink.label + ' 查看仓库', parsedLink.url),
              )
            : null,
        )
      : null,
    showForm
      ? e(
          'fieldset',
          { disabled: saving || busy, style: { border: 0, margin: 0, padding: 0, minWidth: 0 } },
          e(
            'div',
            { className: 'dss-desc' },
            '默认使用当前 GitHub 账号下的 dsh-sync 私有仓库，首次同步时自动创建或复用。',
          ),
          e(
            'label',
            { className: 'dss-field' },
            '自定义仓库地址（可选）',
            e('input', {
              className: 'dss-input',
              type: 'text',
              value: draft,
              placeholder: '例如 https://gitee.com/用户名/dsh-sync.git 或 git@gitee.com:用户名/dsh-sync.git',
              autoComplete: 'off',
              spellCheck: false,
              onChange: ev => {
                dirty.current = true;
                setDraft(ev.target.value);
                setMessage('');
                setError('');
              },
            }),
          ),
          e(
            'div',
            { className: 'dss-desc' },
            '先在托管站网页创建空的私有仓库（不要勾选用 README 初始化），再填写地址。支持 GitHub、Gitee、GitLab 等的 HTTPS 或 SSH 地址；保存时检查仓库是否私有，以及这台电脑能否读取。',
          ),
          editing ? e('div', { className: 'dss-desc' }, '留空并保存可改用默认仓库。原仓库中的内容会保留。') : null,
          e(
            'div',
            { className: 'dss-actions dss-connection-actions' },
            e(
              'button',
              { type: 'submit', className: 'dss-pill dss-primary' },
              saving ? '正在检查并保存…' : setup ? '保存并选择内容' : '保存仓库设置',
            ),
            editing ? e('button', { type: 'button', className: 'dss-pill', onClick: cancel }, '取消') : null,
          ),
        )
      : null,
    message ? e('div', { className: 'dss-save-state', role: 'status' }, message) : null,
    e(
      'details',
      { className: 'dss-tip', open: config ? !config.remote : false },
      e('summary', null, '登录帮助'),
      loginHelpTabs(activeHelpTab, selectHelpTab),
      helpTabPanel(activeHelpTab),
    ),
  );
}

const HELP_TAB_ID = 'dss-login-help-tab-';
const HELP_PANEL_ID = 'dss-login-help-panel';
const HELP_TABS = [
  { id: 'github', label: 'GitHub 仓库' },
  { id: 'other', label: 'Gitee、GitLab 等其他托管站' },
  { id: 'self-hosted', label: '自建服务器（实验性）' },
];
/** The help tab for the repository in use: GitHub until another host or a server is connected. */
function defaultHelpTab(config) {
  if (!config || !config.remote) return 'github';
  if (config.selfHosted) return 'self-hosted';
  return config.remoteWeb?.label === 'GitHub' ? 'github' : 'other';
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
// Annotated, account-free picture of `gh auth login`: the terminal stays dark in
// both themes, the browser step uses the host's colours.
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
  const key = label => e('kbd', { className: 'dss-gh-key' }, label);
  const warn = e('span', { className: 'dss-gh-warn' }, '!');
  const ok = e('span', { className: 'dss-gh-ok' }, '✓');
  return e(
    'div',
    { className: 'dss-gh-diagram' },
    e('div', { className: 'dss-gh-cap' }, '终端里会看到这些（蓝色是你要做的）'),
    e(
      'div',
      {
        className: 'dss-gh-term',
        role: 'img',
        'aria-label':
          '终端授权过程示意：1 粘贴命令并按 Enter；2 输入 Y 并按 Enter；3 一次性代码已自动复制；4 再按一次 Enter 打开浏览器授权页',
      },
      e('div', { className: 'dss-gh-bar' }, 'Windows PowerShell'),
      row(
        1,
        ['PS C:\\Users\\你> gh auth login --hostname github.com --git-protocol https --web'],
        '粘贴命令，按 Enter',
      ),
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
    ),
    e(
      'div',
      { className: 'dss-gh-browser', role: 'group', 'aria-label': '浏览器中的步骤' },
      e('div', { className: 'dss-gh-url' }, 'github.com/login/device'),
      e(
        'ol',
        { className: 'dss-gh-steps' },
        e('li', null, badge(5), e('span', null, '没登录 GitHub 时先登录；没有账号就点 Sign up 注册一个')),
        e(
          'li',
          null,
          badge(6),
          e('span', null, '在代码框里按 ', key('Ctrl'), ' + ', key('V'), ' 粘贴一次性代码，点 Continue'),
        ),
        e('li', null, badge(7), e('span', null, '点 Authorize 确认授权，看到授权成功后回到终端')),
      ),
    ),
    e(
      'div',
      {
        className: 'dss-gh-term dss-gh-done',
        role: 'img',
        'aria-label': '授权完成示意：8 终端显示 Logged in as 你的用户名，回到这里点立即同步',
      },
      row(null, [ok, ' Authentication complete.']),
      row(8, [ok, ' Logged in as 你的用户名'], '看到这一行就完成了，回到这里点「立即同步」'),
    ),
  );
}
const GIT_DOWNLOAD = () => e('li', null, '安装 ', helpLink('Git', 'https://git-scm.com/downloads'));
function helpTabPanel(active, selfHosted) {
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
          '打开“终端”（如需通过代理访问 GitHub，请确保已通过环境变量为 GitHub CLI（gh）配置可用代理，或已启用能够代理 GitHub 流量的 TUN 模式。），运行',
          e('code', { className: 'dss-command' }, 'gh auth login --hostname github.com --git-protocol https --web'),
        ),
        e('li', null, '根据指引完成授权（输入 Y，点击 Enter 打开授权页，输入“终端”显示的一次性代码）'),
      ),
      e('div', { key: 'diagram' }, githubLoginDiagram()),
      e(
        'nav',
        { key: 'links', className: 'dss-links', 'aria-label': 'GitHub 登录帮助' },
        helpLink('GitHub 登录说明', 'https://cli.github.com/manual/gh_auth_login'),
        helpLink('代理与高级配置', DOCS + 'configuration.md'),
      ),
    ];
  else if (active === 'other')
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
  else body = selfHostedHelp(selfHosted);
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
function selfHostedHelp() {
  return [
    e(
      'ol',
      { key: 'steps' },
      GIT_DOWNLOAD(),
      e('li', null, '在服务器上建空仓库：', e('code', { className: 'dss-command' }, 'git init --bare dsh-sync.git')),
      e(
        'li',
        null,
        '为这台电脑生成 SSH 密钥（',
        e('code', null, 'ssh-keygen -t ed25519'),
        '），把公钥加入服务器的 ',
        e('code', null, '~/.ssh/authorized_keys'),
      ),
      e(
        'li',
        null,
        '打开“终端”，运行',
        e('code', { className: 'dss-command' }, 'git ls-remote 用户名@服务器地址:dsh-sync.git'),
        '首次连接输入 yes 确认服务器指纹',
      ),
      e('li', null, '在下方填写地址并保存'),
    ),
    e(
      'nav',
      { key: 'links', className: 'dss-links', 'aria-label': '自建服务器帮助' },
      helpLink('自建服务器说明', DOCS + 'configuration.md#自建-ssh-服务器实验性'),
    ),
  ];
}
function WorkspaceLocations({ busy }) {
  const [open, setOpen] = useState(false),
    [workspaces, setWorkspaces] = useState(null);
  const [paths, setPaths] = useState({}),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState('');
  const savingRef = useRef(false);
  const load = async () => {
    setPending(true);
    setMessage('');
    try {
      const data = await API.dataHealth();
      if (!data.ok) throw new Error(data.error);
      setWorkspaces(data.workspaces || []);
    } catch (error) {
      setMessage(error.message || String(error));
    } finally {
      setPending(false);
    }
  };
  return e(
    'details',
    {
      className: 'dss-utility-card dss-workspace-locations',
      open,
      onToggle: event => {
        const next = event.currentTarget.open;
        setOpen(next);
        if (next && workspaces === null && !pending) load();
      },
    },
    e('summary', null, '项目文件保存位置（实验性）'),
    open
      ? e(
          'div',
          { className: 'dss-stack' },
          e(
            'p',
            { className: 'dss-desc' },
            '选择项目文件同步到这台电脑时的保存位置。换电脑后盘符或目录不同时，可在这里调整。每个项目使用单独的文件夹。',
          ),
          pending ? e('p', { className: 'dss-desc', role: 'status' }, '正在读取…') : null,
          workspaces?.length === 0 ? e('p', { className: 'dss-desc' }, '暂无项目。') : null,
          (workspaces || []).map(ws =>
            e(
              'label',
              { key: ws.id, className: 'dss-field' },
              ws.title,
              e('input', {
                className: 'dss-input',
                value: paths[ws.id] ?? ws.localPath,
                disabled: busy || pending,
                onChange: event => setPaths({ ...paths, [ws.id]: event.target.value }),
              }),
              e(
                'button',
                {
                  type: 'button',
                  className: 'dss-pill',
                  disabled: busy || pending,
                  onClick: async () => {
                    if (busy || savingRef.current) return;
                    savingRef.current = true;
                    setPending(true);
                    setMessage('');
                    try {
                      const data = await API.dataRepair('workspace-path', {
                        workspaceId: ws.id,
                        localPath: paths[ws.id] ?? ws.localPath,
                      });
                      if (!data.ok) throw new Error(data.error);
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
            ),
          ),
          message ? e('p', { role: 'status', className: 'dss-desc' }, message) : null,
          workspaces === null && !pending
            ? e('button', { type: 'button', className: 'dss-pill', onClick: load }, '重新读取')
            : null,
        )
      : null,
  );
}

function SyncPreferences({ busy, onSaved, onChanged, onSavingChange, setup = false }) {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [uncertain, setUncertain] = useState(false);
  const savingRef = useRef(false);
  const confirmed = useRef(null);
  const automatic = config?.automatic ?? config?.enabled !== false;
  const accept = actual => {
    confirmed.current = actual;
    setConfig(actual);
    setUncertain(false);
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
      setMessage(overridden ? '受宿主配置限制，已显示实际值' : '已保存');
      onChanged?.();
      return true;
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
      onChanged?.();
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
      onSavingChange?.(false);
    }
  };
  return e(
    'div',
    { className: 'dss-sec dss-setting-card', id: 'dss-scope', tabIndex: -1 },
    setup ? stepHeading(2, '选择同步内容') : e('h2', { className: 'dss-section-title' }, '同步内容'),
    !config && !error ? e('div', { className: 'dss-desc' }, '正在读取偏好…') : null,
    error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null,
    (!config && error) || uncertain
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
          [
            ['sessions', '会话', '对话记录与项目分组'],
            ['attachments', '聊天附件', '上传或附加到对话的图片、文件'],
            ['settings', '设置', '模型、界面与插件偏好'],
          ].map(([key, label, description]) =>
            e(
              'label',
              { key, className: 'dss-check' },
              e('input', {
                type: 'checkbox',
                'aria-label': label,
                checked: config.contentScope?.[key] !== false,
                onChange: event =>
                  save({
                    contentScope: {
                      sessions: true,
                      attachments: true,
                      settings: true,
                      ...confirmed.current.contentScope,
                      [key]: event.target.checked,
                    },
                  }),
              }),
              e('span', { className: 'dss-choice' }, label, e('small', null, description)),
            ),
          ),
          e(
            'label',
            { className: 'dss-check' },
            e('input', {
              type: 'checkbox',
              'aria-label': '指令与技能',
              checked: config.syncInstructions === true,
              onChange: event => save({ syncInstructions: event.target.checked }),
            }),
            e(
              'span',
              { className: 'dss-choice' },
              '指令与技能（实验性）',
              e('small', null, '同步全局 AGENTS.md 与 skills 文件夹'),
            ),
          ),
          e(
            'label',
            { className: 'dss-check' },
            e('input', {
              type: 'checkbox',
              'aria-label': '项目文件',
              checked: config.workspaceSync !== false,
              onChange: event => save({ workspaceSync: event.target.checked }),
            }),
            e('span', { className: 'dss-choice' }, '项目文件', e('small', null, '项目文件夹中的文件')),
          ),
          e('div', { className: 'dss-scope-help dss-span-all' }, helpLink('范围与排除规则', DOCS + 'sync-content.md')),
          config.workspaceSync !== false ? e(WorkspaceLocations, { busy: busy || saving || uncertain }) : null,
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
              e(
                'span',
                { className: 'dss-choice' },
                '退出时自动同步',
                e('small', null, '完全退出应用后上传本机改动，下次启动显示结果'),
              ),
            ),
          ),
          setup
            ? e(
                'button',
                {
                  type: 'button',
                  className: 'dss-pill dss-primary',
                  style: { marginTop: '12px' },
                  'data-continue': 'true',
                  onClick: () => {
                    if (!busy && !uncertain && !savingRef.current) onSaved?.();
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

// Compare JSON values without treating indentation, key order or JSONL blank
// lines as changes. String values (including message whitespace) stay exact.
function recoveryContentText(text) {
  const parse = value =>
    JSON.parse(value, (_key, field) => {
      // Preserve the original text when numeric parsing could hide a difference.
      if (typeof field === 'number' && (!Number.isSafeInteger(field) || Object.is(field, -0)))
        throw new Error('保留数值原文');
      return field;
    });
  const sorted = value =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map(key => [key, sorted(value[key])]),
          )
        : value;
  try {
    return JSON.stringify(sorted(parse(text)), null, 2);
  } catch {
    try {
      const lines = text.split(/\r?\n/).filter(line => line.trim());
      if (!lines.length) return text;
      return lines.map(line => JSON.stringify(sorted(parse(line)))).join('\n');
    } catch {
      return text;
    }
  }
}

function recoveryRows(left, right) {
  const a = left.split('\n'),
    b = right.split('\n');
  // Bound memory and work for large logs; never present positional rows as an exact diff.
  if (a.length * b.length > 400000)
    return {
      limited: true,
      clipped: Math.max(a.length, b.length) > 3000,
      rows: Array.from({ length: Math.min(3000, Math.max(a.length, b.length)) }, (_, i) => [
        a[i],
        b[i],
        a[i] === undefined ? null : i + 1,
        b[i] === undefined ? null : i + 1,
      ]),
    };
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const rows = [];
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push([a[i], b[j], ++i, ++j]);
    } else if (i < a.length && (j === b.length || table[i + 1][j] >= table[i][j + 1])) {
      rows.push([a[i], undefined, ++i, null]);
    } else {
      rows.push([undefined, b[j], null, ++j]);
    }
  }
  return { limited: false, rows };
}
