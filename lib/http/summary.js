// HTTP layer of the plugin entry (lib/index.js): sync result summaries.
import { humanSize } from '../sync.js';
import { syncIssues } from '../diagnostics.js';

/** 把一次同步结果压成一句话 */
export function summarize(r) {
  if (r?.repaired)
    return r.verificationAcknowledged
      ? '数据修复已完成并已确认检查，原件备份保留。'
      : '数据修复已完成。请到「设置 → 同步 → 检查与修复历史数据」，核对正文、项目归属和附件，再点击「已检查修复结果，允许同步」；原件备份保留。';
  if (r?.cancelled) return r.message || '本次同步已取消，已保存的改动保留。';
  if (r?.needsReview && !r.privacy) return '等待确认同步预览；请查看变更后选择“确认并继续”。';
  if (r?.downloadPending) return '已保存上传，已有会话更新待关闭后取回。';
  if (r?.deferred && !r.error) return r.message || '同步尚未完成，请稍后重试。';
  const parts = [];
  if (r.historyRebuilt) parts.push('同步仓库的历史已重建，这台电脑已按新历史重新同步');
  const upBytes = (r.transfers || []).filter(t => t.op === 'push').reduce((a, t) => a + (t.size || 0), 0);
  const downBytes = (r.transfers || []).filter(t => t.op === 'fetch').reduce((a, t) => a + (t.size || 0), 0);
  if (r.committed) parts.push('已提交本地快照');
  if (r.pulled === 'ff') parts.push('已拉取远端新数据' + (downBytes ? `(${humanSize(downBytes)})` : ''));
  if (r.pulled === 'merge') parts.push(r.unrelated ? '已并入远端历史' : '已合并双方数据');
  if (r.pulled === 'reset') parts.push('已整体取回远端');
  if (r.pushed) parts.push('已推送到远端' + (upBytes ? `(${humanSize(upBytes)})` : ''));
  if (r.conflicts && r.conflicts.length) parts.push(r.conflicts.length + ' 个冲突已按类型处理');
  if (r.sessionWarnings?.length)
    parts.push(r.sessionWarnings.length + ' 个会话未混合合并，双方原件保留在 Git 历史中，请查看详情');
  if (r.sessionDeferred?.length) parts.push(r.sessionDeferred.length + ' 个会话等待安全写入，请查看详情；本机原件保留');
  if (r.settingsPause) parts.push(r.settingsPause);
  if (r.backupBranch) parts.push('远端备份: ' + r.backupBranch + (r.backupPushed ? '（已上传）' : '（仅本机）'));
  if (r.restartRequired)
    parts.push(r.restartHost === 'desktop' ? '请退出桌面应用后重新打开，以刷新会话列表' : '请重启 DSH，以刷新会话列表');
  if (r.skipped) parts.push('跳过(' + r.skipped + ')');
  if (r.error === 'auth') parts.push('凭据缺失: ' + (r.hint || '请先 gh auth login 或配置 PAT,再点同步'));
  else if (r.error) parts.push('未完成: ' + (r.hint || r.error));
  if (r.workspaces && r.workspaces.total) {
    const w = r.workspaces;
    const wparts = [];
    if (w.synced) wparts.push(w.synced + ' 个工作区已同步');
    if (w.pushed) wparts.push(w.pushed + ' 个已推送');
    if (w.pulled) wparts.push(w.pulled + ' 个已拉取');
    if (wparts.length) parts.push('工作区: ' + wparts.join(','));
  }
  if (r.workspaces?.errors?.length)
    parts.push(
      '工作区失败: ' +
        r.workspaces.errors.map(e => (e.title || e.id || '项目') + (e.error ? '（' + e.error + '）' : '')).join(', '),
    );
  if (!parts.length) parts.push('已是最新,无需变更');
  return parts.join(';');
}

/** 从一次同步结果里抽出可供状态接口展示/排障的摘要(不含敏感信息) */
export function lastDetail(r) {
  if (!r) return null;
  const w = r.workspaces;
  const conflictCopies = [
    ...(Array.isArray(r.conflictCopies) ? r.conflictCopies : []),
    ...(w && Array.isArray(w.conflictCopies) ? w.conflictCopies : []),
  ];
  return {
    committed: Boolean(r.committed),
    pushed: Boolean(r.pushed),
    pulled: r.pulled || null,
    error: r.error || null,
    dataVerificationPending: r.dataVerificationPending === true,
    dataRepairQueued: r.dataRepairQueued === true,
    cancelled: r.cancelled === true,
    deferred: r.deferred === true,
    skipped: r.skipped || null,
    conflicts: Array.isArray(r.conflicts) ? r.conflicts : [],
    sessionWarnings: Array.isArray(r.sessionWarnings) ? r.sessionWarnings : [],
    sessionDeferred: Array.isArray(r.sessionDeferred)
      ? r.sessionDeferred.map(({ file, reason, hint }) => ({ file, reason, hint }))
      : [],
    scopeWarnings: Array.isArray(r.scopeWarnings) ? r.scopeWarnings : [],
    settingsPause: typeof r.settingsPause === 'string' ? r.settingsPause : null,
    privacy: r.privacy || null,
    privacyReports: r.privacyReports || [],
    issues: syncIssues(r),
    review: r.review || null,
    needsReview: r.needsReview === true,
    conflictCopies: conflictCopies.map(c => ({
      kind: c.kind,
      id: c.id || null,
      path: c.path,
      copy: c.copy,
      conflictAt: c.conflictAt,
    })),
    backupBranch: r.backupBranch || null,
    backupPushed: r.backupPushed === true,
    restartRequired: r.restartRequired === true,
    historyRebuilt: r.historyRebuilt === true,
    downloadPending: r.downloadPending === true,
    restartHost: r.restartHost || null,
    workspaces: w
      ? {
          total: w.total || 0,
          synced: w.synced || 0,
          pushed: w.pushed || 0,
          pulled: w.pulled || 0,
          skipped: w.skipped || null,
          errors: Array.isArray(w.errors)
            ? w.errors.map(e => ({
                id: e.id,
                title: e.title,
                path: e.path,
                error: e.error,
                operation: e.operation,
                gitError: e.gitError,
              }))
            : [],
          backups: Array.isArray(w.backups)
            ? w.backups.map(b => ({ id: b.id, branch: b.branch, pushed: b.pushed === true }))
            : [],
          created: Array.isArray(w.created)
            ? w.created.map(c => ({ id: c.id, title: c.title, path: c.path, recorded: c.recorded }))
            : [],
        }
      : null,
    durationMs: r.durationMs || null,
    repoSize: r.repoSize ?? null,
    stages: Array.isArray(r.stages) ? r.stages.map(s => ({ stage: s.stage, label: s.label, ms: s.ms })) : [],
    transfers: Array.isArray(r.transfers)
      ? r.transfers.map(t => ({
          op: t.op,
          label: t.label || null,
          size: t.size,
          speed: t.speed,
          totalObjects: t.totalObjects,
          reused: t.reused,
        }))
      : [],
  };
}
