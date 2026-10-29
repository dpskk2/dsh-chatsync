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
  if (lastDetail.repoSize != null) lines.push('本机同步副本（含历史）: ' + fmtBytes(lastDetail.repoSize));
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
// The host's modal scroll lock can cancel native-dialog wheel defaults. Handle
// scrolling inside our dialog, including text descendants and nested lists.
function scrollDialogWheel(event, root) {
  if (event.ctrlKey) return; // Keep browser zoom available.
  const unit = event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? root.clientHeight : 1;
  const dx = event.deltaX * unit,
    dy = event.deltaY * unit;
  for (
    let node = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
    node;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node);
    const x = /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
    const y = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
    const canX = x && dx && (dx < 0 ? node.scrollLeft > 0 : node.scrollLeft < node.scrollWidth - node.clientWidth);
    const canY = y && dy && (dy < 0 ? node.scrollTop > 0 : node.scrollTop < node.scrollHeight - node.clientHeight);
    if (canX || canY) {
      if (canX) node.scrollLeft += dx;
      if (canY) node.scrollTop += dy;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (node === root) break;
  }
}
function useDialogWheel(ref) {
  useEffect(() => {
    const root = ref.current;
    const wheel = event => scrollDialogWheel(event, root);
    root?.addEventListener?.('wheel', wheel, { passive: false });
    return () => root?.removeEventListener?.('wheel', wheel);
  }, []);
}
