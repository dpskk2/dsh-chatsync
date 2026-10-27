/* ---------- 同步的会话 ---------- */
// A modal confirmation whose list scrolls inside while the buttons stay in view.
function ConfirmDialog({ title, note, rows, confirmLabel, danger = false, busy = false, onConfirm, onCancel }) {
  const dialog = useRef(null);
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
      className: 'dss-confirm-dialog',
      'aria-modal': true,
      'aria-label': title,
      onCancel: event => {
        event.preventDefault();
        onCancel();
      },
      onKeyDown: event => event.stopPropagation(),
    },
    e(
      'div',
      { className: 'dss-confirm-head' },
      e('h2', null, title),
      note ? e('p', { className: 'dss-desc' }, note) : null,
    ),
    e(
      'div',
      { className: 'dss-confirm-body' },
      rows.map(row =>
        e(
          'div',
          { key: row.key, className: 'dss-confirm-row' },
          e('span', null, row.label),
          row.detail ? e('span', { className: 'dss-desc' }, row.detail) : null,
        ),
      ),
    ),
    e(
      'div',
      { className: 'dss-confirm-actions' },
      e('button', { type: 'button', className: 'dss-pill', onClick: onCancel }, '取消'),
      e(
        'button',
        {
          type: 'button',
          className: 'dss-pill ' + (danger ? 'dss-danger' : 'dss-primary'),
          disabled: busy,
          onClick: onConfirm,
        },
        busy ? '正在处理…' : confirmLabel,
      ),
    ),
  );
}

function sessionLabel(session) {
  return session.title || session.folder + ' · ' + session.id.slice(-8);
}

function SyncedSessions({ busy }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const [selected, setSelected] = useState([]),
    [expanded, setExpanded] = useState({}),
    [confirming, setConfirming] = useState(false),
    [message, setMessage] = useState('');
  const load = async () => {
    setPending(true);
    setError('');
    try {
      const d = await API.sessions();
      if (!d?.ok) throw new Error(d?.error || '无法读取同步的会话');
      setData(d);
      setSelected([]);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setPending(false);
    }
  };
  const remove = async () => {
    setPending(true);
    setError('');
    try {
      const d = await API.removeSessions(selected);
      if (!d?.ok) throw new Error(d?.error || '移除失败，请重试');
      setConfirming(false);
      setMessage('已移出同步 ' + selected.length + ' 个会话，下次同步时从同步仓库中删除。');
      await load();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setPending(false);
    }
  };
  const blocked = busy || pending;
  const groups = data
    ? [
        { key: 'visible', title: '在 DSH 中可见', rows: data.sessions.filter(s => s.project !== null) },
        {
          key: 'hidden',
          title: '在 DSH 中看不到',
          note: '没有登记在任何项目下',
          rows: data.sessions.filter(s => s.project === null),
        },
      ].filter(group => group.rows.length)
    : [];
  const toggle = (ids, on) =>
    setSelected(old => (on ? [...new Set([...old, ...ids])] : old.filter(id => !ids.includes(id))));
  const chosen = data ? data.sessions.filter(s => selected.includes(s.id)) : [];
  return e(
    'section',
    { className: 'dss-sec', 'data-synced-sessions': true },
    e('h2', { className: 'dss-section-title' }, '同步的会话'),
    e('p', { className: 'dss-desc' }, '选择不再需要同步的会话，把它们从同步仓库中移除。'),
    data
      ? null
      : e(
          'button',
          { type: 'button', className: 'dss-pill', disabled: blocked, onClick: load },
          pending ? '正在读取…' : '查看同步的会话',
        ),
    error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null,
    message ? e('div', { className: 'dss-save-state', role: 'status' }, message) : null,
    data
      ? e(
          'div',
          { className: 'dss-stack' },
          e(
            'p',
            { className: 'dss-desc', role: 'status' },
            (data.sharedKnown ? '同步仓库与这台电脑' : '这台电脑') +
              '共有 ' +
              data.sessions.length +
              ' 个会话' +
              (data.removedCount ? '，另有 ' + data.removedCount + ' 个已移出同步' : '') +
              '。',
          ),
          ...groups.map(group => {
            const ids = group.rows.map(s => s.id);
            const all = ids.every(id => selected.includes(id));
            return e(
              'div',
              { key: group.key, className: 'dss-group' },
              e(
                'div',
                { className: 'dss-group-row' },
                e('input', {
                  type: 'checkbox',
                  'aria-label': '选中「' + group.title + '」中的全部会话',
                  checked: all,
                  disabled: blocked,
                  onChange: event => toggle(ids, event.target.checked),
                }),
                e(
                  'div',
                  { className: 'dss-group-text' },
                  e('span', null, group.title + ' · ' + group.rows.length + ' 个'),
                  group.note ? e('small', { className: 'dss-desc' }, group.note) : null,
                ),
                e(
                  'button',
                  {
                    type: 'button',
                    className: 'dss-link',
                    'aria-expanded': Boolean(expanded[group.key]),
                    onClick: () => setExpanded(old => ({ ...old, [group.key]: !old[group.key] })),
                  },
                  expanded[group.key] ? '收起' : '展开',
                ),
              ),
              expanded[group.key]
                ? e(
                    'div',
                    { className: 'dss-group-items' },
                    group.rows.map(session =>
                      e(
                        'label',
                        { key: session.id, className: 'dss-check' },
                        e('input', {
                          type: 'checkbox',
                          checked: selected.includes(session.id),
                          disabled: blocked,
                          onChange: event => toggle([session.id], event.target.checked),
                        }),
                        e(
                          'span',
                          { className: 'dss-choice' },
                          sessionLabel(session),
                          e(
                            'small',
                            null,
                            (session.project ? session.project + ' · ' : '') +
                              (session.updatedAt ? new Date(session.updatedAt).toLocaleString() : '') +
                              (session.onThisComputer ? '' : ' · 这台电脑上没有'),
                          ),
                        ),
                      ),
                    ),
                  )
                : null,
            );
          }),
          e(
            'div',
            { className: 'dss-action-bar' },
            e('span', null, selected.length ? '已选 ' + selected.length + ' 个会话' : '未选择会话'),
            e(
              'button',
              {
                type: 'button',
                className: 'dss-pill',
                disabled: blocked || !selected.length,
                onClick: () => setConfirming(true),
              },
              '从同步中移除',
            ),
          ),
        )
      : null,
    confirming
      ? e(ConfirmDialog, {
          title: '从同步中移除 ' + chosen.length + ' 个会话',
          note: '所有电脑都会停止同步这些会话，下次同步时从同步仓库中删除。各电脑上已有的副本仍在原处。',
          rows: chosen.map(s => ({ key: s.id, label: sessionLabel(s), detail: s.project || '未登记' })),
          confirmLabel: '从同步中移除',
          danger: true,
          busy: pending,
          onConfirm: remove,
          onCancel: () => setConfirming(false),
        })
      : null,
  );
}
