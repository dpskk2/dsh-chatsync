function RecoveryComparison({ preview, record }) {
  const single =
    record?.reason === 'local-project-unavailable' &&
    preview.local.sha256 &&
    preview.local.sha256 === preview.remote.sha256;
  const panes = useRef([]),
    [active, setActive] = useState(-1),
    [ignoreFormatting, setIgnoreFormatting] = useState(true);
  const original = value => (value.missing ? '' : value.text || '');
  const display = value => (ignoreFormatting ? recoveryContentText(original(value)) : original(value));
  const textual = !preview.local.binary && !preview.remote.binary;
  const comparison = useMemo(
    () => (textual ? recoveryRows(display(preview.local), display(preview.remote)) : { rows: [], limited: false }),
    [preview, ignoreFormatting],
  );
  const changes = comparison.limited ? [] : comparison.rows.flatMap((r, i) => (r[0] !== r[1] ? [i] : []));
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
              ? '已加载内容中有 ' + changes.length + ' 行差异'
              : !!preview.local.missing !== !!preview.remote.missing
                ? '一侧不存在文件；请结合原件状态查看'
                : partial
                  ? '已加载部分相同；完整原件尚未比较'
                  : original(preview.local) !== original(preview.remote)
                    ? '内容相同，仅排版不同'
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
              checked: ignoreFormatting,
              onChange: ev => {
                setIgnoreFormatting(ev.target.checked);
                setActive(-1);
              },
            }),
            '忽略 JSON 排版差异',
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
    single || !changes.length
      ? null
      : e(
          'div',
          { className: 'dss-diff-legend', 'aria-label': '差异颜色说明' },
          e('strong', { className: 'dss-diff-local' }, '− 本机独有'),
          e('strong', { className: 'dss-diff-remote' }, '＋ 远端独有'),
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
            single ? '迁移前的会话' : side ? '远端原件' : '当时本机原件',
            value.missing ? ' · 此版本没有文件' : '',
          ),
          e(
            'div',
            {
              className: 'dss-diff-pane',
              tabIndex: 0,
              'aria-label': side ? '远端原件内容' : '本机原件内容',
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
                    const changed = !comparison.limited && row[0] !== row[1] && row[side] !== undefined;
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

function RecoveryDialog({ record, preview, onClose, onMore, loading, children }) {
  const dialog = useRef(null);
  const [raw, setRaw] = useState(false);
  useDialogWheel(dialog);
  const close = () => {
    if (dialog.current?.open) dialog.current.close();
    onClose();
  };
  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => {
      if (node?.open) node.close();
    };
  }, []);
  return e(
    'dialog',
    {
      ref: dialog,
      className: 'dss-recovery-dialog',
      'aria-modal': true,
      'aria-label': '备份内容预览',
      onCancel: event => {
        event.preventDefault();
        close();
      },
      onClose,
      onKeyDown: event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        if (event.key === 'Tab') {
          const node = event.currentTarget;
          const focusable = [
            ...node.querySelectorAll(
              'button:not([disabled]),select:not([disabled]),input:not([disabled]),a[href],[tabindex="0"]',
            ),
          ].filter(item => item.getClientRects().length);
          const first = focusable[0],
            last = focusable[focusable.length - 1],
            active = node.ownerDocument.activeElement;
          if (first && (event.shiftKey ? active === first : active === last)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          }
        }
      },
    },
    e(
      'header',
      { className: 'dss-diff-header' },
      e(
        'div',
        null,
        e('h2', null, recoveryFileInfo(record).name),
        e('div', { className: 'dss-desc' }, recoveryFileInfo(record).location),
      ),
      e(
        'div',
        { className: 'dss-diff-actions' },
        e(
          'button',
          { type: 'button', className: 'dss-pill', onClick: () => setRaw(value => !value) },
          raw ? '返回预览' : '查看原始记录',
        ),
        e('button', { type: 'button', className: 'dss-pill', onClick: close }, '关闭'),
      ),
    ),
    raw
      ? e(RecoveryComparison, { preview, record })
      : e(RecoveryReadableComparison, { preview, record, onMore, loading }),
    e('footer', { className: 'dss-diff-footer' }, children),
  );
}

function RecoveryItem({ record, busy, onRestored }) {
  const opener = useRef(null);
  const [preview, setPreview] = useState(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const more = async side => {
    if (!preview || loading) return;
    setLoading(true);
    try {
      const previous = preview[side].presentation;
      const result = await API.recoveryPreview(record.id, { [side]: previous.nextOffset });
      if (!result.ok) throw new Error(result.error);
      if (result[side].sha256 && preview[side].sha256 && result[side].sha256 !== preview[side].sha256)
        throw new Error('原件已变化，请重新打开');
      const next = result[side].presentation;
      if (next?.kind !== 'conversation') throw new Error('暂时无法继续读取对话');
      setPreview({
        ...preview,
        [side]: { ...result[side], presentation: { ...next, messages: [...previous.messages, ...next.messages] } },
      });
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
      setPreview(d);
    } catch (err) {
      setMessage(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };
  const restore = async side => {
    if (!preview || loading || busy) return;
    if (
      !window.confirm(
        '将项目文件「' +
          record.path +
          '」恢复为' +
          (side === 'remote' ? '远端' : '当时本机') +
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
  const sideView = (side, title) => {
    const value = preview[side];
    return e(
      'div',
      { className: 'dss-diff-actions' },
      preview.canRestore && !value.missing
        ? e(
            'button',
            { type: 'button', className: 'dss-pill', disabled: busy || loading, onClick: () => restore(side) },
            '恢复' + title,
          )
        : null,
      preview.sessionImport?.available && !value.missing
        ? e(
            'button',
            {
              type: 'button',
              className: 'dss-pill',
              disabled: busy || loading || !workspaceId,
              onClick: async () => {
                if (
                  !window.confirm(
                    '将' + title + '建立为所选项目中的独立会话？原会话保持原样，新会话会在下次同步时上传。',
                  )
                )
                  return;
                setLoading(true);
                setMessage('');
                try {
                  const d = await API.recoveryImport(record.id, side, record.versions[side].sha256, workspaceId);
                  if (!d.ok) throw new Error(d.error);
                  setMessage(d.hint);
                  onRestored?.();
                } catch (err) {
                  setMessage(err.message || String(err));
                } finally {
                  setLoading(false);
                }
              },
            },
            '从' + title + '恢复新会话',
          )
        : null,
    );
  };
  return e(
    'article',
    { className: 'dss-recovery-item' },
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
                        ? '已采用远端版本'
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
    preview
      ? e(
          RecoveryDialog,
          {
            record,
            preview,
            onMore: more,
            loading,
            onClose: () => {
              setPreview(null);
              opener.current?.focus();
            },
          },
          preview.sessionImport?.available
            ? e('div', { className: 'dss-desc' }, '恢复会创建新会话，现有会话保持原样。')
            : null,
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
                        ? '与远端原件一致'
                        : '已有后续更改'),
              ),
          preview.sessionImport?.available
            ? e(
                'label',
                { className: 'dss-field' },
                '新会话保存到',
                e(
                  'select',
                  {
                    className: 'dss-input',
                    value: workspaceId,
                    disabled: busy || loading,
                    onChange: ev => setWorkspaceId(ev.target.value),
                  },
                  e('option', { value: '' }, '请选择项目'),
                  preview.sessionImport.workspaces.map(ws => e('option', { key: ws.id, value: ws.id }, ws.title)),
                ),
              )
            : null,
          preview.branches
            ? e(
                'div',
                { className: 'dss-tip' },
                '共同历史 ' +
                  preview.branches.commonEvents +
                  ' 条事件；本机独有 ' +
                  (preview.branches.localEvents - preview.branches.commonEvents) +
                  ' 条，远端独有 ' +
                  (preview.branches.remoteEvents - preview.branches.commonEvents) +
                  ' 条。',
              )
            : null,
          preview.branches?.divergent && preview.sessionImport?.available
            ? e(
                'button',
                {
                  type: 'button',
                  className: 'dss-pill',
                  disabled: busy || loading || !workspaceId,
                  onClick: async () => {
                    if (!window.confirm('将本机和远端独有的对话分别恢复为独立会话？')) return;
                    setLoading(true);
                    try {
                      const d = await API.preserveBranches({
                        id: record.id,
                        workspaceId,
                        expectedLocalHash: record.versions.local.sha256,
                        expectedRemoteHash: record.versions.remote.sha256,
                      });
                      if (!d.ok) throw new Error(d.error);
                      setMessage(d.hint);
                      onRestored?.();
                    } catch (err) {
                      setMessage(err.message);
                    } finally {
                      setLoading(false);
                    }
                  },
                },
                '分别恢复两边的会话',
              )
            : null,
          preview.canRestore || preview.sessionImport?.available
            ? e(
                'div',
                { className: 'dss-diff-actions' },
                sideView('local', record.reason === 'local-project-unavailable' ? '迁移前原件' : '本机原件'),
                preview.local.sha256 && preview.local.sha256 === preview.remote.sha256
                  ? null
                  : sideView('remote', '远端原件'),
              )
            : null,
          ['merged', 'applied', 'repaired', 'restored'].includes(record.status) &&
            !Object.values(record.imports || {}).some(attempt => attempt.status !== 'verified')
            ? e(
                'button',
                {
                  type: 'button',
                  className: 'dss-pill',
                  disabled: busy || loading,
                  onClick: async () => {
                    setLoading(true);
                    try {
                      const d = await API.recoveryArchive(record, record.category !== 'history');
                      if (!d.ok) throw new Error(d.error);
                      setMessage(d.hint);
                      setPreview(null);
                      onRestored?.();
                    } catch (err) {
                      setMessage(err.message || String(err));
                    } finally {
                      setLoading(false);
                    }
                  },
                },
                record.category === 'history' ? '放回待查看' : '无需恢复，收起记录',
              )
            : null,
          message ? e('div', { role: 'status' }, message) : null,
          !preview.canRestore && !preview.sessionImport?.available
            ? e('div', { className: 'dss-desc' }, '只读预览')
            : null,
        )
      : null,
    message ? e('div', { className: 'dss-desc', role: 'status' }, message) : null,
  );
}
