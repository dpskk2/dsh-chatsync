function RecoveryComparison({ preview, record, headings = ['本机版本', '云端版本'] }) {
  const single =
    record?.reason === 'local-project-unavailable' &&
    preview.local.sha256 &&
    preview.local.sha256 === preview.remote.sha256;
  const panes = useRef([]),
    [active, setActive] = useState(-1),
    [ignoreWhitespace, setIgnoreWhitespace] = useState(true);
  const original = value => (value.missing ? '' : value.text || '');
  const textual = !preview.local.binary && !preview.remote.binary;
  const comparison = useMemo(
    () =>
      textual
        ? recoveryRows(original(preview.local), original(preview.remote), ignoreWhitespace)
        : { rows: [], limited: false },
    [preview, ignoreWhitespace],
  );
  const changes = comparison.rows.flatMap((row, i) => (row[4] ? [i] : []));
  const jump = direction => {
    if (!changes.length) return;
    const next =
      active < 0 ? (direction < 0 ? changes.length - 1 : 0) : (active + direction + changes.length) % changes.length;
    setActive(next);
    panes.current.forEach(pane => {
      if (pane) pane.scrollTop = changes[next] * 24;
    });
  };
  const scroll = side => event => {
    const other = panes.current[1 - side],
      own = event.currentTarget;
    if (!other) return;
    // Equal row heights and aligned blank rows make a line scroll exact.
    // Equality checks stop reciprocal scroll events without a timing lock.
    if (other.scrollTop !== own.scrollTop) other.scrollTop = own.scrollTop;
    if (other.scrollLeft !== own.scrollLeft) other.scrollLeft = own.scrollLeft;
  };
  const partial = preview.local.truncated || preview.remote.truncated || comparison.clipped;
  const longest = comparison.rows.reduce((max, row) => Math.max(max, row[0]?.length || 0, row[1]?.length || 0), 0);
  return e(
    'div',
    { className: 'dss-comparison' },
    e(
      'div',
      { className: 'dss-diff-tools' },
      e(
        'span',
        { role: 'status' },
        !textual
          ? '此文件不能进行文本差异比较'
          : comparison.limited
            ? '大文件 · 按行查看'
            : changes.length
              ? '已加载内容中有 ' + changes.length + ' 处差异'
              : !!preview.local.missing !== !!preview.remote.missing
                ? '一侧不存在文件；请结合原件状态查看'
                : partial
                  ? '已加载部分相同；完整原件尚未比较'
                  : original(preview.local) !== original(preview.remote)
                    ? '仅空行或排版空白不同'
                    : single
                      ? '保存的会话原件'
                      : '两边内容相同',
      ),
      textual
        ? e(
            'label',
            { className: 'dss-check' },
            e('input', {
              type: 'checkbox',
              checked: ignoreWhitespace,
              onChange: ev => {
                setIgnoreWhitespace(ev.target.checked);
                setActive(-1);
              },
            }),
            '忽略空行和 JSON 排版空白',
          )
        : null,
      changes.length
        ? e(
            'div',
            { className: 'dss-diff-actions' },
            e('button', { type: 'button', className: 'dss-pill', onClick: () => jump(-1) }, '上一处差异'),
            e('button', { type: 'button', className: 'dss-pill', onClick: () => jump(1) }, '下一处差异'),
          )
        : null,
    ),
    comparison.limited ? e('div', { className: 'dss-tip', role: 'status' }, '大文件仅按行号展示，未计算差异。') : null,
    partial ? e('div', { className: 'dss-tip', role: 'status' }, '预览已截断，仅显示部分内容。') : null,
    e(
      'div',
      {
        className: 'dss-diff-grid',
        'aria-label': single ? '迁移前的会话原件' : '双方原件同步滚动比较',
        style: single ? { gridTemplateColumns: 'minmax(0,1fr)' } : undefined,
      },
      (single ? [0] : [0, 1]).map(side => {
        const value = side ? preview.remote : preview.local;
        return e(
          'section',
          { key: side, className: 'dss-diff-side' },
          e(
            'div',
            { className: 'dss-diff-title' },
            single ? '迁移前的会话' : headings[side],
            value.missing ? ' · 此版本没有文件' : '',
          ),
          e(
            'div',
            {
              className: 'dss-diff-pane',
              tabIndex: 0,
              'aria-label': side ? '云端原件内容' : '本机原件内容',
              ref: node => {
                panes.current[side] = node;
              },
              onScroll: scroll(side),
            },
            !textual
              ? e(
                  'div',
                  { className: 'dss-guide' },
                  value.missing
                    ? '此版本不存在文件'
                    : value.binary
                      ? value.hint || '此文件不支持文本预览'
                      : '另一侧不支持文本预览',
                )
              : e(
                  'div',
                  { className: 'dss-diff-lines', style: { minWidth: 'max(100%, ' + (longest + 14) + 'ch)' } },
                  comparison.rows.map((row, index) => {
                    const changed = row[4] && row[side] !== undefined;
                    return e(
                      'div',
                      {
                        key: index,
                        className:
                          'dss-diff-line' +
                          (changed ? (side ? ' dss-diff-add' : ' dss-diff-remove') : '') +
                          (changes[active] === index ? ' dss-diff-active' : ''),
                      },
                      e('span', { className: 'dss-diff-number', 'aria-hidden': true }, row[side + 2] ?? ''),
                      e(
                        'span',
                        { className: 'dss-diff-sign', 'aria-hidden': true },
                        changed ? (side ? '+' : '−') : ' ',
                      ),
                      row[side] ?? '',
                    );
                  }),
                ),
          ),
        );
      }),
    ),
  );
}

function RecoveryDialog({ record, preview, onClose, onMore, loading, headings, locked, page, children }) {
  const [raw, setRaw] = useState(false);
  const { name, location } = recoveryFileInfo(record);
  const project = preview.sessionImport?.sourceProject;
  const note = record.sessionConflict ? (project ? '项目「' + project.title + '」' : null) : location;
  const tools = e(
    'div',
    { className: 'dss-diff-actions' },
    pill(raw ? (preview.local.presentation?.kind === 'conversation' ? '会话预览' : '返回预览') : '原始记录', () =>
      setRaw(value => !value),
    ),
    pill(page ? '返回同步' : '关闭', onClose, { disabled: locked }),
  );
  const comparison = raw
    ? e(RecoveryComparison, { preview, record, headings })
    : e(RecoveryReadableComparison, { preview, record, onMore, loading, headings });
  const footer = e('footer', { className: 'dss-diff-footer' }, children);
  if (page)
    return e(
      'section',
      { className: 'dss-recovery-dialog dss-conflict-comparison', 'aria-label': name },
      e(
        'header',
        { className: 'dss-page-heading dss-conflict-heading' },
        e('div', null, e('h1', null, name), note ? e('p', { className: 'dss-desc' }, note) : null),
        tools,
      ),
      comparison,
      footer,
    );
  return e(Modal, { title: name, note, onClose, comparison: true, tools }, comparison, footer);
}

function RecoveryItem({
  readOnly = false,
  page = false,
  record,
  busy,
  onRestored,
  initiallyOpen = false,
  onPreviewClosed,
  onPreviewFailed,
}) {
  const opener = useRef(null);
  const [preview, setPreview] = useState(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const writing = useRef(false);
  const changed = useRef(false);
  const [saved, setSaved] = useState({});
  const [archived, setArchived] = useState(null);
  const [completed, setCompleted] = useState(false);
  const more = async side => {
    if (!preview || loading) return;
    const sides = side ? [side] : ['local', 'remote'].filter(key => preview[key].presentation?.hasMore);
    if (!sides.length) return;
    setLoading(true);
    try {
      const result = await API.recoveryPreview(
        record.id,
        Object.fromEntries(sides.map(key => [key, preview[key].presentation.nextOffset])),
      );
      if (!result.ok) throw new Error(result.error);
      const expanded = { ...preview };
      for (const key of sides) {
        if (result[key].sha256 !== preview[key].sha256) throw new Error('原件已变化，请重新打开');
        const next = result[key].presentation;
        if (next?.kind !== 'conversation') throw new Error('暂时无法继续读取对话');
        expanded[key] = {
          ...result[key],
          presentation: { ...next, messages: [...preview[key].presentation.messages, ...next.messages] },
        };
      }
      setPreview(expanded);
    } catch (err) {
      setMessage(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };
  const show = async () => {
    if (preview) {
      setPreview(null);
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const d = await API.recoveryPreview(record.id);
      if (!d.ok) throw new Error(d.error);
      const projects = d.sessionImport?.workspaces || [];
      const pending = Object.values(d.record?.imports || {}).find(attempt => attempt.status !== 'verified');
      const original = projects.find(project => project.id === d.sessionImport?.sourceProject?.id);
      setWorkspaceId(pending?.workspaceId || original?.id || (projects.length === 1 ? projects[0].id : ''));
      setArchived(null);
      setSaved({});
      setCompleted(Boolean(record.conflictComplete));
      changed.current = false;
      setPreview(d);
    } catch (err) {
      setMessage(err.message || String(err));
      onPreviewFailed?.(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (initiallyOpen) show();
  }, [initiallyOpen]);
  const restore = async side => {
    if (!preview || loading || busy) return;
    if (
      !window.confirm(
        '将项目文件「' +
          record.path +
          '」恢复为' +
          (side === 'remote' ? '云端' : '当时本机') +
          '版本？当前文件会先备份，此修改会在下次同步时上传。',
      )
    )
      return;
    setLoading(true);
    try {
      const d = await API.recoveryRestore(record.id, side, preview.currentHash);
      if (!d.ok) throw new Error(d.error);
      setMessage('已恢复，原版本已备份。');
      setPreview(null);
      onRestored();
    } catch (err) {
      setMessage(err.message || String(err));
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };
  const currentVersions = preview?.branches?.currentVersions;
  const sourceProject = preview?.sessionImport?.sourceProject;
  const originalAvailable = preview?.sessionImport?.workspaces.some(ws => ws.id === sourceProject?.id);
  const hasCurrentVersion = Boolean(currentVersions?.local || currentVersions?.remote);
  const history = archived ?? record.category === 'history';
  const actionsFinished = completed || (record.sessionConflict && archived === true);
  const headings = record.conflictResolution
    ? ['local', 'remote'].map(side => (record.conflictResolution.kept === side ? '保留的版本' : '舍弃的版本'))
    : ['本机版本', '云端版本'];
  const currentSide =
    currentVersions?.local === true && currentVersions.remote !== true
      ? 'local'
      : currentVersions?.remote === true && currentVersions.local !== true
        ? 'remote'
        : null;
  const keepCurrent = async () => {
    if (!currentSide || writing.current || completed) return;
    writing.current = true;
    setLoading(true);
    setMessage('');
    try {
      const data = await API.recoveryKeepCurrent(record, currentSide);
      if (!data.ok) throw new Error(data.error);
      setCompleted(true);
      setMessage('已保留' + (currentSide === 'local' ? '本机版本' : '云端版本') + '。另一版本已存入历史冲突会话备份。');
      changed.current = true;
      if (onPreviewClosed) onRestored?.();
    } catch (error) {
      setMessage(error.message || String(error));
    } finally {
      writing.current = false;
      setLoading(false);
    }
  };
  const sideView = (side, title) => {
    const value = preview[side];
    if (value.missing) return null;
    if (preview.canRestore)
      return pill('恢复' + title, () => restore(side), { disabled: busy || loading, kind: 'primary' });
    const attempt = preview.record?.imports?.[side] || record.imports?.[side];
    if (!preview.sessionImport?.available) return null;
    if (
      record.sessionConflict &&
      (!originalAvailable ||
        (attempt ? attempt.workspaceId !== sourceProject.id : !hasCurrentVersion || currentVersions[side]))
    )
      return null;
    const imported = saved[side] || attempt?.status === 'verified';
    if (record.conflictComplete || (imported && !completed)) return null;
    return pill(
      record.sessionConflict
        ? '保留两个版本'
        : '另存' + (title === '迁移前会话' ? title : side === 'remote' ? '云端会话' : '本机会话'),
      async () => {
        if (writing.current || imported || completed) return;
        writing.current = true;
        setLoading(true);
        setMessage('');
        try {
          const project = record.sessionConflict
            ? sourceProject
            : preview.sessionImport.workspaces.find(ws => ws.id === workspaceId);
          const d = await API.recoveryImport(
            record.id,
            side,
            record.versions[side].sha256,
            project.id,
            record.sessionConflict,
          );
          if (!d.ok) throw new Error(d.error);
          setSaved(previous => ({ ...previous, [side]: true }));
          setCompleted(Boolean(d.conflictComplete));
          const version = record.sessionConflict ? '另一版本' : title === '迁移前会话' ? '迁移前版本' : title;
          setMessage(
            record.sessionConflict
              ? '项目「' +
                  (d.projectTitle || project.title) +
                  '」中已保留' +
                  recoveryFileInfo(record).name +
                  '的两个版本。' +
                  (d.restartRequired ? '刷新会话列表或重新打开 DSH 后查看。' : '')
              : '已将' +
                  recoveryFileInfo(record).name +
                  '的' +
                  version +
                  '另存到项目「' +
                  (d.projectTitle || project.title) +
                  '」。' +
                  (d.restartRequired ? '刷新会话列表或重新打开 DSH 后查看。' : ''),
          );
          changed.current = true;
          if (onPreviewClosed) onRestored?.();
        } catch (err) {
          setMessage(err.message || String(err));
        } finally {
          writing.current = false;
          setLoading(false);
        }
      },
      {
        disabled:
          busy ||
          loading ||
          imported ||
          completed ||
          (!record.sessionConflict &&
            (Boolean(attempt && attempt.workspaceId !== workspaceId) ||
              !preview.sessionImport.workspaces.some(ws => ws.id === workspaceId))),
        kind: record.sessionConflict ? undefined : 'primary',
      },
    );
  };
  const content = [
    e(
      'div',
      { className: 'dss-recovery-file' },
      e('div', { className: 'dss-h' }, recoveryFileInfo(record).name),
      recoveryFileInfo(record).location
        ? e('div', { className: 'dss-desc dss-recovery-path' }, recoveryFileInfo(record).location)
        : null,
      e(
        'div',
        { className: 'dss-desc' },
        new Date(record.createdAt).toLocaleString() +
          ' · ' +
          (record.reason === 'local-project-unavailable'
            ? record.relocation?.archivedSource &&
              Object.values(record.imports || {}).every(attempt => attempt.status === 'verified')
              ? '已迁移的会话原件'
              : '迁移前的会话原件'
            : record.kind === 'restore-backup'
              ? '恢复前备份'
              : record.kind === 'settings-version-reset'
                ? '清除版本记录前（DSH ' + record.otherVersion + '）'
                : record.sessionConflict
                  ? '会话同步冲突'
                  : record.kind === 'scope-backup'
                    ? '同步前备份'
                    : record.kind === 'data-repair'
                      ? record.status === 'repaired'
                        ? '已完成修复的备份'
                        : '修复预览原件'
                      : record.status !== 'merged'
                        ? '合并未完成'
                        : record.kept === 'local'
                          ? '已保留本机版本'
                          : record.kept === 'remote'
                            ? '已采用云端版本'
                            : '已合并'),
      ),
    ),
    e(
      'button',
      {
        ref: opener,
        type: 'button',
        className: 'dss-pill',
        'aria-expanded': !!preview,
        disabled: loading || (!preview && busy),
        onClick: show,
      },
      loading ? '正在读取…' : preview ? '关闭内容' : '查看内容',
    ),
  ];
  const localAction =
    preview && sideView('local', record.reason === 'local-project-unavailable' ? '迁移前会话' : '本机版本');
  const remoteAction =
    preview && !(preview.local.sha256 && preview.local.sha256 === preview.remote.sha256)
      ? sideView('remote', '云端版本')
      : null;
  const keepAction =
    record.sessionConflict &&
    currentSide &&
    !actionsFinished &&
    !record.conflictComplete &&
    !Object.keys(preview?.record?.imports || record.imports || {}).length
      ? pill('仅保留' + (currentSide === 'local' ? '本机版本' : '云端版本'), keepCurrent, {
          disabled: busy || loading,
        })
      : null;
  const sideActions =
    page && record.sessionConflict
      ? [localAction, remoteAction].map((action, index) => {
          const side = index === 0 ? 'local' : 'remote';
          return e(
            'div',
            { key: side, className: 'dss-conflict-action-side', 'data-side': side },
            currentSide === side && keepAction ? keepAction : action,
          );
        })
      : [localAction, remoteAction, keepAction];
  const archiveAvailable =
    !record.conflictComplete &&
    !record.sessionConflict &&
    (record.canArchive || ['merged', 'applied', 'repaired', 'restored'].includes(record.status)) &&
    !Object.entries(preview?.record?.imports || record.imports || {}).some(
      ([side, attempt]) => attempt.status !== 'verified' && !saved[side],
    );
  const importHint = !preview?.sessionImport?.available
    ? preview?.sessionImport?.hint
    : !originalAvailable
      ? '原项目在本机不可用，已保留两份记录。'
      : !hasCurrentVersion
        ? '无法确认哪份记录对应当前会话，已保留两份记录。'
        : '';
  const comparison = preview
    ? e(
        RecoveryDialog,
        {
          record,
          preview,
          page,
          onMore: more,
          loading,
          headings,
          locked: writing.current,
          onClose: () => {
            if (writing.current) return;
            setPreview(null);
            if (changed.current && !onPreviewClosed) onRestored?.();
            onPreviewClosed?.();
            opener.current?.focus();
          },
        },
        e(
          'div',
          {
            className: 'dss-recovery-actions' + (record.sessionConflict ? ' dss-conflict-actions' : ''),
            hidden: readOnly || record.conflictComplete,
            inert: actionsFinished || undefined,
            'aria-hidden': actionsFinished || undefined,
          },
          !preview.canRestore
            ? null
            : e(
                'div',
                { className: 'dss-tip' },
                '当前文件：' +
                  (preview.currentHash === null
                    ? '本机当前不存在此文件'
                    : preview.currentHash === preview.local?.sha256
                      ? '与当时本机版本一致'
                      : preview.currentHash === preview.remote?.sha256
                        ? '与云端版本一致'
                        : '已有后续更改'),
              ),
          !record.sessionConflict && !preview.canRestore && (localAction || remoteAction)
            ? e(
                'label',
                { className: 'dss-recovery-project' },
                '保存到项目',
                e(
                  'select',
                  {
                    className: 'dss-select',
                    value: workspaceId,
                    disabled: busy || loading,
                    onChange: ev => setWorkspaceId(ev.target.value),
                  },
                  e('option', { value: '' }, '请选择项目'),
                  preview.sessionImport.workspaces.map(ws =>
                    e('option', { key: ws.id, value: ws.id }, '项目「' + ws.title + '」'),
                  ),
                ),
              )
            : null,
          ...sideActions,
          archiveAvailable
            ? e(
                'button',
                {
                  type: 'button',
                  className: 'dss-pill dss-recovery-archive',
                  disabled: busy || loading,
                  onClick: async () => {
                    if (writing.current || completed) return;
                    writing.current = true;
                    setLoading(true);
                    setMessage('');
                    try {
                      const d = await API.recoveryArchive(record, !history);
                      if (!d.ok) throw new Error(d.error);
                      setArchived(!history);
                      setMessage(d.hint);
                      changed.current = true;
                      if (onPreviewClosed) onRestored?.();
                    } catch (err) {
                      setMessage(err.message || String(err));
                    } finally {
                      writing.current = false;
                      setLoading(false);
                    }
                  },
                },
                history ? '放回待查看' : '移入留存备份',
              )
            : null,
        ),
        message
          ? e(
              'div',
              {
                className: 'dss-recovery-feedback' + (actionsFinished ? ' dss-recovery-complete' : ''),
                role: 'status',
              },
              message,
            )
          : null,
        !readOnly &&
          importHint &&
          record.sessionConflict &&
          !record.conflictComplete &&
          !actionsFinished &&
          !message &&
          !localAction &&
          !remoteAction
          ? e('div', { className: 'dss-recovery-feedback', role: 'status' }, importHint)
          : null,
      )
    : null;
  if (page && !comparison)
    return e(
      'section',
      null,
      e(
        'header',
        { className: 'dss-page-heading dss-conflict-heading' },
        e('h1', null, recoveryFileInfo(record).name),
        pill('返回同步', onPreviewClosed),
      ),
      message
        ? e('p', { role: 'alert', className: 'dss-err' }, message, ' ', pill('重新读取', show))
        : e('p', { role: 'status' }, '正在读取…'),
    );
  if (onPreviewClosed) return comparison || (loading ? e('p', { role: 'status' }, '正在读取…') : null);
  return e(
    'article',
    { className: 'dss-recovery-item' },
    ...content,
    comparison,
    message ? e('div', { className: 'dss-desc', role: 'status' }, message) : null,
  );
}
