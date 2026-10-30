/* ---------- 同步仓库与本机存储 ---------- */
// One section with a summary line per kind; lists, choices and confirmations open
// in a dialog whose body scrolls while its buttons stay in view.
function Modal({ title, note, wide = false, onClose, children }) {
  const dialog = useRef(null);
  useDialogWheel(dialog);
  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal?.();
    return () => {
      if (node?.open) node.close();
    };
  }, []);
  return e(
    'dialog',
    {
      ref: dialog,
      className: 'dss-confirm-dialog' + (wide ? ' dss-dialog-wide' : ''),
      'aria-modal': true,
      'aria-label': title,
      onCancel: event => {
        event.preventDefault();
        onClose();
      },
      onKeyDown: event => event.stopPropagation(),
    },
    e(
      'div',
      { className: 'dss-confirm-head' },
      e('h2', null, title),
      note ? e('p', { className: 'dss-desc' }, note) : null,
    ),
    children,
  );
}
function dialogBody(...children) {
  return e('div', { className: 'dss-confirm-body' }, ...children);
}
function dialogActions(status, ...buttons) {
  return e(
    'div',
    { className: 'dss-confirm-actions' },
    e('span', { className: 'dss-confirm-status' }, status || ''),
    ...buttons,
  );
}
function pill(label, onClick, { disabled = false, kind = '' } = {}) {
  return e(
    'button',
    { type: 'button', className: 'dss-pill' + (kind ? ' dss-' + kind : ''), disabled, onClick },
    label,
  );
}
// A folded group: one row with a select-all box, a count and a toggle.
function PickGroup({ title, note, ids, selected, disabled, open, onToggleOpen, onPick, children }) {
  const selectable = ids.filter(Boolean);
  const all = selectable.length > 0 && selectable.every(id => selected.includes(id));
  return e(
    'div',
    { className: 'dss-group' },
    e(
      'div',
      { className: 'dss-group-row' },
      e('input', {
        type: 'checkbox',
        'aria-label': '选中「' + title + '」中的全部',
        checked: all,
        disabled: disabled || !selectable.length,
        onChange: event => onPick(selectable, event.target.checked),
      }),
      e(
        'div',
        { className: 'dss-group-text' },
        e('span', null, title),
        note ? e('small', { className: 'dss-desc' }, note) : null,
      ),
      e(
        'button',
        { type: 'button', className: 'dss-link', 'aria-expanded': Boolean(open), onClick: onToggleOpen },
        open ? '收起' : '展开',
      ),
    ),
    open ? e('div', { className: 'dss-group-items' }, children) : null,
  );
}
function pickRow({ key, label, detail, checked, disabled, onChange }) {
  return e(
    'label',
    { key, className: 'dss-pick' },
    e('input', {
      type: 'checkbox',
      'aria-label': label,
      checked,
      disabled,
      onChange: event => onChange(event.target.checked),
    }),
    e('span', { className: 'dss-choice' }, label, detail ? e('small', null, detail) : null),
  );
}
const togglePick = (setSelected, ids, on) =>
  setSelected(old => (on ? [...new Set([...old, ...ids])] : old.filter(id => !ids.includes(id))));

/* —— 同步的会话 —— */
function sessionLabel(session) {
  return session.title || '未命名会话 · ' + session.id.slice(-8);
}
function sessionGroups(sessions) {
  return [
    {
      key: 'visible',
      title: '在 DSH 中可见',
      rows: sessions.filter(s => !s.archived && s.project !== null),
    },
    { key: 'archived', title: '已归档', rows: sessions.filter(s => s.archived) },
    {
      key: 'hidden',
      title: '在 DSH 中看不到',
      note: '没有登记在任何项目下',
      rows: sessions.filter(s => !s.archived && s.project === null),
    },
  ].filter(group => group.rows.length);
}
function sessionsSummary(data) {
  const archived = data.sessions.filter(s => s.archived).length,
    hidden = data.sessions.filter(s => !s.archived && s.project === null).length;
  const parts = [archived ? '已归档 ' + archived : '', hidden ? 'DSH 中看不到 ' + hidden : ''].filter(Boolean);
  return data.sessions.length + ' 个' + (parts.length ? '（' + parts.join('，') + '）' : '');
}
// The first messages of a session, loaded when the user asks for them.
function SessionPreview({ id }) {
  const [state, setState] = useState(null);
  const load = async () => {
    setState({ loading: true });
    try {
      const d = await API.sessionPreview(id);
      if (!d?.ok) throw new Error(d?.error || '读取失败');
      setState({ data: d });
    } catch (err) {
      setState({ error: err.message || String(err) });
    }
  };
  if (!state) return e('button', { type: 'button', className: 'dss-link', onClick: load }, '预览');
  if (state.loading) return e('span', { className: 'dss-desc' }, '正在读取…');
  if (state.error) return e('span', { className: 'dss-err' }, state.error);
  const d = state.data;
  return e(
    'div',
    { className: 'dss-session-preview' },
    e(
      'small',
      { className: 'dss-desc' },
      d.messages +
        ' 条提问' +
        (d.firstAt ? ' · ' + new Date(d.firstAt).toLocaleString() : '') +
        (d.source === 'history' ? ' · 只在同步历史中' : ''),
    ),
    d.preview.length
      ? d.preview.map((text, i) => e('p', { key: i }, text))
      : e('p', { className: 'dss-desc' }, '没有文字提问'),
  );
}
function SessionsDialog({ data, busy, focus, onClose, onDone }) {
  const focused = focus ? sessionGroups(data.sessions).find(group => group.key === focus) : null;
  const [selected, setSelected] = useState(() => (focused ? focused.rows.map(s => s.id) : [])),
    [expanded, setExpanded] = useState(() => (focus ? { [focus]: true } : {})),
    [confirming, setConfirming] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const blocked = busy || pending;
  const chosen = data.sessions.filter(s => selected.includes(s.id));
  const remove = async () => {
    setPending(true);
    setError('');
    try {
      const d = await API.removeSessions(selected);
      if (!d?.ok) throw new Error(d?.error || '移除失败，请重试');
      onDone('已把 ' + selected.length + ' 个会话移出同步，下次同步时从同步仓库删除。');
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setPending(false);
    }
  };
  if (confirming)
    return e(
      Modal,
      {
        title: '把 ' + chosen.length + ' 个会话移出同步',
        note: '所有电脑停止同步这些会话，下次同步时从同步仓库删除。各电脑上的副本留在原处。',
        onClose,
      },
      dialogBody(
        error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null,
        chosen.map(s =>
          e(
            'div',
            { key: s.id, className: 'dss-confirm-row' },
            e('span', null, sessionLabel(s)),
            e('span', { className: 'dss-desc' }, s.project || '未登记'),
          ),
        ),
      ),
      dialogActions(
        '',
        pill('返回', () => setConfirming(false), { disabled: pending }),
        pill(pending ? '正在处理…' : '移出同步', remove, { disabled: blocked, kind: 'danger' }),
      ),
    );
  return e(
    Modal,
    {
      title: '同步的会话',
      note:
        (data.sharedKnown ? '同步仓库与这台电脑' : '这台电脑') +
        '共有 ' +
        data.sessions.length +
        ' 个会话' +
        (data.removedCount ? '，另有 ' + data.removedCount + ' 个已移出同步' : '') +
        '。选中的会话会从同步仓库删除。',
      wide: true,
      onClose,
    },
    dialogBody(
      ...sessionGroups(data.sessions).map(group =>
        e(
          PickGroup,
          {
            key: group.key,
            title: group.title + ' · ' + group.rows.length + ' 个',
            note: group.note,
            ids: group.rows.map(s => s.id),
            selected,
            disabled: blocked,
            open: expanded[group.key],
            onToggleOpen: () => setExpanded(old => ({ ...old, [group.key]: !old[group.key] })),
            onPick: (ids, on) => togglePick(setSelected, ids, on),
          },
          group.rows.map(session =>
            e(
              'div',
              { key: session.id, className: 'dss-session-row' },
              pickRow({
                key: 'pick',
                label: sessionLabel(session),
                detail:
                  (session.project ? session.project + ' · ' : '') +
                  (session.updatedAt ? new Date(session.updatedAt).toLocaleString() : '') +
                  (session.onThisComputer ? '' : ' · 这台电脑上没有'),
                checked: selected.includes(session.id),
                disabled: blocked,
                onChange: on => togglePick(setSelected, [session.id], on),
              }),
              e(SessionPreview, { id: session.id }),
            ),
          ),
        ),
      ),
    ),
    dialogActions(
      selected.length ? '已选 ' + selected.length + ' 个' : '',
      pill('关闭', onClose),
      pill('移出同步…', () => setConfirming(true), { disabled: blocked || !selected.length }),
    ),
  );
}

/* —— 同步仓库占用 —— */
function usageSummary(data) {
  return (
    '当前内容 ' +
    fmtBytes(data.currentBytes) +
    '；同步分支历史 ' +
    fmtBytes(data.historyBytes) +
    (data.localOtherBytes ? '；本机另存旧历史 ' + fmtBytes(data.localOtherBytes) : '')
  );
}
// What each row can do: sessions leave the sync, old files leave the repository.
const USAGE_ACTIONS = {
  archived: ['移出同步', 'sessions'],
  hidden: ['移出同步', 'sessions'],
  leftover: ['移除', 'remoteFiles'],
};
function UsageDialog({ data, busy, onClose, onRefresh, onOpen }) {
  const rows = data.groups.filter(g => g.files || g.historyBytes);
  return e(
    Modal,
    {
      title: '同步仓库占用',
      note:
        '本机可见的同步分支：当前内容 ' +
        fmtBytes(data.currentBytes) +
        '，历史版本 ' +
        fmtBytes(data.historyBytes) +
        '，目录与提交记录 ' +
        fmtBytes(data.structureBytes) +
        '。' +
        (data.localBytes != null ? '这台电脑的同步副本共占 ' + fmtBytes(data.localBytes) + '。' : ''),
      wide: true,
      onClose,
    },
    dialogBody(
      e(
        'div',
        { className: 'dss-usage-table' },
        e(
          'div',
          { className: 'dss-usage-row dss-usage-head' },
          e('span', null, '内容'),
          e('span', null, '当前'),
          e('span', null, '历史版本'),
          e('span', null, ''),
        ),
        rows.map(g => {
          const action = g.files ? USAGE_ACTIONS[g.id] : null;
          return e(
            'div',
            { key: g.id, className: 'dss-usage-row', 'data-usage-row': g.id },
            e('span', null, g.title),
            e('span', null, g.files + ' 个 · ' + fmtBytes(g.storedBytes)),
            e('span', null, fmtBytes(g.historyBytes)),
            action
              ? e(
                  'button',
                  {
                    type: 'button',
                    className: 'dss-link',
                    disabled: busy,
                    onClick: () => onOpen(action[1], g.id),
                  },
                  action[0],
                )
              : e('span'),
          );
        }),
      ),
      e(
        'div',
        { className: 'dss-history-bar' },
        e(
          'div',
          { className: 'dss-group-text' },
          e('span', null, '历史版本 ' + fmtBytes(data.historyBytes) + ' · ' + data.commits + ' 次同步记录'),
          e(
            'small',
            { className: 'dss-desc' },
            '这些是 chatsync 每次同步产生的 Git 提交，不是 DSH 自带数据。新电脑只取当前快照；同步仓库可能保留更多旧历史，可打开仓库查看。',
          ),
        ),
        pill('清除历史版本…', () => onOpen('history'), { disabled: busy || (data.commits <= 1 && !data.shallow) }),
        data.repositoryUrl
          ? data.repositoryLabel === 'GitHub'
            ? helpLink('在 GitHub 查看历史', data.repositoryUrl + '/commits/' + encodeURIComponent(data.branch))
            : helpLink('在 ' + (data.repositoryLabel || '网页') + ' 查看仓库', data.repositoryUrl)
          : null,
      ),
      data.localOtherBytes
        ? e(
            'div',
            { className: 'dss-history-bar', 'data-local-history': true },
            e(
              'div',
              { className: 'dss-group-text' },
              e('span', null, '本机另存的旧历史 ' + fmtBytes(data.localOtherBytes)),
              e(
                'small',
                { className: 'dss-desc' },
                '同步分支已不包含、只在这台电脑的同步副本中保留的旧提交，例如早先版本清除历史后留下的同步前备份。新电脑不会下载它们。',
              ),
            ),
            pill('回收本机空间…', () => onOpen('localHistory'), { disabled: busy }),
          )
        : null,
      e(
        'p',
        { className: 'dss-desc' },
        data.branches
          ? '同步仓库另有项目分支 ' +
              data.branches.project +
              ' 个、同步前备份分支 ' +
              data.branches.backup +
              ' 个、电脑同步回执 ' +
              data.branches.device +
              ' 个' +
              (data.branches.other ? '、其他分支 ' + data.branches.other + ' 个' : '') +
              '。新电脑只下载同步分支和仍在用的项目分支。'
          : '连不上同步仓库，没有统计其他分支。',
      ),
    ),
    dialogActions('大小按压缩后的存储计算', pill('重新统计', onRefresh, { disabled: busy }), pill('关闭', onClose)),
  );
}

/* —— 清除历史版本 —— */
function HistoryDialog({ busy, onClose, onDone }) {
  const [preview, setPreview] = useState(null),
    [retired, setRetired] = useState([]),
    [deleteBranches, setDeleteBranches] = useState(false),
    [confirming, setConfirming] = useState(false),
    [pending, setPending] = useState(true),
    [error, setError] = useState('');
  const load = async () => {
    setPending(true);
    setError('');
    try {
      const d = await API.historyRebuild();
      if (!d?.ok) throw new Error(d?.error || '检查失败，请重试');
      setPreview(d);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const blocked = busy || pending;
  const waiting = preview ? preview.blockers.filter(b => !retired.includes(b.deviceId)) : [];
  const apply = async () => {
    setPending(true);
    setError('');
    try {
      const d = await API.applyHistoryRebuild({
        previewId: preview.previewId,
        retiredDevices: retired,
        deleteBackupBranches: deleteBranches,
      });
      if (!d?.ok) throw new Error(d?.error || '没有完成，请重新检查');
      onDone(
        (d.commit ? '同步分支已改为只含当前内容。' : '') +
          (d.deletedBranches?.length ? '已删除 ' + d.deletedBranches.length + ' 个同步前备份分支。' : '') +
          (d.branchError || '') +
          (d.localCleanupError || '') +
          (d.backup ? '旧历史保留在同步仓库的 ' + d.backup + ' 分支，没有生成本机备份。' : ''),
      );
    } catch (err) {
      setError(err.message || String(err));
      setConfirming(false);
    } finally {
      setPending(false);
    }
  };
  const errorLine = error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null;
  if (confirming)
    return e(
      Modal,
      { title: '清除历史版本', note: '同步分支将只保留当前内容；旧历史保留在同步仓库的归档分支。', onClose },
      dialogBody(
        errorLine,
        e(
          'ul',
          { className: 'dss-steps' },
          e('li', null, '旧历史留在同步仓库的归档分支，不下载、不生成本机备份。'),
          e('li', null, '把同步仓库中的同步分支换成只含当前内容的一次记录。'),
          e('li', null, '回收这台电脑同步副本中的旧历史；同步仓库总占用不会因此清零。'),
          deleteBranches ? e('li', null, '删除 ' + preview.backupBranches.length + ' 个同步前备份分支。') : null,
          e('li', null, '其他电脑下次同步时自动改用新的历史，各电脑上的数据不变。'),
        ),
      ),
      dialogActions(
        '',
        pill('返回', () => setConfirming(false), { disabled: pending }),
        pill(pending ? '正在清除…' : '清除', apply, { disabled: blocked, kind: 'danger' }),
      ),
    );
  return e(
    Modal,
    {
      title: '清除历史版本',
      note: '清除后，同步分支只保留当前内容，并回收本机旧历史。旧历史仍保留在同步仓库的归档分支。',
      onClose,
    },
    dialogBody(
      errorLine,
      pending && !preview
        ? e('p', { className: 'dss-desc', role: 'status' }, '正在读取同步仓库与设备回执（最多 2 分钟）…')
        : null,
      preview
        ? e(
            'div',
            { className: 'dss-stack' },
            e(
              'p',
              { className: 'dss-desc' },
              '本机已取回 ' +
                preview.commits +
                ' 次同步记录' +
                (preview.shallow ? '（仅当前快照，同步仓库可能有更多历史）' : '') +
                '。旧历史只保留在同步仓库，不生成完整本机备份。',
            ),
            preview.blockers.length
              ? e(
                  'div',
                  { className: 'dss-stack' },
                  e(
                    'p',
                    { className: 'dss-err', role: 'alert' },
                    '这些电脑还不是 ' +
                      preview.minVersion +
                      ' 或更新版本。旧版本会把旧历史重新传回去，请先在它们上面升级并同步一次；不再使用的电脑可以勾选：',
                  ),
                  ...preview.blockers.map(b =>
                    pickRow({
                      key: b.deviceId,
                      label: b.deviceName + ' 已不再使用',
                      detail: b.reason + (b.appliedAt ? ' · 最后同步 ' + new Date(b.appliedAt).toLocaleString() : ''),
                      checked: retired.includes(b.deviceId),
                      disabled: blocked,
                      onChange: on =>
                        setRetired(old => (on ? [...old, b.deviceId] : old.filter(id => id !== b.deviceId))),
                    }),
                  ),
                )
              : null,
            preview.backupBranches.length
              ? pickRow({
                  key: 'branches',
                  label: '同时删除同步仓库中 ' + preview.backupBranches.length + ' 个同步前备份分支',
                  detail: '同步遇到冲突时保存的远端版本。不删除的话，它们仍占用同步仓库的空间。',
                  checked: deleteBranches,
                  disabled: blocked,
                  onChange: setDeleteBranches,
                })
              : null,
          )
        : null,
    ),
    dialogActions(
      waiting.length ? waiting.length + ' 台电脑需要先升级' : '',
      pill('关闭', onClose),
      error ? pill('重新检查', load, { disabled: blocked }) : null,
      pill('清除…', () => setConfirming(true), {
        disabled:
          blocked || !preview || waiting.length > 0 || (preview.commits <= 1 && !preview.shallow && !deleteBranches),
      }),
    ),
  );
}

/* —— 回收本机另存的旧历史 —— */
function LocalHistoryDialog({ busy, onClose, onDone }) {
  const [preview, setPreview] = useState(null),
    [pending, setPending] = useState(true),
    [error, setError] = useState('');
  const load = async () => {
    setPending(true);
    setError('');
    try {
      const d = await API.localHistory();
      if (!d?.ok) throw new Error(d?.error || '检查失败，请重试');
      setPreview(d);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const removable = preview ? preview.refs.filter(r => r.removable) : [];
  const apply = async () => {
    setPending(true);
    setError('');
    try {
      const d = await API.reclaimLocalHistory({ previewId: preview.previewId });
      if (!d?.ok) throw new Error(d?.error || '没有完成，请重新检查');
      onDone(
        '已删除 ' +
          d.removed.length +
          ' 个本机旧备份引用，回收 ' +
          fmtBytes(d.freedBytes) +
          '；同步副本现占 ' +
          fmtBytes(d.totalBytes) +
          '。',
      );
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setPending(false);
    }
  };
  return e(
    Modal,
    {
      title: '回收本机空间',
      note: '只删除同步仓库仍保留着的旧备份在这台电脑的副本；同步仓库、其他电脑和 DSH 数据都不变。',
      onClose,
    },
    dialogBody(
      error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null,
      pending && !preview
        ? e('p', { className: 'dss-desc', role: 'status' }, '正在核对本机副本与同步仓库中的历史…')
        : null,
      preview
        ? e(
            'div',
            { className: 'dss-stack' },
            e(
              'p',
              { className: 'dss-desc' },
              '同步副本共占 ' +
                fmtBytes(preview.totalBytes) +
                '，其中当前同步分支 ' +
                fmtBytes(preview.currentBytes) +
                '。',
            ),
            preview.refs.length
              ? e(
                  'ul',
                  { className: 'dss-steps' },
                  preview.refs.map(r =>
                    e(
                      'li',
                      { key: r.ref },
                      r.ref.replace(/^refs\/(?:heads|remotes)\//, '') +
                        ' · 另占 ' +
                        fmtBytes(r.bytes) +
                        (r.removable ? ' · 同步仓库已保留，可删除' : ' · ' + r.reason),
                    ),
                  ),
                )
              : e('p', { className: 'dss-desc' }, '没有占用空间的旧备份引用；可能只是尚未回收的旧对象。'),
            preview.reflogClean
              ? null
              : e('p', { className: 'dss-err' }, '恢复记录中还有未归档的独有提交，暂不能回收。'),
          )
        : null,
    ),
    dialogActions(
      removable.length ? '可删除 ' + removable.length + ' 个' : '',
      pill('关闭', onClose),
      error ? pill('重新检查', load, { disabled: busy || pending }) : null,
      pill(pending && preview ? '正在回收…' : '回收', apply, {
        disabled: busy || pending || !preview || !preview.reflogClean || (!removable.length && !preview.otherBytes),
        kind: 'danger',
      }),
    ),
  );
}

/* —— 本机备份 —— */
function backupSummary(scan) {
  const free = scan.items.filter(i => !i.protected).reduce((sum, i) => sum + i.bytes, 0);
  if (scan.backupBytes !== undefined)
    return (
      '恢复原件 ' +
      fmtBytes(scan.backupBytes) +
      ' · 同步副本 ' +
      fmtBytes(scan.transportBytes) +
      ' · 旧版遗留 ' +
      fmtBytes(scan.legacyBytes) +
      (free ? '；可清理 ' + fmtBytes(free) : '')
    );
  return '共 ' + fmtBytes(scan.totalBytes) + (free ? '，可清理 ' + fmtBytes(free) : '，没有可清理的');
}
function BackupDialog({ scan, busy, onClose, onRescan }) {
  const [selected, setSelected] = useState([]),
    [expanded, setExpanded] = useState({}),
    [preview, setPreview] = useState(null),
    [separate, setSeparate] = useState(false),
    [result, setResult] = useState(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const blocked = busy || pending;
  const perform = async task => {
    setPending(true);
    setError('');
    try {
      const data = await task();
      if (!data?.ok) {
        if (data?.results) setResult(data);
        throw new Error(data?.error || '部分备份没有删除，请看逐项结果');
      }
      return data;
    } catch (err) {
      setError(err.message || '操作失败，请重试');
      return null;
    } finally {
      setPending(false);
    }
  };
  const errorLine = error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null;
  if (result)
    return e(
      Modal,
      { title: '本机备份', note: '已删除 ' + fmtBytes(result.removedBytes || 0) + '。', onClose },
      dialogBody(
        errorLine,
        (result.results || []).map(row =>
          e(
            'div',
            { key: row.id, className: 'dss-confirm-row' },
            e('span', null, row.name || '所选备份'),
            e(
              'span',
              { className: row.ok ? 'dss-desc' : 'dss-err' },
              row.ok ? '已删除' : row.error + (row.retainedPath ? '；仍在 ' + row.retainedPath : ''),
            ),
          ),
        ),
      ),
      dialogActions('', pill('完成', onClose)),
    );
  if (preview)
    return e(
      Modal,
      {
        title: '删除 ' + preview.items.length + ' 项本机备份',
        note: '共 ' + fmtBytes(preview.bytes) + '。' + preview.warning,
        onClose,
      },
      dialogBody(
        errorLine,
        preview.items.map(item =>
          e(
            'div',
            { key: item.id, className: 'dss-confirm-row' },
            e('code', null, item.path),
            e('span', { className: 'dss-desc' }, fmtBytes(item.bytes)),
          ),
        ),
        preview.separateConfirmation
          ? pickRow({
              key: 'separate',
              label: '我已核对所选原件和旧仓库，不再需要其中的独有历史，并已关闭相关编辑',
              checked: separate,
              disabled: blocked,
              onChange: setSeparate,
            })
          : null,
      ),
      dialogActions(
        '',
        pill('返回', () => setPreview(null), { disabled: pending }),
        pill(
          pending ? '正在删除…' : '永久删除',
          async () => {
            const data = await perform(() =>
              API.localStorage('apply', { token: preview.token, confirm: true, confirmSeparate: separate }),
            );
            if (data) setResult(data);
            onRescan();
          },
          { disabled: blocked || (preview.separateConfirmation && !separate), kind: 'danger' },
        ),
      ),
    );
  const bytes = scan.items.filter(i => selected.includes(i.id)).reduce((sum, i) => sum + i.bytes, 0);
  return e(
    Modal,
    {
      title: '本机存储明细',
      note: '当前同步副本、恢复原件和旧版遗留分别列出。这里只管理本插件产生的材料；不会把应用运行时和其他插件算作备份。',
      wide: true,
      onClose,
    },
    dialogBody(
      errorLine,
      e(
        'label',
        { className: 'dss-pick' },
        '保留最近的备份',
        e(
          'select',
          {
            value: scan.policy.retentionDays,
            disabled: blocked,
            onChange: async event => {
              const retentionDays = Number(event.target.value);
              const saved = await perform(() => API.localStorage('policy', { retentionDays }));
              if (saved) {
                setSelected([]);
                onRescan();
              }
            },
          },
          [
            [30, '30 天'],
            [7, '7 天'],
            [90, '90 天'],
            [180, '180 天'],
            [365, '1 年'],
            [0, '不按时间保留'],
          ].map(([value, label]) => e('option', { key: value, value }, label)),
        ),
      ),
      scan.warnings?.map((warning, i) => e('p', { key: i, className: 'dss-err' }, warning)),
      ...scan.categories
        .map(category => ({ category, items: scan.items.filter(item => item.category === category.id) }))
        .filter(({ items }) => items.length)
        .map(({ category, items }) =>
          e(
            PickGroup,
            {
              key: category.id,
              title: category.title + ' · ' + fmtBytes(category.bytes),
              note: category.purpose,
              ids: items.filter(i => !i.protected).map(i => i.id),
              selected,
              disabled: blocked,
              open: expanded[category.id],
              onToggleOpen: () => setExpanded(old => ({ ...old, [category.id]: !old[category.id] })),
              onPick: (ids, on) => togglePick(setSelected, ids, on),
            },
            items.map(item =>
              pickRow({
                key: item.id,
                label: item.name + ' · ' + fmtBytes(item.bytes),
                detail: item.protected ? '保留：' + item.reason : item.path,
                checked: selected.includes(item.id),
                disabled: blocked || item.protected,
                onChange: on => togglePick(setSelected, [item.id], on),
              }),
            ),
          ),
        ),
      e('p', { className: 'dss-desc' }, scan.note),
    ),
    dialogActions(
      selected.length ? '已选 ' + selected.length + ' 项 · ' + fmtBytes(bytes) : '',
      pill('关闭', onClose),
      pill(
        '删除…',
        async () => {
          setSeparate(false);
          const data = await perform(() => API.localStorage('preview', { ids: selected }));
          if (data) setPreview(data);
        },
        { disabled: blocked || !selected.length },
      ),
    ),
  );
}

/* —— 远端旧文件 —— */
// Older versions uploaded machine-only files. They leave the shared copy only after
// every computer in use runs a version that keeps its own copy.
function remoteSummary(preview) {
  if (!preview.files.length) return '没有';
  return (
    preview.files.length + ' 个' + (preview.blockers.length ? '，' + preview.blockers.length + ' 台电脑需要先升级' : '')
  );
}
function RemoteFilesDialog({ preview, busy, onClose, onDone }) {
  const [retired, setRetired] = useState([]),
    [confirming, setConfirming] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const blocked = busy || pending;
  const waiting = preview.blockers.filter(b => !retired.includes(b.deviceId));
  const apply = async () => {
    setPending(true);
    setError('');
    try {
      const data = await API.applyRemoteCleanup({ previewId: preview.previewId, retiredDevices: retired });
      if (!data?.ok) throw new Error(data?.error || '没有完成，请重新检查');
      onDone('已从同步仓库移除 ' + data.removed + ' 个旧文件；各电脑上的这些文件留在原处。');
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setPending(false);
    }
  };
  const errorLine = error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null;
  if (confirming)
    return e(
      Modal,
      {
        title: '从同步仓库移除 ' + preview.files.length + ' 个旧文件',
        note: '同步一次，把它们从同步仓库的最新版本中删除。每台电脑上的这些文件留在原处。',
        onClose,
      },
      dialogBody(
        errorLine,
        preview.files.map(file => e('div', { key: file, className: 'dss-confirm-row' }, e('code', null, file))),
      ),
      dialogActions(
        '',
        pill('返回', () => setConfirming(false), { disabled: pending }),
        pill(pending ? '正在同步…' : '移除', apply, { disabled: blocked, kind: 'danger' }),
      ),
    );
  return e(
    Modal,
    {
      title: '远端旧文件',
      note: '旧版本上传过的插件清单、备份、脚本等本机文件，现在不再同步。',
      onClose,
    },
    dialogBody(
      errorLine,
      preview.blockers.length
        ? e(
            'div',
            { className: 'dss-stack' },
            e(
              'p',
              { className: 'dss-err', role: 'alert' },
              '这些电脑还不是 ' +
                preview.minVersion +
                ' 或更新版本。旧版本会把远端移除当作删除本机文件，请先在它们上面升级并同步一次；不再使用的电脑可以勾选：',
            ),
            ...preview.blockers.map(b =>
              pickRow({
                key: b.deviceId,
                label: b.deviceName + ' 已不再使用',
                detail: b.reason + (b.appliedAt ? ' · 最后同步 ' + new Date(b.appliedAt).toLocaleString() : ''),
                checked: retired.includes(b.deviceId),
                disabled: blocked,
                onChange: on => setRetired(old => (on ? [...old, b.deviceId] : old.filter(id => id !== b.deviceId))),
              }),
            ),
          )
        : null,
      e('h3', { className: 'dss-subtitle' }, preview.files.length + ' 个文件'),
      preview.files.map(file => e('div', { key: file, className: 'dss-confirm-row' }, e('code', null, file))),
    ),
    dialogActions(
      waiting.length ? waiting.length + ' 台电脑需要先升级' : '',
      pill('关闭', onClose),
      pill('移除…', () => setConfirming(true), { disabled: blocked || waiting.length > 0 }),
    ),
  );
}

/* —— 总览 —— */
const STORAGE_ROWS = [
  {
    key: 'sessions',
    title: '同步的会话',
    remote: true,
    action: '明细',
    load: () => API.sessions(),
    summary: sessionsSummary,
  },
  { key: 'usage', title: '同步仓库', remote: true, action: '明细', load: () => API.repoUsage(), summary: usageSummary },
  {
    key: 'backups',
    title: '本机存储',
    remote: false,
    action: '明细',
    load: () => API.localStorage(),
    summary: backupSummary,
  },
  {
    key: 'remoteFiles',
    title: '远端旧文件',
    remote: true,
    action: '明细',
    load: () => API.remoteCleanup(),
    summary: remoteSummary,
    empty: data => !data.files.length,
  },
];
function StorageOverview({ busy, remote }) {
  const [results, setResults] = useState({}),
    [loading, setLoading] = useState({}),
    [open, setOpen] = useState(null),
    [message, setMessage] = useState('');
  const rows = STORAGE_ROWS.filter(row => remote || !row.remote);
  const load = async keys => {
    setLoading(old => ({ ...old, ...Object.fromEntries(keys.map(k => [k, true])) }));
    await Promise.all(
      keys.map(async key => {
        let value;
        try {
          const data = await STORAGE_ROWS.find(row => row.key === key).load();
          value = data?.ok ? { data } : { error: data?.error || '检查失败，请重试' };
        } catch (err) {
          value = { error: err.message || String(err) };
        }
        setResults(old => ({ ...old, [key]: value }));
        setLoading(old => ({ ...old, [key]: false }));
      }),
    );
  };
  const checking = rows.some(row => loading[row.key]);
  const checked = rows.some(row => results[row.key]);
  const close = () => setOpen(null);
  // After a change, the affected lines and the repository usage are checked again.
  const done = keys => text => {
    setOpen(null);
    setMessage(text);
    load(keys.filter(key => rows.some(row => row.key === key)));
  };
  const dialogProps = { busy, onClose: close };
  const data = open && results[open.key]?.data;
  const dialog =
    open?.key === 'history'
      ? e(HistoryDialog, { ...dialogProps, onDone: done(['usage', 'backups']) })
      : open?.key === 'localHistory'
        ? e(LocalHistoryDialog, { ...dialogProps, onDone: done(['usage']) })
        : !data
          ? null
          : open.key === 'sessions'
            ? e(SessionsDialog, { ...dialogProps, data, focus: open.focus, onDone: done(['sessions', 'usage']) })
            : open.key === 'usage'
              ? e(UsageDialog, {
                  ...dialogProps,
                  data,
                  onRefresh: () => load(['usage']),
                  onOpen: (key, focus) => setOpen({ key, focus }),
                })
              : open.key === 'backups'
                ? e(BackupDialog, { ...dialogProps, scan: data, onRescan: () => load(['backups']) })
                : open.key === 'remoteFiles'
                  ? e(RemoteFilesDialog, { ...dialogProps, preview: data, onDone: done(['remoteFiles', 'usage']) })
                  : null;
  return e(
    'section',
    { className: 'dss-sec', 'data-storage-overview': true },
    e('h2', { className: 'dss-section-title' }, '同步仓库与本机存储（实验性）'),
    e(
      'div',
      { className: 'dss-storage-head' },
      e('p', { className: 'dss-desc' }, '看看同步了什么、占了多少，清理用不上的。'),
      pill(checking ? '正在检查…' : checked ? '重新检查' : '检查', () => load(rows.map(row => row.key)), {
        disabled: busy || checking,
      }),
    ),
    message ? e('div', { className: 'dss-save-state', role: 'status' }, message) : null,
    checked || checking
      ? e(
          'div',
          { className: 'dss-storage-rows' },
          rows.map(row => {
            const result = results[row.key];
            const ready = result?.data && !loading[row.key];
            return e(
              'div',
              { key: row.key, className: 'dss-storage-row', 'data-storage-row': row.key },
              e('span', { className: 'dss-storage-title' }, row.title),
              loading[row.key]
                ? e('span', { className: 'dss-desc' }, '正在检查…')
                : result?.error
                  ? e('span', { className: 'dss-err', role: 'alert' }, result.error)
                  : e('span', { className: 'dss-desc' }, ready ? row.summary(result.data) : ''),
              ready && !row.empty?.(result.data)
                ? e(
                    'button',
                    { type: 'button', className: 'dss-link', disabled: busy, onClick: () => setOpen({ key: row.key }) },
                    row.action,
                  )
                : e('span'),
            );
          }),
        )
      : null,
    dialog,
  );
}
