function TransferReview({ review, busy, onConfirm }) {
  if (!review) return null;
  return e(
    'div',
    { className: 'dss-review', role: 'region', 'aria-label': '同步预览' },
    e('p', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, review.summary),
    e(
      'div',
      { className: 'dss-actions' },
      e(
        'button',
        {
          type: 'button',
          className: 'dss-pill dss-primary dss-startup-primary',
          disabled: Boolean(busy),
          onClick: () => onConfirm(review.id),
        },
        busy ? '正在继续…' : review.confirmLabel || '确认并继续',
      ),
      // Some previews offer a safe alternative answer, such as restoring instead of deleting.
      ...(review.alternatives || []).map(choice =>
        e(
          'button',
          {
            key: choice.id,
            type: 'button',
            className: 'dss-pill',
            disabled: Boolean(busy),
            onClick: () => onConfirm(choice.id),
          },
          choice.label,
        ),
      ),
    ),
  );
}
// Startup has a small snapshot route: do not rescan all sessions to draw a bar.
function useStartupState() {
  const [snapshot, setSnapshot] = useState(null);
  const [connectionError, setConnectionError] = useState('');
  const pending = useRef(null);
  const refresh = useCallback(() => {
    if (pending.current) return pending.current;
    pending.current = API.startupState()
      .then(d => {
        if (!d?.ok) throw new Error(d?.error || '无法读取同步状态');
        setSnapshot(d);
        setConnectionError('');
      })
      .catch(err => setConnectionError(err.message || '状态连接暂时中断'))
      .finally(() => {
        pending.current = null;
      });
    return pending.current;
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [refresh]);
  return { snapshot, refresh, connectionError };
}
function StartupProgress({ progress, phase }) {
  const p = progress || {};
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const waiting = p.stage === 'wait-lock';
  const transferring = ['fetch', 'pull', 'push'].includes(p.stage);
  const t = transferring ? p.transfer : null;
  const title =
    phase === 'cancelling'
      ? '正在停止'
      : phase === 'restarting'
        ? '正在重新打开 DSH'
        : waiting
          ? '另一端正在同步'
          : t?.op === 'push'
            ? '正在上传本机变化'
            : t
              ? '正在下载其他电脑的数据'
              : p.stage === 'verify'
                ? '正在连接同步仓库'
                : transferring
                  ? '正在获取同步数据'
                  : '正在核对本机与远端变化';
  const quiet = now - (t?.at || p.at || p.startedAt || now) > 20000;
  return e(
    'div',
    { className: 'dss-startup-panel' },
    e('strong', { role: 'status' }, title),
    t ? e(TransferLine, { t }) : null,
    t?.pct == null
      ? e('div', {
          className: 'dss-bar-pending',
          role: 'progressbar',
          'aria-label': title,
          'aria-valuetext': '进行中，当前步骤无法计算百分比',
        })
      : null,
    !t || t.pct === 100
      ? e(
          'div',
          { className: 'dss-startup-meta' },
          waiting ? '正在等待另一端完成同步。' : t?.pct === 100 ? '正在校验收到的数据。' : p.label || '正在检查…',
        )
      : null,
    quiet ? e('div', { className: 'dss-startup-meta', role: 'status' }, '20 秒未收到新进度。') : null,
    p.startedAt
      ? e('div', { className: 'dss-startup-meta' }, e(ElapsedText, { startedAt: p.startedAt, prefix: '本轮已用时 ' }))
      : null,
  );
}
function WorkspaceHistoryRepair({ workspaceId }) {
  const [preview, setPreview] = useState(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await API.workspaceHistory(
        preview ? 'apply' : 'preview',
        preview ? { previewId: preview.previewId } : { workspaceId },
      );
      if (!result.ok) throw new Error(result.error);
      setMessage(result.message);
      setPreview(preview ? null : result);
    } catch (error) {
      setMessage(error.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  return e(
    'div',
    { className: 'dss-issue' },
    e(
      'button',
      { type: 'button', className: 'dss-pill', disabled: busy, onClick: run },
      busy ? '正在核对…' : preview ? '保留备份并重建待上传历史' : '处理项目旧历史中的大文件',
    ),
    message ? e('p', { role: 'status', className: 'dss-desc' }, message) : null,
  );
}
function SyncIssues({ issues, detail }) {
  const [copied, setCopied] = useState('');
  if (!issues?.length) return null;
  const copy = async issue => {
    try {
      await navigator.clipboard.writeText(issue.location || issue.file);
      setCopied(issue.location || issue.file);
    } catch {
      setCopied('复制失败，请选中文件位置复制。');
    }
  };
  return e(
    'div',
    { className: 'dss-startup-panel dss-issues', role: 'region', 'aria-label': '同步问题详情' },
    e('strong', null, '问题详情 · ' + issues.length + ' 项'),
    ...issues.map((issue, index) =>
      e(
        'div',
        { className: 'dss-issue', key: index },
        e('b', null, issue.scope || '同步'),
        e('div', null, issue.reason),
        issue.file
          ? e('code', null, issue.file + (issue.lines?.length ? ' · 第 ' + issue.lines.join('、') + ' 行' : ''))
          : null,
        e('div', { className: 'dss-startup-meta' }, issue.action),
        issue.location
          ? e(
              'details',
              null,
              e('summary', null, '文件位置'),
              e('code', null, issue.location),
              e(
                'button',
                { type: 'button', className: 'dss-pill', onClick: () => copy(issue) },
                copied === (issue.location || issue.file) ? '已复制位置' : '复制位置',
              ),
            )
          : null,
      ),
    ),
    ...[
      ...new Set(
        (detail?.privacyReports || (detail?.privacy ? [detail.privacy] : []))
          .filter(r => r.workspaceId && r.findings?.some(f => f.reasons?.includes('内容超过单文件扫描上限')))
          .map(r => r.workspaceId),
      ),
    ].map(id => e(WorkspaceHistoryRepair, { key: id, workspaceId: id })),
    copied.startsWith('复制失败') ? e('div', { role: 'status' }, copied) : null,
    detail
      ? e(
          'details',
          { 'data-sync-technical': true },
          e('summary', null, '查看技术记录'),
          e(
            'pre',
            { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '12px' } },
            lastDetailText(detail),
          ),
        )
      : null,
  );
}
const sendBlockListeners = new Set();
function showSendBlock(state) {
  for (const update of sendBlockListeners) update({ ...state, ready: false });
}
function installSendProtection(conversation) {
  if (typeof conversation?.sendSession !== 'function') return () => {};
  const original = conversation.sendSession;
  async function guardedSend(session, ...args) {
    let state;
    try {
      state = await API.maySend(session.sessionId);
    } catch (error) {
      state = { allowed: false, message: error.message + '，消息未发送。输入内容和附件已保留。' };
    }
    if (state.ok !== true || !state.allowed) {
      showSendBlock({ sessionId: session.sessionId, message: state.message || '这条会话尚未完成同步，消息未发送。' });
      return { kind: 'error', text: state.message || '同步完成后请再次发送。' };
    }
    const outcome = await original.call(this, session, ...args);
    // The host repeats the check at admission, so a concurrent import cannot
    // slip between preflight and prompt. A rejection restores the same draft.
    if (outcome?.kind === 'error') {
      try {
        const latest = await API.maySend(session.sessionId);
        if (!latest.allowed) showSendBlock({ ...latest, sessionId: session.sessionId });
      } catch {}
    }
    return outcome;
  }
  conversation.sendSession = guardedSend;
  return () => {
    if (conversation.sendSession === guardedSend) conversation.sendSession = original;
  };
}
function StartupSyncOverlay() {
  const { snapshot, refresh, connectionError } = useStartupState();
  const [attempt, setAttempt] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const dialog = useRef(null);
  const s = snapshot?.startup;
  useEffect(() => {
    sendBlockListeners.add(setAttempt);
    return () => sendBlockListeners.delete(setAttempt);
  }, []);
  useEffect(() => {
    if (!attempt?.sessionId) return;
    let alive = true;
    const check = () =>
      API.maySend(attempt.sessionId)
        .then(state => {
          if (alive)
            setAttempt(previous =>
              previous && previous.sessionId === attempt.sessionId
                ? { ...previous, ready: state.ok === true && state.allowed === true }
                : previous,
            );
        })
        .catch(() => {});
    check();
    const timer = setInterval(check, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [attempt?.sessionId]);
  useEffect(() => {
    if (!attempt || typeof document === 'undefined' || !dialog.current) return;
    const panel = dialog.current,
      previous = document.activeElement;
    if (!panel.open) panel.showModal();
    return () => {
      if (panel.open) panel.close();
      previous?.focus?.();
    };
  }, [Boolean(attempt)]);
  if (!attempt)
    return e(UpdateNotice, {
      startup: true,
      busy: !snapshot || Boolean(connectionError) || snapshot.progress?.running === true || s?.phase === 'running',
    });
  const retry = async () => {
    setActionPending(true);
    try {
      const result = await API.startup('retry');
      setFeedback(result.error || '');
      await refresh();
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setActionPending(false);
    }
  };
  return e(
    'dialog',
    {
      className: 'dss-startup-dialog',
      ref: dialog,
      tabIndex: -1,
      role: 'dialog',
      'aria-modal': true,
      'aria-label': '发送前同步检查',
      onCancel: () => setAttempt(null),
      onKeyDown: event => event.stopPropagation(),
    },
    e('div', { className: 'dss-startup-kicker' }, 'ChatSync · 发送前检查'),
    e('h2', null, attempt.ready ? '这条会话已完成同步' : '这条会话还不能发送'),
    e('p', { role: 'status' }, attempt.ready ? '请先查看最新对话，再次发送。输入内容和附件已保留。' : attempt.message),
    !attempt.ready && s?.phase === 'running'
      ? e(StartupProgress, { progress: snapshot.progress, phase: s.phase })
      : null,
    !attempt.ready && s?.issues?.length ? e(SyncIssues, { issues: s.issues, detail: s.detail }) : null,
    !attempt.ready && s?.phase === 'pending'
      ? e('p', null, '这条会话正在使用中。可先使用新会话，重新打开 DSH 后继续同步旧会话。')
      : null,
    connectionError || feedback ? e('p', { role: 'alert' }, feedback || '状态连接暂时中断，正在重连。') : null,
    e(
      'div',
      { className: 'dss-startup-actions' },
      e(
        'button',
        { type: 'button', className: 'dss-pill dss-startup-primary', onClick: () => setAttempt(null) },
        attempt.ready ? '返回会话，查看更新' : '返回编辑',
      ),
      !attempt.ready && s?.phase !== 'running'
        ? e(
            'button',
            { type: 'button', className: 'dss-pill', disabled: actionPending, onClick: retry },
            actionPending ? '正在重试…' : '重试同步',
          )
        : null,
    ),
  );
}

/* Global startup reminder; settings retain a separate, expandable update entry. */
function UpdateNotice(props) {
  const [data, setData] = useState(null);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadUpdate().then(result => {
      if (!live || !result || !result.ok || !result.available) return;
      setData(result);
      const key = 'dss-update-seen-' + result.hostKind + '-' + result.latestVersion;
      let seen = updateShown.has(key);
      try {
        seen = seen || window.localStorage.getItem(key) === '1';
      } catch {
        /* in-memory fallback */
      }
      setVisible(!props.startup || !seen);
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!props.startup || !visible || !data || props.busy) return;
    const position = () => {
      const anchor = props.anchorRef && props.anchorRef.current;
      if (anchor?.getBoundingClientRect) {
        const r = anchor.getBoundingClientRect();
        const bottom = Math.min(window.innerHeight - 80, Math.max(12, window.innerHeight - r.top + 10));
        setPos({
          left: Math.max(12, Math.min(r.left, window.innerWidth - 376)),
          bottom,
          maxHeight: Math.max(60, window.innerHeight - bottom - 12),
        });
      } else {
        // The native sidebar no longer has the old footer button to anchor to.
        setPos({ right: 16, top: 56, maxHeight: Math.max(60, window.innerHeight - 72) });
      }
      const key = 'dss-update-seen-' + data.hostKind + '-' + data.latestVersion;
      updateShown.add(key);
      try {
        window.localStorage.setItem(key, '1');
      } catch {
        /* in-memory fallback */
      }
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [visible, data, props.busy]);
  if (!visible || !data || (props.startup && (props.busy || !pos))) return null;
  const notes = data.notes || '此版本的更新说明暂时无法读取，请查看完整更新内容。';
  // Plain text only: remote Markdown is never injected as HTML.
  const excerpt = notes
    .replace(/^#+\s+.*$/gm, '')
    .replace(/\*\*/g, '')
    .trim();
  const copy = async () => {
    try {
      await window.navigator.clipboard.writeText(data.command);
      setCopyFailed(false);
      setFeedback(
        '已复制更新代码，请打开 PowerShell 粘贴并按回车。' +
          (data.hostKind === 'desktop'
            ? '执行前先完全退出桌面应用（含托盘），更新后重新打开。'
            : '更新后重新启动 DSH。'),
      );
    } catch {
      setCopyFailed(true);
      setFeedback(
        '复制失败，请手动复制下方代码，到 PowerShell 粘贴执行。' +
          (data.hostKind === 'desktop'
            ? '执行前先完全退出桌面应用（含托盘），更新后重新打开。'
            : '更新后重新启动 DSH。'),
      );
    }
  };
  const content = e(
    'div',
    null,
    e('div', { className: 'dss-update-notes' }, props.startup ? excerpt.slice(0, 420) : excerpt),
    e(
      'div',
      { className: 'dss-update-actions' },
      e('button', { type: 'button', className: 'dss-btn', onClick: copy }, '复制更新代码'),
      e('a', { href: data.releaseUrl, target: '_blank', rel: 'noopener noreferrer' }, '完整更新内容'),
    ),
    feedback
      ? e(
          'div',
          { className: 'dss-update-feedback', role: 'status' },
          feedback,
          copyFailed ? e('pre', null, data.command) : null,
        )
      : null,
  );
  return e(
    'aside',
    {
      className: 'dss-update' + (props.startup ? ' dss-update-popup' : ''),
      style: props.startup ? pos : { marginBottom: '16px' },
      'aria-label': 'ChatSync 更新提醒',
      onKeyDown: event => {
        if (props.startup && event.key === 'Escape') setVisible(false);
      },
    },
    props.startup
      ? e(
          'div',
          null,
          e(
            'div',
            { className: 'dss-update-heading' },
            e('h2', null, 'ChatSync 有新版本 · ' + data.latestVersion),
            e(
              'button',
              {
                type: 'button',
                className: 'dss-update-close',
                'aria-label': '关闭更新提醒',
                onClick: () => setVisible(false),
              },
              e('span', { className: 'dss-close-mark', 'aria-hidden': true }),
            ),
          ),
          content,
        )
      : e('details', null, e('summary', null, 'ChatSync 有新版本 · ' + data.latestVersion + ' · 查看更新'), content),
  );
}
