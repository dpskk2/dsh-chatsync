function DataHealth({ busy, initialIssueKey, expanded = false, onVerified, grouping = false }) {
  const [scan, setScan] = useState(null),
    [preview, setPreview] = useState(null);
  const previewRef = useRef(null);
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState('');
  const [repairRemote, setRepairRemote] = useState('');
  const [repairWorkspace, setRepairWorkspace] = useState('');
  const perform = async operation => {
    if (busy || pending) return;
    setPending(true);
    setMessage('');
    try {
      const d = await operation();
      if (!d.ok) throw new Error(d.error);
      return d;
    } catch (err) {
      setMessage(err.message || String(err));
    } finally {
      setPending(false);
    }
  };
  const inspect = async () => {
    const d = await perform(API.dataHealth);
    if (d) {
      setScan(d);
      setPreview(null);
    }
  };
  const show = async body => {
    const d = await perform(() => API.dataRepair('preview', body));
    if (d) setPreview(d);
  };
  useEffect(() => {
    if (preview) {
      if (preview.relocation) setRepairWorkspace(preview.suggestedWorkspaceId || '');
      previewRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      previewRef.current?.focus?.({ preventScroll: true });
    }
  }, [preview]);
  useEffect(() => {
    if (!expanded) return;
    let alive = true;
    setPending(true);
    (async () => {
      const d = await API.dataHealth();
      if (!d.ok) throw new Error(d.error);
      if (!alive) return;
      setScan(d);
      if (d.queued) {
        setMessage('已有已确认的修复安排。请使用下方“关闭并修复”执行；若要更换方案，先取消原安排再重新检查。');
        return;
      }
      if (initialIssueKey && d.issues.some(issue => issue.key === initialIssueKey)) {
        const p = await API.dataRepair('preview', { key: initialIssueKey });
        if (!p.ok) throw new Error(p.error);
        if (alive) setPreview(p);
      }
    })()
      .catch(err => {
        if (alive) setMessage(err.message || String(err));
      })
      .finally(() => {
        if (alive) setPending(false);
      });
    return () => {
      alive = false;
    };
  }, [expanded, initialIssueKey]);
  const items = grouping ? scan?.ungroupedSessions || [] : scan?.issues || [];
  return e(
    'section',
    { className: 'dss-sec', 'aria-label': grouping ? '未分组会话处理' : '检查与修复' },
    grouping && scan && !items.length
      ? null
      : e(
          'p',
          { className: 'dss-desc' },
          grouping ? '选择会话，再选择要放入的项目。' : '检查会话未分组、消息打不开和项目归属不对的问题。',
        ),
    scan?.verificationPending
      ? e(
          'div',
          { className: 'dss-guide', role: 'region', 'aria-label': '核对修复结果' },
          e('h2', { className: 'dss-section-title' }, '检查修复结果'),
          e(
            'ol',
            null,
            e('li', null, '回到左侧项目和会话列表，找到刚修复的会话，确认它位于你预期的项目中，且没有重复或遗漏。'),
            e('li', null, '打开这些会话，查看最近几条消息，确认正文完整；有附件时，点开确认能正常查看。'),
            e('li', null, '检查无误后回到这里，点击「已检查修复结果，允许同步」，再点上方「立即同步」。'),
          ),
          e('p', { className: 'dss-desc' }, '如果消息仍有缺失或项目归属不对，可在下方继续检查，或查看撤销修复的方案。'),
          e(
            'button',
            {
              type: 'button',
              className: 'dss-pill',
              disabled: busy || pending,
              onClick: async () => {
                const d = await perform(() => API.dataRepair('verify'));
                if (d) {
                  setMessage(d.hint);
                  setScan({ ...scan, verificationPending: false });
                  onVerified?.();
                }
              },
            },
            '已检查修复结果，允许同步',
          ),
        )
      : null,
    e(
      'button',
      { type: 'button', className: 'dss-pill', disabled: busy || pending, onClick: inspect },
      pending ? '正在检查…' : scan ? '重新检查' : '检查本机数据',
    ),
    scan
      ? e(
          'div',
          { className: 'dss-stack' },
          e(
            'p',
            { className: 'dss-desc', role: 'status' },
            grouping
              ? items.length
                ? '有 ' + items.length + ' 个未分组会话。'
                : '没有需要修复的未分组会话。'
              : scan.issues.length
                ? '发现 ' + scan.issues.length + ' 项会话问题。'
                : '检查完成，未发现会话问题。',
          ),
          grouping && (scan.ordinaryUngroupedSessions?.length || scan.archivedUngroupedSessions?.length)
            ? e(
                'div',
                { className: 'dss-stack' },
                e('p', { className: 'dss-desc' }, '删除工作区后留下的会话属于正常未分组；归档会话也不需要修复。'),
                [
                  ['正常未分组', scan.ordinaryUngroupedSessions],
                  ['未分组中的归档会话', scan.archivedUngroupedSessions],
                ].map(([label, sessions]) =>
                  sessions?.length
                    ? e(
                        'details',
                        { key: label, className: 'dss-utility-card' },
                        e('summary', null, label + '（' + sessions.length + '）'),
                        e(
                          'ul',
                          null,
                          sessions.map(session => e('li', { key: session.sessionId }, session.title)),
                        ),
                      )
                    : null,
                ),
              )
            : null,
          !grouping && scan.ungroupedSessions?.length
            ? e(
                'button',
                { type: 'button', className: 'dss-pill', onClick: () => openRepairPage({ mode: 'grouping' }) },
                '处理 ' + scan.ungroupedSessions.length + ' 个未分组会话',
              )
            : null,
          e(
            'div',
            { className: 'dss-issue-list' },
            items.map(issue =>
              e(
                'article',
                { key: issue.key, className: 'dss-sec' },
                e('div', { className: 'dss-h' }, issue.title || issue.message),
                grouping ? e('p', { className: 'dss-desc' }, '原项目文件夹：' + issue.cwd) : null,
                !grouping && issue.title ? e('p', { className: 'dss-desc' }, issue.message) : null,
                e('details', null, e('summary', null, '查看记录位置'), e('code', null, issue.file || issue.sessionId)),
                issue.kind === 'relocate'
                  ? e(
                      'p',
                      { className: 'dss-desc' },
                      '原项目文件夹在这台电脑上不可用。阅读聊天不受影响；继续处理项目文件时，请选择文件已准备好的本机项目。原目录：' +
                        issue.cwd,
                    )
                  : null,
                issue.kind !== 'missing' || issue.file
                  ? e(
                      'button',
                      {
                        type: 'button',
                        className: 'dss-pill',
                        disabled: busy || pending,
                        onClick: () => show({ key: issue.key, ...(grouping ? { relocate: true } : {}) }),
                      },
                      grouping ? '查看处理方案' : issue.action,
                    )
                  : e('p', null, issue.action),
                !grouping && issue.kind === 'membership' && !issue.archived
                  ? e(
                      'button',
                      {
                        type: 'button',
                        className: 'dss-pill',
                        disabled: busy || pending,
                        onClick: () => show({ key: issue.key, relocate: true }),
                      },
                      '改到其他本机项目继续',
                    )
                  : null,
              ),
            ),
          ),
          !grouping && scan.repairBackups?.length
            ? e(
                'details',
                { className: 'dss-utility-card' },
                e('summary', null, '撤销之前的修复'),
                e(
                  'p',
                  { className: 'dss-desc' },
                  '修复结果不符合预期时，可以恢复到修复前的状态。先查看方案，再确认执行。',
                ),
                scan.repairBackups.map(backup =>
                  e(
                    'div',
                    { key: backup.id, className: 'dss-backup-row' },
                    e(
                      'span',
                      { className: 'dss-desc' },
                      new Date(backup.createdAt).toLocaleString() + ' · ' + backup.file,
                    ),
                    e(
                      'button',
                      {
                        type: 'button',
                        className: 'dss-pill',
                        disabled: busy || pending,
                        onClick: () => show({ backupId: backup.id }),
                      },
                      '查看撤销方案',
                    ),
                  ),
                ),
              )
            : null,
        )
      : null,
    preview
      ? e(
          'div',
          { className: 'dss-guide', ref: previewRef, tabIndex: -1, role: 'region', 'aria-label': '历史数据修复预览' },
          e('h2', { className: 'dss-section-title' }, '处理方案'),
          e('p', null, preview.warning),
          preview.issue?.cwd
            ? e(
                'p',
                { className: 'dss-desc' },
                preview.relocation
                  ? '原会话使用的目录：' +
                      preview.issue.cwd +
                      (preview.suggestedPath ? '；已匹配本机项目：' + preview.suggestedPath : '')
                  : '当前登记：' +
                      (preview.issue.currentProjects || []).map(ws => ws.title).join('、') +
                      '；建议按原始目录归位：' +
                      preview.issue.cwd,
              )
            : null,
          preview.relocation
            ? e(
                'label',
                { className: 'dss-field' },
                '将此会话放入哪个本机项目？',
                e(
                  'select',
                  {
                    className: 'dss-input',
                    value: repairWorkspace,
                    onChange: ev => setRepairWorkspace(ev.target.value),
                  },
                  e('option', { value: '' }, '请选择本机项目'),
                  (preview.workspaces || []).map(ws => e('option', { key: ws.id, value: ws.id }, ws.title)),
                ),
                e(
                  'button',
                  {
                    type: 'button',
                    className: 'dss-pill',
                    disabled: busy || pending || !repairWorkspace,
                    onClick: async () => {
                      if (!window.confirm(preview.warning)) return;
                      const d = await perform(() =>
                        API.dataRepair('import', {
                          recoveryId: preview.recoveryId,
                          expectedHash: preview.expectedHash,
                          workspaceId: repairWorkspace,
                          archiveSource: true,
                        }),
                      );
                      if (d) {
                        setMessage(d.hint);
                        setPreview(null);
                        const fresh = await API.dataHealth();
                        if (fresh.ok) setScan(fresh);
                      }
                    },
                  },
                  '在本机项目继续会话',
                ),
              )
            : null,
          preview.issue?.kind === 'config' && !preview.planId
            ? e(
                'label',
                { className: 'dss-field' },
                '也可重建为手动连接（先备份原配置）',
                e('input', {
                  className: 'dss-input',
                  value: repairRemote,
                  placeholder: '私有 Git 仓库地址；留空表示暂不连接',
                  onChange: ev => setRepairRemote(ev.target.value),
                }),
                e(
                  'button',
                  {
                    type: 'button',
                    className: 'dss-pill',
                    disabled: busy || pending,
                    onClick: () => show({ key: preview.issue.key, replacementConfig: { remote: repairRemote } }),
                  },
                  '预览重建手动配置',
                ),
              )
            : null,
          (preview.candidates || []).map(candidate =>
            e(
              'button',
              {
                type: 'button',
                className: 'dss-pill',
                key: candidate.hash,
                disabled: busy || pending,
                onClick: () => show({ key: preview.issue.key, candidateHash: candidate.hash }),
              },
              candidate.source + (candidate.records != null ? ' · ' + candidate.records + ' 行记录' : ''),
            ),
          ),
          (preview.choices || []).map(file =>
            e(
              'button',
              {
                type: 'button',
                className: 'dss-pill',
                key: file,
                disabled: busy || pending,
                onClick: () => show({ key: preview.issue.key, selectedFile: file }),
              },
              '保留 ' + file,
            ),
          ),
          (preview.files || []).map(file => e('p', { key: file.file }, file.file)),
          preview.planId
            ? e(
                'button',
                {
                  type: 'button',
                  className: 'dss-pill',
                  disabled: busy || pending,
                  onClick: async () => {
                    if (!window.confirm(preview.warning + '\n\n安排这次修复？完全退出 DSH 后执行。')) return;
                    const d = await perform(() => API.dataRepair('queue', { planId: preview.planId }));
                    if (d) {
                      setMessage(d.hint);
                      setPreview(null);
                      setScan({ ...scan, queued: (scan?.queued || 0) + 1 });
                    }
                  },
                },
                '确认预览，安排修复',
              )
            : !preview.relocation && !(preview.candidates?.length || preview.choices?.length)
              ? e('p', null, '没有找到可恢复的备份。')
              : null,
        )
      : null,
    scan?.queued > 0
      ? e(
          'div',
          { className: 'dss-actions' },
          e('p', { style: { flexBasis: '100%' } }, '修复已安排。完全退出后执行；Web 端请退出后稍候再重新打开。'),
          e(
            'button',
            {
              type: 'button',
              className: 'dss-pill',
              disabled: busy || pending,
              onClick: async () => {
                const d = await perform(() => API.dataRepair('cancel'));
                if (d) {
                  setMessage(d.hint);
                  setScan({ ...scan, queued: 0 });
                }
              },
            },
            '取消修复安排',
          ),
          e(
            'button',
            {
              type: 'button',
              className: 'dss-pill',
              disabled: busy || pending,
              onClick: async () => {
                if (!window.confirm('现在关闭桌面应用，应用已确认的修复，再重新打开？请先结束当前对话。')) return;
                const d = await perform(() => API.dataRepair('restart'));
                if (d) setMessage(d.hint);
              },
            },
            '关闭并修复（桌面端）',
          ),
        )
      : null,
    message ? e('p', { role: 'status' }, message) : null,
  );
}

function GroupingRepairOverlay() {
  const [notice, setNotice] = useState(null),
    [error, setError] = useState('');
  const seen = useRef({ candidate: '', dismissed: '' }),
    dialog = useRef(null);
  useEffect(() => {
    let alive = true,
      checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const d = await API.grouping();
        if (!alive || !d.ok) return;
        if (!d.count) {
          seen.current = { candidate: '', dismissed: '' };
          setNotice(null);
          return;
        }
        const stable = seen.current.candidate === d.signature;
        seen.current.candidate = d.signature;
        if (!d.enabled || d.busy || !stable || seen.current.dismissed === d.signature) return;
        // Defer while another native dialog is open, preserving its input.
        if (typeof document !== 'undefined' && document.querySelector('dialog[open]') && !dialog.current?.open) return;
        setNotice(d);
      } catch {
        /* Retry the local diagnosis on the next poll. */
      } finally {
        checking = false;
      }
    };
    check();
    const timer = setInterval(check, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!notice || !dialog.current) return;
    const panel = dialog.current,
      previous = document.activeElement;
    if (!panel.open) panel.showModal();
    return () => {
      if (panel.open) panel.close();
      previous?.focus?.();
    };
  }, [Boolean(notice)]);
  const dismiss = () => {
    seen.current.dismissed = notice.signature;
    setNotice(null);
  };
  if (!notice) return null;
  return e(
    'dialog',
    {
      className: 'dss-startup-dialog dss-grouping-notice',
      ref: dialog,
      role: 'dialog',
      'aria-modal': true,
      'aria-label': '未分组会话修复',
      onCancel: dismiss,
      onKeyDown: event => event.stopPropagation(),
    },
    e('div', { className: 'dss-startup-kicker' }, 'ChatSync'),
    e('h2', null, '发现 ' + notice.count + ' 个未分组会话'),
    error ? e('p', { className: 'dss-err', role: 'alert' }, error) : null,
    e(
      'div',
      { className: 'dss-startup-actions' },
      e(
        'button',
        {
          type: 'button',
          className: 'dss-pill dss-startup-primary',
          onClick: () => {
            try {
              openRepairPage({ mode: 'grouping' });
              dismiss();
            } catch (err) {
              setError(err.message);
            }
          },
        },
        '去处理',
      ),
      e('button', { type: 'button', className: 'dss-pill', onClick: dismiss }, '稍后处理'),
    ),
  );
}

function RecoveryCenter({ busy, lastSyncAt }) {
  const [records, setRecords] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  const load = () =>
    API.recovery()
      .then(d => {
        if (!d.ok) throw new Error(d.error);
        setRecords(d.records);
        setError('');
      })
      .catch(err => setError(err.message || String(err)));
  useEffect(() => {
    load();
  }, [lastSyncAt]);
  const newest = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
  const history = (records?.filter(record => record.category === 'history') || []).sort(newest);
  const attention = (records?.filter(record => record.category !== 'history') || []).sort(newest);
  const status =
    records === null
      ? '正在读取…'
      : records.length + ' 条记录 · 待查看 ' + attention.length + ' 条 · 留存备份 ' + history.length + ' 条';
  const list = (title, rows) =>
    rows.length
      ? [
          e('h3', { key: title, className: 'dss-subtitle' }, title + '（' + rows.length + '）'),
          e(
            'div',
            { key: title + '-list', className: 'dss-recovery-list' },
            rows.map(record => e(RecoveryItem, { key: record.id, record, busy, onRestored: load })),
          ),
        ]
      : [];
  return e(
    'div',
    { className: 'dss-stack' },
    e('p', { className: 'dss-desc' }, '查看同步、迁移或修复前保存的版本，找回缺失的消息或文件。'),
    error
      ? e(
          'div',
          { className: 'dss-err', role: 'alert' },
          error,
          e('button', { type: 'button', className: 'dss-pill', onClick: load }, '重新读取'),
        )
      : e(
          'div',
          { className: 'dss-storage-head' },
          e('span', { className: 'dss-desc', role: 'status' }, status),
          records?.length ? pill('查看', () => setOpen(true)) : null,
        ),
    open
      ? e(
          Modal,
          {
            title: '找回同步前的内容',
            wide: true,
            onClose: () => setOpen(false),
          },
          dialogBody(...list('待查看', attention), ...list('留存备份', history)),
          dialogActions(
            '',
            pill('关闭', () => setOpen(false)),
          ),
        )
      : null,
  );
}
