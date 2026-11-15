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
  const { busy, status, statusError, runError, progress, run, refresh, review } = useSync();
  // The settings.section owner passes its close action for flows leaving the modal.
  const openRepair = request => {
    rememberPosition();
    openRepairPage(request);
    props?.close?.();
  };
  const openManagement = panel => {
    rememberPosition();
    repairNavigation?.selectPanel('dsh-sync-' + panel);
    props?.close?.();
  };
  const setupFocus = useRef(false);
  const setupStarting = useRef(false);
  const [setupStep, setSetupStep] = useState(null);
  const [setupConnection, setSetupConnection] = useState(null);
  const [setupRunError, setSetupRunError] = useState('');
  const [firstSyncScope, setFirstSyncScope] = useState(null);
  const [setupScope, setSetupScope] = useState(EMPTY_SETUP_SCOPE);
  const [dismissedReview, setDismissedReview] = useState(null);
  const [repairDialog, setRepairDialog] = useState(null);
  const [page, setPage] = useState(null);
  const [settingsPending, setSettingsPending] = useState(false);
  const goToStep = number => {
    setupFocus.current = true;
    setSetupStep(number);
    setPage('setup');
    setSetupRunError('');
  };
  const configured = Boolean(status?.remote);
  const currentPage = page || (!status ? 'loading' : configured ? 'sync' : 'setup');
  const nextStep = setupStep || 1;
  const showRun = currentPage === 'sync' || (currentPage === 'setup' && nextStep === 3);
  useEffect(() => {
    if (currentPage !== 'setup' || !setupFocus.current || typeof document === 'undefined') return;
    setupFocus.current = false;
    document.getElementById('dss-setup-heading-' + nextStep)?.focus();
  }, [currentPage, nextStep]);
  useEffect(() => {
    if (currentPage === 'sync' && typeof requestAnimationFrame === 'function')
      requestAnimationFrame(() => restorePosition());
  }, [currentPage]);
  const onRun = async () => {
    if (busy || settingsPending || setupStarting.current) return;
    setDismissedReview(null);
    if (currentPage === 'sync') return run();
    if (nextStep !== 3 || !firstSyncScope || !setupConnection) return;
    setupStarting.current = true;
    setSettingsPending(true);
    setSetupRunError('');
    try {
      const read = await API.config();
      if (!read?.ok || !read.config) throw new Error(read?.error || '无法读取同步范围，请重试。');
      const selected = syncScopeChoices(read.config).filter(choice => choice.checked);
      if (
        selected.length !== firstSyncScope.length ||
        selected.some((choice, i) => choice.key !== firstSyncScope[i].key)
      ) {
        goToStep(2);
        setSetupRunError('同步范围已变化，请重新确认。');
        return;
      }
      const { remote, expectedRemote, expectedBranch, expectedAutoRepo } = setupConnection;
      const saved = await API.saveConnection({ remote, expectedRemote, expectedBranch, expectedAutoRepo });
      if (!saved?.ok || !saved.config) throw new Error(saved?.error || '无法保存同步仓库，请重试。');
      const config = saved.config;
      setSetupConnection({
        ...setupConnection,
        expectedRemote: config.remote,
        expectedBranch: config.branch,
        expectedAutoRepo: config.autoRepo,
        config,
      });
      const outcome = await run(undefined, {
        remote: config.remote,
        branch: config.branch,
        autoRepo: config.autoRepo,
        defaultOwner: setupConnection.defaultOwner,
        scope: Object.fromEntries(syncScopeChoices(read.config).map(choice => [choice.key, choice.checked])),
      });
      if (!outcome?.ok && !outcome?.detail?.needsReview && !outcome?.detail?.downloadPending) {
        if (setupConnection.defaultOwner) {
          const readback = await API.config().catch(() => null);
          const actual = readback?.ok && readback.config;
          const linkedRemote = `https://github.com/${setupConnection.defaultOwner}/dsh-sync.git`;
          if (actual?.remote === linkedRemote && actual.branch === config.branch) {
            setSetupConnection({
              remote: actual.remote,
              expectedRemote: actual.remote,
              expectedBranch: actual.branch,
              expectedAutoRepo: actual.autoRepo,
              config: actual,
              hint: setupConnection.hint,
            });
          }
        }
        throw new Error(outcome?.detail?.error || outcome?.error || outcome?.summary || '首次同步未完成，请重试。');
      }
      setPage('sync');
    } catch (err) {
      setSetupRunError(err.message || String(err));
    } finally {
      setupStarting.current = false;
      setSettingsPending(false);
    }
  };
  const savedDetail = useMemo(() => lastDetailText(status?.lastDetail), [status?.lastDetail]);
  const [versionReset, setVersionReset] = useState({ pending: false, error: '' });
  // Give up a version record left by a DSH that is no longer used: back up, then sync.
  const resetSettingsVersion = async other => {
    if (busy || settingsPending || versionReset.pending) return;
    if (!window.confirm(`清除 DSH ${other} 的版本记录，由这台电脑接管设置同步？当前设置会先另存为恢复记录。`)) return;
    setVersionReset({ pending: true, error: '' });
    try {
      const d = await API.resetSettingsVersion(other);
      if (!d || !d.ok) throw new Error((d && d.error) || '清除失败，请重试。');
      setVersionReset({ pending: false, error: '' });
      await onRun();
    } catch (err) {
      setVersionReset({ pending: false, error: err.message || String(err) });
    }
  };
  const pauseVersions = status?.lastDetail?.settingsPauseVersions || null;
  const currentNotice = status && syncMessagePresentation(status.lastMessage, status.lastOk, status.lastDetail).current;
  const verificationPending = status?.dataVerificationPending ?? status?.lastDetail?.dataVerificationPending;
  const repairQueued = status?.queuedRepairs > 0;
  const last = status?.lastDetail;
  const failed = Boolean(
    runError ||
    (status?.lastOk === false &&
      !verificationPending &&
      !repairQueued &&
      !last?.cancelled &&
      !last?.needsReview &&
      ((!last?.downloadPending && !last?.deferred) || last?.error || last?.workspaces?.errors?.length)),
  );
  const detail = runError?.message || savedDetail || (failed ? status?.lastMessage || '同步失败' : '');

  const syncState = (() => {
    if (busy) return [progress?.label || '准备同步…', 'blue'];
    if (runError) return ['同步失败', 'error'];
    if (status?.gitMissing) return ['未安装 Git', 'error'];
    if (!status?.remote) return ['尚未连接仓库', 'idle'];
    if (verificationPending) return ['修复完成，待核对', 'warning'];
    if (repairQueued) return ['有修复待执行', 'warning'];
    if (last?.cancelled) return ['同步已取消', 'idle'];
    if (last?.needsReview)
      return [
        last.review?.alternatives?.some(choice => choice.action === 'restore') ? '缺少文件，已暂停' : '等待确认',
        'warning',
      ];
    if (last?.downloadPending) return ['有内容待取回', 'warning'];
    if (failed) {
      const op = last?.failure?.op || last?.error;
      if (op === 'push') return ['上传失败', 'error'];
      if (op === 'fetch' || op === 'clone') return ['下载失败', 'error'];
      return [last?.workspaces?.errors?.length && !last.error ? '项目文件同步失败' : '同步失败', 'error'];
    }
    if (last?.settingsPause) return ['设置暂停同步', 'warning'];
    if (last?.deferred) return ['同步待完成', 'warning'];
    if (currentNotice) return [status.lastMessage, 'blue'];
    return status.lastOk === true ? ['同步完成', 'blue'] : ['尚未同步', 'idle'];
  })();
  const shortStage =
    busy && { ws: '同步项目', privacy: '检查内容', apply: '写入会话', cancelling: '正在停止' }[progress?.stage];
  const stageLabel = e(
    'span',
    { className: 'dss-sync-stage', title: syncState[0] },
    shortStage
      ? [
          e('span', { className: 'dss-sync-stage-full', key: 'full' }, syncState[0]),
          e('span', { className: 'dss-sync-stage-short', key: 'short' }, shortStage),
        ]
      : syncState[0],
  );

  return e(
    'div',
    { className: 'dss-wrap dss-sync-page' },
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
          e('div', { className: 'dss-setup-heading' }, e('div', { className: 'dss-onboarding-title' }, '第一次设置')),
          e(
            'nav',
            { className: 'dss-steps', 'aria-label': '同步设置步骤' },
            ['同步仓库', '选择内容', '首次同步'].map((label, i) =>
              e(
                'button',
                {
                  key: i,
                  type: 'button',
                  disabled: settingsPending || busy || i + 1 >= nextStep,
                  className: 'dss-step-link',
                  'aria-current': nextStep === i + 1 ? 'step' : undefined,
                  onClick: () => {
                    if (!setupStarting.current && !settingsPending && !busy && i + 1 < nextStep) goToStep(i + 1);
                  },
                },
                i + 1 + '. ' + label,
              ),
            ),
          ),
        )
      : null,
    currentPage === 'setup' && nextStep === 2 && setupRunError
      ? e('p', { className: 'dss-err dss-form-error', role: 'alert' }, setupRunError)
      : null,
    currentPage === 'setup' && nextStep === 2
      ? e(SyncPreferences, {
          setup: true,
          busy,
          setupScope,
          onScopeChange: setSetupScope,
          onSavingChange: setSettingsPending,
          onChanged: refresh,
          onSaved: config => {
            setFirstSyncScope(syncScopeChoices(config).filter(choice => choice.checked));
            goToStep(3);
          },
        })
      : null,
    currentPage === 'setup' && nextStep === 1
      ? e(ConnectionSettings, {
          setup: true,
          remote: status?.remote,
          branch: status?.branch,
          candidate: setupConnection,
          busy,
          onSavingChange: setSettingsPending,
          onSaved: candidate => {
            setSetupConnection(candidate);
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
                ? e(
                    'div',
                    { className: 'dss-sync-title' },
                    stepHeading(3, '首次同步'),
                    busy
                      ? e(
                          'span',
                          { className: 'dss-status-light', 'data-tone': 'blue', role: 'status' },
                          stageLabel,
                          progress?.startedAt ? e(ElapsedText, { startedAt: progress.startedAt, prefix: '· ' }) : null,
                        )
                      : null,
                  )
                : e(
                    'div',
                    { className: 'dss-title-status dss-sync-title' },
                    e('h2', { className: 'dss-section-title' }, '同步状态'),
                    e(
                      'span',
                      {
                        className:
                          'dss-status-light' +
                          (!busy && currentNotice && syncState[0] === status.lastMessage ? ' dss-current-status' : ''),
                        'data-tone': syncState[1],
                        role: 'status',
                        style:
                          !busy && currentNotice && syncState[0] === status.lastMessage
                            ? { color: '#4d6bfe' }
                            : undefined,
                      },
                      stageLabel,
                      busy && progress?.startedAt
                        ? e(ElapsedText, { startedAt: progress.startedAt, prefix: '· ' })
                        : null,
                    ),
                  ),
            ),
            e(
              'button',
              {
                type: 'button',
                className: 'dss-pill dss-primary dss-run-button',
                disabled:
                  busy ||
                  settingsPending ||
                  Boolean(status?.gitMissing) ||
                  (currentPage === 'setup' && (!firstSyncScope || !setupConnection)),
                title: currentPage === 'sync' ? '取回云端更新并上传本机改动' : undefined,
                onClick: onRun,
              },
              e(SyncIcon, { spin: busy }),
              busy ? '同步中' : currentPage === 'setup' && settingsPending ? '正在确认…' : '立即同步',
            ),
            busy && progress?.transfer
              ? e(
                  'details',
                  { className: 'dss-live-progress' },
                  e(
                    'summary',
                    { 'aria-label': '本次同步进度' },
                    progress.transfer.pct != null
                      ? progress.transfer.pct + '%'
                      : progress.transfer.op === 'push'
                        ? '上传'
                        : '下载',
                  ),
                  e(
                    'div',
                    { className: 'dss-live-progress-body' },
                    e('p', null, syncState[0]),
                    e(TransferLine, { t: progress.transfer }),
                  ),
                )
              : null,
          ),
          currentPage === 'setup' && setupRunError
            ? e('div', { className: 'dss-err dss-form-error', role: 'alert' }, setupRunError)
            : null,
          currentPage === 'sync'
            ? e(SessionForkNotice, {
                count: status?.pendingSessionForks,
                onSelect: record => {
                  rememberPosition();
                  openSessionConflict(record);
                  props?.close?.();
                },
              })
            : null,
          currentPage === 'sync'
            ? e(TransferReview, {
                review,
                collapsed: dismissedReview === review?.id,
                onExpand: () => setDismissedReview(null),
                busy: busy || settingsPending,
                onConfirm: id => run(id),
                onDismiss: () => setDismissedReview(review?.id),
              })
            : null,
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
          status?.lastDetail?.settingsPause
            ? e(
                'div',
                { className: 'dss-guide dss-version-pause' },
                e('p', { className: 'dss-desc' }, status.lastDetail.settingsPause),
                pauseVersions
                  ? e(
                      react.Fragment,
                      null,
                      e(
                        'p',
                        { className: 'dss-desc' },
                        '较新 DSH 的电脑已不再使用（重置、退役或回退）时，可以清除版本记录，由这台电脑接管设置同步。',
                      ),
                      e(
                        'button',
                        {
                          type: 'button',
                          className: 'dss-pill',
                          disabled: busy || settingsPending || versionReset.pending,
                          onClick: () => resetSettingsVersion(pauseVersions.other),
                        },
                        versionReset.pending ? '正在备份…' : '清除版本记录',
                      ),
                    )
                  : null,
                versionReset.error ? e('div', { className: 'dss-err', role: 'alert' }, versionReset.error) : null,
              )
            : null,
          status?.lastOk === false
            ? e(SyncIssues, { issues: status.lastDetail?.issues, detail: status.lastDetail })
            : null,
          e(NetworkStatus, {
            busy,
            remote: status?.remote,
            candidate: currentPage === 'setup' ? setupConnection : null,
          }),
          /* 上次结果明细:错误保留很久便于排障 */
          detail
            ? e(
                'details',
                { key: runError?.startedAt ?? status?.lastSyncAt ?? 0, open: failed || undefined },
                e(
                  'summary',
                  null,
                  '上次同步详情' +
                    (runError || status?.lastSyncAt
                      ? ' · ' + new Date(runError?.startedAt ?? status.lastSyncAt).toLocaleString()
                      : ''),
                ),
                e('div', { className: 'dss-sync-detail-content ' + (failed ? 'dss-err' : 'dss-desc') }, detail),
              )
            : null,
        )
      : null,
    currentPage === 'sync'
      ? e(
          'div',
          { className: 'dss-sec dss-settings-group', 'data-sync-settings': true },
          e(
            'div',
            { className: 'dss-settings-body' },
            e(SyncPreferences, {
              busy,
              lastSyncAt: status?.lastSyncAt,
              onSavingChange: setSettingsPending,
              onChanged: refresh,
            }),
            e(ConnectionSettings, {
              remote: status?.remote,
              branch: status?.branch,
              busy: busy || settingsPending,
              onSaved: refresh,
              onManage: () => openManagement('connection'),
            }),
          ),
        )
      : null,
    currentPage === 'sync'
      ? e(
          'section',
          { className: 'dss-sec', 'data-sync-recovery': true },
          e(
            'div',
            { className: 'dss-storage-head' },
            e('h2', { className: 'dss-section-title' }, syncBackupTitle),
            pill('管理备份', () => openManagement('conflict-backups')),
          ),
        )
      : null,
    currentPage === 'sync'
      ? e(
          'section',
          { className: 'dss-sec', 'data-storage-entry': true },
          e(
            'div',
            { className: 'dss-storage-head' },
            e('h2', { className: 'dss-section-title' }, storageTitle),
            pill('管理存储', () => openManagement('storage'), { disabled: busy || settingsPending }),
          ),
        )
      : null,
    currentPage === 'sync'
      ? e(
          'section',
          { className: 'dss-sec' },
          e(
            'div',
            { className: 'dss-storage-head' },
            e('h2', { className: 'dss-section-title' }, '修复会话问题（实验性）'),
            pill(
              '检查会话问题',
              () => {
                if (verificationPending || repairQueued) openRepair({ mode: 'all' });
                else setRepairDialog('all');
              },
              { disabled: busy || settingsPending },
            ),
          ),
        )
      : null,
    repairDialog
      ? e(
          Modal,
          {
            title: repairDialog === 'grouping' ? '处理未分组会话' : '检查会话问题',
            wide: true,
            onClose: () => setRepairDialog(null),
          },
          dialogBody(
            e(DataHealth, {
              key: repairDialog,
              expanded: true,
              busy: busy || settingsPending,
              grouping: repairDialog === 'grouping',
              onGrouping: () => setRepairDialog('grouping'),
              onVerified: refresh,
            }),
          ),
          dialogActions(
            '',
            repairDialog === 'grouping' ? pill('返回检查', () => setRepairDialog('all')) : null,
            pill('关闭', () => setRepairDialog(null)),
          ),
        )
      : null,
  );
}
