// Where the sync page was when a sub-page opened, so returning lands in the same place.
// The section is found again by its heading; the page re-renders from scratch.
const RETURN_ANCHORS = '.dss-sec, .dss-setting-card';
let returnPosition = null;
function anchorKey(node) {
  return node.querySelector('h2, .dss-card-title, .dss-h')?.textContent || '';
}
function rememberPosition() {
  if (typeof document === 'undefined') return;
  const from = document.activeElement?.closest?.(RETURN_ANCHORS);
  if (from) returnPosition = { key: anchorKey(from), top: from.getBoundingClientRect().top };
}
function scrollParent(node) {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) return el;
  }
  return document.scrollingElement;
}
function restorePosition(tries = 30) {
  if (!returnPosition || typeof document === 'undefined') return;
  const target = [...document.querySelectorAll(RETURN_ANCHORS)].find(node => anchorKey(node) === returnPosition.key);
  if (!target) {
    if (tries > 0) requestAnimationFrame(() => restorePosition(tries - 1));
    else returnPosition = null;
    return;
  }
  const container = scrollParent(target);
  if (container) container.scrollTop += target.getBoundingClientRect().top - returnPosition.top;
  returnPosition = null;
}
function Section(props) {
  const { busy, status, statusError, progress, run, refresh, review } = useSync();
  // The settings.section owner passes its close action for flows leaving the modal.
  const openRepair = request => {
    rememberPosition();
    openRepairPage(request);
    props?.close?.();
  };
  const runRef = useRef(null);
  const [setupStep, setSetupStep] = useState(null);
  const [page, setPage] = useState(null);
  const [settingsPending, setSettingsPending] = useState(false);
  const stepIds = ['dss-connect', 'dss-scope', 'dss-run', 'dss-result'];
  const goToStep = number => {
    setSetupStep(number);
    setPage('setup');
    if (typeof document !== 'undefined') {
      const target = document.getElementById(stepIds[number - 1]);
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      target?.focus?.({ preventScroll: true });
    }
  };
  const configured = Boolean(status?.remote);
  const currentPage = page || (!status ? 'loading' : configured ? 'sync' : 'setup');
  const nextStep = setupStep || 1;
  const showRun = currentPage === 'sync' || (currentPage === 'setup' && nextStep === 3);
  useEffect(() => {
    if (currentPage === 'sync' && typeof requestAnimationFrame === 'function')
      requestAnimationFrame(() => restorePosition());
  }, [currentPage]);
  const [autoRestart, setAutoRestart] = useState(null); // null=加载中
  /* 读取/切换「同步后自动重启修复」开关 */
  useEffect(() => {
    let alive = true;
    API.config()
      .then(d => {
        if (alive && d && d.ok) setAutoRestart(d.config && d.config.autoRestartAfterRepair === true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const toggleAutoRestart = () => {
    const next = !(autoRestart === true);
    setAutoRestart(next);
    API.saveConfig({ autoRestartAfterRepair: next })
      .then(d => {
        if (d && d.ok) bubble(null, next ? '同步后分组检查已开启' : '同步后分组检查已关闭', true);
        else {
          setAutoRestart(!next);
          bubble(null, (d && d.error) || '设置失败', false);
        }
      })
      .catch(err => {
        setAutoRestart(!next);
        bubble(null, err.message || String(err), false);
      });
  };
  const onRun = () => {
    if (settingsPending) return Promise.resolve();
    setPage('sync');
    refresh();
    return run(runRef.current);
  };
  const detail = useMemo(() => (status ? lastDetailText(status.lastDetail) : ''), [status]);
  const verificationPending = status?.dataVerificationPending ?? status?.lastDetail?.dataVerificationPending;
  const repairQueued = status?.queuedRepairs > 0;

  const statusDesc = (() => {
    if (!status) return '正在读取同步状态…';
    if (status.gitMissing) return '未检测到 git,无法同步 —— 请先安装 git。';
    if (!status.remote) {
      if (status.autoRepo === false) return '仅本地快照 · 未上传';
      if (status.remoteNotice) return '尚未连接仓库 · ' + status.remoteNotice;
      return '尚未连接仓库 · 同步时创建或复用 dsh-sync';
    }
    const state = verificationPending
      ? '修复完成，待你核对'
      : repairQueued
        ? '有修复待应用'
        : status.lastDetail?.cancelled
          ? '已取消'
          : status.lastDetail?.needsReview
            ? '等待确认'
            : status.lastOk === false
              ? '同步异常'
              : status.lastDetail?.downloadPending
                ? '有内容待取回'
                : status.lastDetail?.settingsPause
                  ? '设置暂停同步（DSH 版本不同）'
                  : status.lastOk === true
                    ? '同步正常'
                    : '尚未同步';
    return (
      (status.auto ? '自动同步已开启' : '自动同步已关闭') +
      ' · ' +
      state +
      (status.ungroupedCount > 0 ? ' · ' + status.ungroupedCount + ' 个会话未分组' : '')
    );
  })();

  return e(
    'div',
    { className: 'dss-wrap' },
    e('style', null, STYLE),
    e(UpdateNotice, null),
    currentPage === 'loading' ? e('div', { className: 'dss-desc', role: 'status' }, '正在读取同步状态…') : null,
    statusError
      ? e(
          'div',
          { className: 'dss-err', role: 'alert' },
          statusError,
          e(
            'button',
            { type: 'button', className: 'dss-pill', onClick: refresh, style: { marginLeft: '8px' } },
            '重新读取状态',
          ),
        )
      : null,
    currentPage === 'setup'
      ? e(
          'div',
          { className: 'dss-onboarding' },
          e(
            'div',
            { className: 'dss-daily-heading' },
            e('div', { className: 'dss-onboarding-title' }, '第一次设置'),
            e(SidebarVisibilityToggle),
          ),
          e('div', { className: 'dss-desc' }, '只需设置一次，之后直接同步。'),
          e(
            'nav',
            { className: 'dss-steps', 'aria-label': '同步设置步骤' },
            ['备份地址', '选择内容', '首次同步'].map((label, i) =>
              e(
                'button',
                {
                  key: i,
                  type: 'button',
                  disabled: settingsPending || busy,
                  className: 'dss-step-link',
                  'aria-current': nextStep === i + 1 ? 'step' : undefined,
                  onClick: () => goToStep(i + 1),
                },
                i + 1 + '. ' + label,
              ),
            ),
          ),
        )
      : e(
          'div',
          { className: 'dss-daily' },
          e(
            'div',
            { className: 'dss-daily-heading' },
            e('h1', { className: 'dss-onboarding-title' }, '日常同步'),
            e(SidebarVisibilityToggle),
          ),
        ),
    currentPage === 'setup' && nextStep === 2
      ? e(SyncPreferences, {
          setup: true,
          busy,
          onSavingChange: setSettingsPending,
          onChanged: refresh,
          onSaved: () => goToStep(3),
        })
      : null,
    currentPage === 'setup' && nextStep === 1
      ? e(ConnectionSettings, {
          setup: true,
          remote: status?.remote,
          branch: status?.branch,
          busy,
          onSaved: () => {
            refresh();
            goToStep(2);
          },
        })
      : null,
    /* —— 同步组:状态 + 立即同步 —— */
    showRun
      ? e(
          'div',
          { className: 'dss-sec', id: 'dss-run', tabIndex: -1 },
          e(
            'div',
            { className: 'dss-rowline' },
            e(
              'div',
              { className: 'dss-rowtext' },
              currentPage === 'setup'
                ? stepHeading(3, '首次同步')
                : e('h2', { className: 'dss-section-title' }, '同步状态'),
              busy
                ? [
                    e(
                      'div',
                      { className: 'dss-prog' },
                      e(SyncIcon, { spin: true }),
                      (progress && progress.label) || '同步中…',
                      progress && progress.startedAt
                        ? e(ElapsedText, { className: 'dss-desc', startedAt: progress.startedAt, prefix: '· ' })
                        : null,
                    ),
                    progress && progress.transfer ? e(TransferLine, { t: progress.transfer }) : null,
                  ]
                : e('div', null, e('div', { className: 'dss-desc' }, statusDesc)),
            ),
            e(
              'button',
              {
                type: 'button',
                className: 'dss-pill dss-primary',
                ref: runRef,
                disabled: busy || settingsPending || Boolean(status && status.gitMissing),
                title: '取回远端更新并上传本机改动',
                onClick: onRun,
              },
              e(SyncIcon, { spin: busy }),
              busy ? '同步中' : '立即同步',
            ),
          ),
          e(TransferReview, { review, busy: busy || settingsPending, onConfirm: id => run(runRef.current, id) }),
          verificationPending || repairQueued
            ? e(
                'div',
                { className: 'dss-guide', role: 'status' },
                e(
                  'div',
                  { className: 'dss-h' },
                  verificationPending ? '同步已暂停：修复完成，待你核对' : '同步已暂停：有修复待执行',
                ),
                e(
                  'p',
                  { className: 'dss-desc' },
                  verificationPending
                    ? '先打开修复过的会话，检查消息、附件及所在项目。检查无误后，在下方确认，再点「立即同步」。本轮未上传或下载。'
                    : '修复已安排。请打开处理页执行或取消修复，再继续同步。',
                ),
                e(
                  'button',
                  {
                    type: 'button',
                    className: 'dss-pill',
                    disabled: busy || settingsPending,
                    'aria-controls': 'dss-repair-page',
                    onClick: () => openRepair({ mode: 'all' }),
                  },
                  verificationPending ? '前往核对修复结果' : '前往处理修复安排',
                ),
              )
            : null,
          !busy && status?.lastOk === false
            ? e(SyncIssues, { issues: status.lastDetail?.issues, detail: status.lastDetail })
            : null,
          /* 上次结果明细:错误保留很久便于排障 */
          detail
            ? e(
                'details',
                { open: status && status.lastOk === false ? true : undefined },
                e(
                  'summary',
                  null,
                  '上次同步详情' +
                    (status && status.lastSyncAt ? ' · ' + new Date(status.lastSyncAt).toLocaleString() : ''),
                ),
                e('div', { className: status && status.lastOk === false ? 'dss-err' : 'dss-desc' }, detail),
              )
            : status && status.lastOk === false && status.lastMessage
              ? e('div', { className: 'dss-err' }, status.lastMessage)
              : null,
        )
      : null,
    e('div', { className: 'dss-feedback', 'aria-live': 'polite' }),
    currentPage === 'sync'
      ? e(
          'div',
          { className: 'dss-sec dss-settings-group', 'data-sync-settings': true },
          e(
            'div',
            { className: 'dss-settings-body' },
            e(SyncPreferences, { busy, onSavingChange: setSettingsPending, onChanged: refresh }),
            e(
              'div',
              { className: 'dss-rowline dss-restartrow dss-setting-card', 'data-grouping-setting': true },
              e(
                'div',
                { className: 'dss-rowtext' },
                e('h2', { className: 'dss-section-title' }, '同步后分组检查'),
                e(
                  'button',
                  { type: 'button', className: 'dss-pill', onClick: () => openRepair({ mode: 'grouping' }) },
                  '处理未分组会话',
                ),
              ),
              autoRestart === null
                ? e('span', { className: 'dss-desc' }, '正在读取…')
                : e(
                    'button',
                    {
                      type: 'button',
                      className: 'dss-switch' + (autoRestart ? ' dss-switch-on' : ''),
                      role: 'switch',
                      'aria-checked': autoRestart,
                      'aria-label': '同步后分组检查',
                      disabled: settingsPending,
                      onClick: toggleAutoRestart,
                    },
                    e('span', { className: 'dss-switch-knob' }),
                  ),
            ),
            e(ConnectionSettings, {
              remote: status?.remote,
              branch: status?.branch,
              busy: busy || settingsPending,
              onSaved: refresh,
            }),
          ),
        )
      : null,
    currentPage === 'sync'
      ? e(
          'section',
          { className: 'dss-sec', 'data-sync-recovery': true },
          e('h2', { className: 'dss-section-title' }, '找回同步前的内容'),
          e(RecoveryCenter, { busy: busy || settingsPending, lastSyncAt: status?.lastSyncAt }),
        )
      : null,
    currentPage === 'sync'
      ? e(StorageOverview, { busy: busy || settingsPending, remote: Boolean(status?.remote) })
      : null,
    currentPage === 'sync'
      ? e(
          'section',
          { className: 'dss-sec' },
          e('h2', { className: 'dss-section-title' }, '修复会话问题'),
          e('p', { className: 'dss-desc' }, '会话未分组、消息打不开或项目归属不对时，在这里检查并修复。'),
          e(
            'button',
            { type: 'button', className: 'dss-pill', onClick: () => openRepair({ mode: 'all' }) },
            '检查会话问题',
          ),
        )
      : null,
    /* —— 本机新创建的工作区:路径已按本机主目录重映射,可换位置 —— */
    (() => {
      if (!showRun) return null;
      const created =
        status && status.lastDetail && status.lastDetail.workspaces && status.lastDetail.workspaces.created;
      if (!Array.isArray(created) || !created.length) return null;
      return e(
        'div',
        { className: 'dss-sec' },
        e('div', { className: 'dss-h' }, '本机新创建的工作区'),
        created.map(w =>
          e(
            'div',
            { key: w.id, className: 'dss-wsbanner' },
            e(
              'div',
              { className: 'dss-wsbanner-text' },
              e('div', { className: 'dss-wsbanner-title' }, '工作区「' + (w.title || w.id) + '」已在本机创建'),
              e('div', { className: 'dss-confmeta' }, '路径: ' + w.path),
              w.recorded && String(w.recorded).toLowerCase() !== String(w.path).toLowerCase()
                ? e('div', { className: 'dss-confmeta' }, '记录路径: ' + w.recorded + '(按本机主目录自动重映射)')
                : null,
            ),
            e(
              'div',
              { className: 'dss-confbtns' },
              e(
                'button',
                {
                  type: 'button',
                  className: 'dss-btn',
                  onClick: () => {
                    const p = window.prompt(
                      '为工作区「' + (w.title || w.id) + '」选择本机文件夹(留空则恢复按记录路径):',
                      w.path,
                    );
                    if (p === null) return;
                    API.workspacePath(w.id, p.trim())
                      .then(d => {
                        if (d && d.ok) {
                          bubble(null, d.path ? '已换位置: ' + d.path : '已恢复默认', true);
                          refresh();
                          run(runRef.current);
                        } else bubble(null, (d && d.error) || '设置失败', false);
                      })
                      .catch(err => bubble(null, err.message || String(err), false));
                  },
                },
                '换位置',
              ),
              e(
                'button',
                {
                  type: 'button',
                  className: 'dss-btn',
                  onClick: () => {
                    API.workspacePath(w.id, '')
                      .then(d => {
                        if (d && d.ok) {
                          bubble(null, '已恢复按记录路径', true);
                          refresh();
                        } else bubble(null, (d && d.error) || '设置失败', false);
                      })
                      .catch(err => bubble(null, err.message || String(err), false));
                  },
                },
                '恢复默认',
              ),
            ),
          ),
        ),
      );
    })(),
  );
}
