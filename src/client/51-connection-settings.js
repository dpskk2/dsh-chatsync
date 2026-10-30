function ConnectionSettings({ busy, onSaved, remote, branch, setup = false }) {
  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
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
      e(
        'div',
        { className: 'dss-help-group' },
        '所有托管站都要：安装 ',
        helpLink('Git', 'https://git-scm.com/downloads'),
        '。',
      ),
      e('div', { className: 'dss-help-group' }, '默认仓库，或其他 GitHub 仓库'),
      e(
        'ol',
        null,
        e('li', null, '再安装 ', helpLink('GitHub CLI', 'https://cli.github.com/'), '。'),
        e(
          'li',
          null,
          '打开 Windows 终端运行下面的命令，按提示在浏览器授权：',
          e('code', { className: 'dss-command' }, 'gh auth login --hostname github.com --git-protocol https --web'),
        ),
        e('li', null, '两台电脑登录同一 GitHub 账号，即可使用同一个默认仓库。'),
      ),
      e('div', { className: 'dss-help-group' }, 'Gitee、GitLab 等其他托管站（不需要 GitHub CLI）'),
      e(
        'ol',
        null,
        e(
          'li',
          null,
          'HTTPS 地址：在终端运行一次下面的命令（换成你的仓库地址），在弹出的 Git 登录窗口输入该站的账号和密码或访问令牌，登录会保存在本机。',
          e('code', { className: 'dss-command' }, 'git ls-remote https://gitee.com/用户名/dsh-sync.git'),
        ),
        e(
          'li',
          null,
          'SSH 地址：为这台电脑生成 SSH 密钥，把公钥添加到托管站的「SSH 公钥」设置，再运行 git ls-remote 加仓库地址，确认能读取。',
        ),
        e('li', null, '每台要同步的电脑都做一次。'),
      ),
      e(
        'nav',
        { className: 'dss-links', 'aria-label': '仓库连接帮助' },
        helpLink('GitHub 登录说明', 'https://cli.github.com/manual/gh_auth_login'),
        helpLink('其他托管站说明', DOCS + 'configuration.md#其他-git-托管站'),
        helpLink('代理与高级配置', DOCS + 'configuration.md'),
      ),
    ),
  );
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
