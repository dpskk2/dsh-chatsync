import path from 'node:path';

export function syncIssues(result) {
  if (!result) return [];
  const reports = result.privacyReports?.length ? result.privacyReports : result.privacy ? [result.privacy] : [];
  const issues = [];
  for (const report of reports) for (const finding of report.findings || []) {
    const reasons = finding.reasons || [];
    const tooLarge = reasons.includes('内容超过单文件扫描上限');
    const incomplete = finding.file?.startsWith('(') || reasons.some(reason => /检查未完成|无法|上限|不完整|不正确|额外数据|进程异常/.test(reason));
    const code = tooLarge ? 'SCAN_FILE_TOO_LARGE' : incomplete ? 'SCAN_INCOMPLETE' : 'SENSITIVE_CONTENT';
    issues.push({ code, scope: report.label || '会话与设置', file: finding.file, lines: [...new Set((finding.matches || []).map(m => m.line))],
      reason: tooLarge ? (Number.isFinite(finding.size) ? `文件大小 ${(finding.size / 1048576).toFixed(1)} MiB，单文件检查上限 ${((finding.limit || 8388608) / 1048576).toFixed(0)} MiB` : '文件超过单文件检查上限（8 MiB）') : reasons.join('、'),
      action: tooLarge ? '将大文件移出同步范围，并处理尚未上传历史中的该文件后重试。' : incomplete ? '检查此文件和本机 Git 是否可读取，然后重试。' : '核对所列位置；真实凭据需从文件及尚未上传的历史中移除后重试。',
      object: finding.object || null,
      location: report.root && finding.file && !finding.file.startsWith('(') ? path.join(report.root, finding.file) : finding.file,
    });
  }
  for (const workspace of result.workspaces?.errors || []) {
    if (reports.some(r => r.workspaceId === workspace.id || r.label === '工作区 ' + workspace.title)) continue;
    const labels = { push: '工作区上传失败', fetch: '工作区下载失败', auth: '工作区认证失败', reset: '工作区数据应用失败' };
    issues.push({ code: 'WORKSPACE_' + String(workspace.error || 'ERROR').toUpperCase(), scope: '工作区 ' + (workspace.title || workspace.id),
      reason: labels[workspace.error] || String(workspace.error || '工作区同步失败'), location: workspace.path,
      action: workspace.error === 'auth' ? '检查仓库登录状态和访问权限。' : '核对该工作区的仓库地址、网络连接和写入权限后重试。' });
  }
  if (!issues.length && result.error) issues.push({ code: 'SYNC_ERROR', scope: '会话与设置', reason: String(result.hint || result.error), action: '处理上述问题后重试同步。' });
  return issues;
}
