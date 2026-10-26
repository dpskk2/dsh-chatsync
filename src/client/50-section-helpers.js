/* ---------- 设置分节:同步状态卡(只读状态 + 立即同步) ---------- */
/* 字节数 → 可读文本(与宿主端 humanSize 同规则) */
function fmtBytes(b) {
  if (!b && b !== 0) return '';
  const abs = Math.abs(b);
  if (abs >= 1024 ** 3) return (b / 1024 ** 3).toFixed(2) + ' GiB';
  if (abs >= 1024 ** 2) return (b / 1024 ** 2).toFixed(2) + ' MiB';
  if (abs >= 1024) return (b / 1024).toFixed(1) + ' KiB';
  return b + ' B';
}
/* 把上次结果(含错误明细)渲染成一段可排障的文本 */
function lastDetailText(lastDetail) {
  if (!lastDetail) return '';
  const lines = [];
  if (lastDetail.privacy?.findings?.length) {
    lines.push('上传前检查已暂停：');
    for (const finding of lastDetail.privacy.findings)
      lines.push('  ' + finding.file + '：' + finding.reasons.join('、'));
    lines.push('检查包含尚未上传的历史快照；仅删除当前文件或新增忽略规则不能移除已经提交的敏感内容。');
  }
  const act = [];
  if (lastDetail.committed) act.push('提交');
  if (lastDetail.pushed) act.push('推送');
  if (lastDetail.pulled && lastDetail.pulled !== 'reset') act.push('拉取(' + lastDetail.pulled + ')');
  if (lastDetail.pulled === 'reset') act.push('整体取回');
  if (act.length) lines.push('本次动作: ' + act.join(' / '));
  if (lastDetail.durationMs != null) lines.push('耗时: ' + (lastDetail.durationMs / 1000).toFixed(1) + 's');
  const transfers = lastDetail.transfers || [];
  for (const [op, label] of [
    ['push', '上传'],
    ['fetch', '下载'],
  ]) {
    const bytes = transfers
      .filter(t => (op === 'push' ? t.op === 'push' : t.op !== 'push'))
      .reduce((sum, t) => sum + (t.size || 0), 0);
    if (bytes) lines.push(label + ': ' + fmtBytes(bytes));
  }
  if (lastDetail.repoSize != null) lines.push('仓库体积: ' + fmtBytes(lastDetail.repoSize));
  if (lastDetail.skipped) lines.push('跳过: ' + lastDetail.skipped);
  for (const w of lastDetail.sessionWarnings || [])
    lines.push(
      '会话未混合合并: ' +
        w.path +
        '；当前保留' +
        (w.kept === 'remote' ? '远端' : '本机') +
        '；本机原件 ' +
        w.localHead +
        '；远端原件 ' +
        w.remoteHead,
    );
  for (const w of lastDetail.sessionDeferred || []) lines.push('会话等待应用: ' + w.hint + '；' + w.file);
  for (const warning of lastDetail.scopeWarnings || []) lines.push(warning);
  if (lastDetail.settingsPause) lines.push(lastDetail.settingsPause);
  if (lastDetail.backupBranch)
    lines.push(
      '备份分支: ' +
        lastDetail.backupBranch +
        (lastDetail.backupPushed === true ? '（已上传）' : '（仅在本机，上传失败）'),
    );
  if (lastDetail.error)
    lines.push(
      (lastDetail.dataVerificationPending || lastDetail.dataRepairQueued ? '待处理: ' : '主数据错误: ') +
        lastDetail.error,
    );
  if (lastDetail.workspaces) {
    const w = lastDetail.workspaces;
    for (const b of w.backups || [])
      lines.push('工作区 ' + b.id + ' 备份分支: ' + b.branch + (b.pushed ? '（已上传）' : '（仅在本机，上传失败）'));
    if (w.total)
      lines.push(
        '工作区: 共 ' +
          w.total +
          ',已同步 ' +
          (w.synced || 0) +
          ',推送 ' +
          (w.pushed || 0) +
          ',拉取 ' +
          (w.pulled || 0) +
          (w.skipped ? ',跳过 ' + w.skipped : ''),
      );
    if (w.errors && w.errors.length) {
      lines.push('工作区失败(' + w.errors.length + '):');
      for (const err of w.errors) lines.push('  - ' + (err.title || err.id || '?') + ': ' + (err.error || '未知错误'));
    }
  }
  if (lastDetail.conflictCopies && lastDetail.conflictCopies.length) {
    lines.push('遗留冲突副本(' + lastDetail.conflictCopies.length + ') 待清理:');
    for (const c of lastDetail.conflictCopies) {
      lines.push(
        '  - ' +
          (c.kind === 'ws' ? '[工作区' + (c.id || '?') + '] ' : '') +
          c.path +
          (c.copy ? '\n      远端版本: ' + c.copy : ''),
      );
    }
  }
  return lines.join('\n');
}

/* 常用偏好复用已有配置 API；保存后由宿主重建自动调度，无需重启。 */
const DOCS = 'https://github.com/dpskk2/dsh-chatsync/blob/main/docs/';
function helpLink(label, href) {
  return e('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label);
}
function stepHeading(number, title) {
  return e(
    'div',
    { className: 'dss-step-heading' },
    e('span', { className: 'dss-step-number', 'aria-hidden': true }, number),
    e('div', { className: 'dss-h' }, title),
  );
}
// Older versions uploaded machine-only files; remove them from the shared copy only
// after every computer in use runs a version that keeps its own copy.
function RemoteCleanup({ busy }) {
  const [preview, setPreview] = useState(null),
    [pending, setPending] = useState(false);
  const [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [retired, setRetired] = useState([]),
    [confirmed, setConfirmed] = useState(false);
  const check = async () => {
    setPending(true);
    setError('');
    setMessage('');
    setRetired([]);
    setConfirmed(false);
    try {
      const data = await API.remoteCleanup();
      if (!data?.ok) throw new Error(data?.error || '检查失败，请重试');
      setPreview(data);
    } catch (err) {
      setPreview(null);
      setError(err.message || String(err));
    } finally {
      setPending(false);
    }
  };
  const apply = async () => {
    setPending(true);
    setError('');
    try {
      const data = await API.applyRemoteCleanup({ previewId: preview.previewId, retiredDevices: retired });
      if (!data?.ok) throw new Error(data?.error || '清理未完成，请重新检查');
      setMessage('已从同步仓库的最新版本移除 ' + data.removed + ' 个文件；各电脑自己的文件保持不变。');
      setPreview(null);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setPending(false);
    }
  };
  const blocked = busy || pending;
  const waiting = preview ? preview.blockers.filter(b => !retired.includes(b.deviceId)) : [];
  return e(
    'section',
    { className: 'dss-sec', 'data-remote-cleanup': true },
    e('h2', { className: 'dss-section-title' }, '清理远端不再同步的文件'),
    e(
      'p',
      { className: 'dss-desc' },
      '旧版本上传过插件清单、备份、脚本等本机文件。所有在用的电脑都升级后，可从同步仓库的最新版本移除它们；不改写历史，也不删除任何电脑上的文件。',
    ),
    e(
      'button',
      { type: 'button', className: 'dss-pill', disabled: blocked, onClick: check },
      pending ? '正在检查…' : '检查',
    ),
    error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null,
    message ? e('div', { className: 'dss-save-state', role: 'status' }, message) : null,
    preview
      ? e(
          'div',
          { className: 'dss-stack' },
          e(
            'div',
            { className: 'dss-desc' },
            preview.files.length ? '远端有 ' + preview.files.length + ' 个文件不再同步：' : '远端没有需要清理的文件。',
          ),
          preview.files.length
            ? e(
                'ul',
                { className: 'dss-desc' },
                preview.files.slice(0, 20).map(file => e('li', { key: file }, e('code', null, file))),
                preview.files.length > 20 ? e('li', null, '…另有 ' + (preview.files.length - 20) + ' 个') : null,
              )
            : null,
          preview.blockers.length
            ? e(
                'div',
                { className: 'dss-stack' },
                e(
                  'div',
                  { className: 'dss-err', role: 'alert' },
                  '以下电脑还没有确认升级到 ' +
                    preview.minVersion +
                    '。请先在它们上面升级并同步一次；只有不再使用的电脑才勾选：',
                ),
                ...preview.blockers.map(b =>
                  e(
                    'label',
                    { key: b.deviceId, className: 'dss-check' },
                    e('input', {
                      type: 'checkbox',
                      'aria-label': b.deviceName + ' 已不再使用',
                      checked: retired.includes(b.deviceId),
                      onChange: event =>
                        setRetired(
                          event.target.checked ? [...retired, b.deviceId] : retired.filter(id => id !== b.deviceId),
                        ),
                    }),
                    e(
                      'span',
                      { className: 'dss-choice' },
                      b.deviceName + ' 已不再使用',
                      e(
                        'small',
                        null,
                        b.reason + (b.appliedAt ? ' · 最后同步 ' + new Date(b.appliedAt).toLocaleString() : ''),
                      ),
                    ),
                  ),
                ),
              )
            : null,
          preview.files.length && !waiting.length
            ? e(
                'label',
                { className: 'dss-check' },
                e('input', {
                  type: 'checkbox',
                  'aria-label': '确认清理远端文件',
                  checked: confirmed,
                  onChange: event => setConfirmed(event.target.checked),
                }),
                e('span', { className: 'dss-choice' }, '确认从同步仓库最新版本移除以上文件'),
              )
            : null,
          preview.files.length
            ? e(
                'button',
                {
                  type: 'button',
                  className: 'dss-pill dss-primary',
                  disabled: blocked || waiting.length > 0 || !confirmed,
                  onClick: apply,
                },
                '清理远端文件',
              )
            : null,
        )
      : null,
  );
}
function LocalStorage({ busy }) {
  const [opened, setOpened] = useState(false),
    [scan, setScan] = useState(null);
  const [selected, setSelected] = useState([]),
    [pending, setPending] = useState(false);
  const [error, setError] = useState(''),
    [preview, setPreview] = useState(null),
    [result, setResult] = useState(null);
  const [confirmed, setConfirmed] = useState(false),
    [separate, setSeparate] = useState(false);
  const size = bytes =>
    bytes >= 1073741824
      ? (bytes / 1073741824).toFixed(2) + ' GB'
      : bytes >= 1048576
        ? (bytes / 1048576).toFixed(1) + ' MB'
        : (bytes / 1024).toFixed(1) + ' KB';
  const perform = async task => {
    setPending(true);
    setError('');
    try {
      const data = await task();
      if (!data?.ok) {
        if (data?.results) setResult(data);
        throw new Error(data?.error || '部分材料清理失败，请查看逐项结果');
      }
      return data;
    } catch (e) {
      setError(e.message || '操作失败，请重试');
      return null;
    } finally {
      setPending(false);
    }
  };
  const refresh = async () => {
    setOpened(true);
    setPreview(null);
    setSelected([]);
    setConfirmed(false);
    setSeparate(false);
    const data = await perform(() => API.localStorage());
    if (data) setScan(data);
  };
  const blocked = busy || pending;
  return e(
    'section',
    { className: 'dss-sec', 'data-local-storage': true },
    e('h2', { className: 'dss-section-title' }, '本地存储与备份'),
    e('p', { className: 'dss-desc' }, '查看同步历史、恢复材料和项目旁备份，清理已不需要的本地副本。'),
    e(
      'button',
      { type: 'button', className: 'dss-pill', disabled: blocked, onClick: refresh },
      pending ? '正在核对…' : opened ? '重新查看占用' : '查看占用并清理',
    ),
    error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null,
    scan && opened
      ? e(
          'div',
          { className: 'dss-stack' },
          e('div', { className: 'dss-desc' }, '本次可核对的占用：' + size(scan.totalBytes)),
          e(
            'label',
            { className: 'dss-check' },
            '保留最近的备份',
            e(
              'select',
              {
                value: scan.policy.retentionDays,
                disabled: blocked,
                onChange: async event => {
                  const retentionDays = Number(event.target.value);
                  const saved = await perform(() => API.localStorage('policy', { retentionDays }));
                  if (saved) await refresh();
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
          e('p', { className: 'dss-desc' }, '按保留时间筛选可清理项；每次仍需你选择并确认，不会自动删除。'),
          scan.warnings?.map((warning, i) => e('p', { key: i, className: 'dss-err' }, warning)),
          scan.categories.map(category =>
            e(
              'details',
              { key: category.id, className: 'dss-utility-card' },
              e('summary', null, category.title + ' · ' + size(category.bytes)),
              e('p', { className: 'dss-desc' }, category.purpose),
              scan.items
                .filter(item => item.category === category.id)
                .map(item =>
                  e(
                    'div',
                    { key: item.id, className: 'dss-stack' },
                    e(
                      'label',
                      { className: 'dss-check' },
                      e('input', {
                        type: 'checkbox',
                        disabled: blocked || item.protected,
                        checked: selected.includes(item.id),
                        onChange: event => {
                          const checked = event.target.checked;
                          setSelected(old => (checked ? [...old, item.id] : old.filter(id => id !== item.id)));
                          setPreview(null);
                          setConfirmed(false);
                          setSeparate(false);
                        },
                      }),
                      item.name + ' · ' + size(item.bytes),
                    ),
                    e('div', { className: 'dss-desc', style: { overflowWrap: 'anywhere' } }, item.path),
                    e(
                      'div',
                      { className: 'dss-desc' },
                      item.protected
                        ? '保留：' + item.reason
                        : item.separateConfirmation
                          ? '可选择清理；执行前需单独确认'
                          : '可选择清理',
                    ),
                  ),
                ),
            ),
          ),
          e('p', { className: 'dss-desc' }, scan.note),
          e(
            'button',
            {
              type: 'button',
              className: 'dss-pill',
              disabled: blocked || !selected.length,
              onClick: async () => {
                setResult(null);
                setConfirmed(false);
                setSeparate(false);
                const data = await perform(() => API.localStorage('preview', { ids: selected }));
                if (data) setPreview(data);
              },
            },
            '预览清理所选备份（' + selected.length + '）',
          ),
        )
      : null,
    preview
      ? e(
          'div',
          { className: 'dss-utility-card', 'data-cleanup-preview': true },
          e('h3', { className: 'dss-subtitle' }, '核对将失去的恢复来源'),
          preview.items.map(item =>
            e(
              'p',
              { key: item.id, className: 'dss-desc', style: { overflowWrap: 'anywhere' } },
              item.path + ' · ' + size(item.bytes),
            ),
          ),
          e('p', { className: 'dss-desc' }, preview.warning),
          e(
            'label',
            { className: 'dss-check' },
            e('input', {
              type: 'checkbox',
              checked: confirmed,
              disabled: blocked,
              onChange: event => setConfirmed(event.target.checked),
            }),
            '确认不再需要上述备份，接受永久清理',
          ),
          preview.separateConfirmation
            ? e(
                'label',
                { className: 'dss-check' },
                e('input', {
                  type: 'checkbox',
                  checked: separate,
                  disabled: blocked,
                  onChange: event => setSeparate(event.target.checked),
                }),
                '单独确认旧同步仓库或项目旁备份；已完成核对并结束相关编辑',
              )
            : null,
          e(
            'button',
            {
              type: 'button',
              className: 'dss-pill',
              disabled: blocked || !confirmed || (preview.separateConfirmation && !separate),
              onClick: async () => {
                const data = await perform(() =>
                  API.localStorage('apply', { token: preview.token, confirm: confirmed, confirmSeparate: separate }),
                );
                setPreview(null);
                setSelected([]);
                if (data) {
                  setResult(data);
                  await refresh();
                }
              },
            },
            '永久清理所选本地备份',
          ),
        )
      : null,
    result
      ? e(
          'div',
          { className: 'dss-stack', role: 'status' },
          e(
            'p',
            { className: 'dss-desc' },
            '已移除 ' + size(result.removedBytes || 0) + ' 逻辑字节。' + (result.hint || ''),
          ),
          result.results?.map(row =>
            e(
              'p',
              { key: row.id, className: row.ok ? 'dss-desc' : 'dss-err' },
              (row.name || scan?.items.find(item => item.id === row.id)?.name || '所选备份') +
                '：' +
                (row.ok ? '已清理' : row.error + (row.retainedPath ? '；尚存材料：' + row.retainedPath : '')),
            ),
          ),
        )
      : null,
  );
}
