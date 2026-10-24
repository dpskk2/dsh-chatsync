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
      action: tooLarge ? (report.stage === 'before-commit' ? '该文件尚未写入本次快照。将它移出项目目录或加入项目 .gitignore 后重试；本机文件保留。'
        : '将大文件移出同步范围；仅删除当前文件不能清除历史。请先备份工作区和影子仓库，再处理尚未上传的历史。')
        : incomplete ? '检查此文件和本机 Git 是否可读取，然后重试。' : '核对所列位置；真实凭据需从文件及尚未上传的历史中移除后重试。',
      object: finding.object || null,
      location: report.root && finding.file && !finding.file.startsWith('(') ? path.join(report.root, finding.file) : finding.file,
    });
  }
  for (const workspace of result.workspaces?.errors || []) {
    if (reports.some(r => r.workspaceId === workspace.id || r.label === '工作区 ' + workspace.title)) continue;
    const labels = { push: '工作区上传失败', fetch: '工作区下载失败', auth: '工作区认证失败', reset: '工作区数据应用失败' };
    const identity = /Author identity unknown|Committer identity unknown|unable to auto-detect email|empty ident|user\.(?:name|email)/i.test(workspace.gitError || '');
    issues.push({ code: 'WORKSPACE_' + (workspace.operation ? workspace.operation.toUpperCase() + '_FAILED' : String(workspace.error || 'ERROR').toUpperCase()), scope: '工作区 ' + (workspace.title || workspace.id),
      reason: labels[workspace.error] || String(workspace.error || '工作区同步失败'), location: workspace.path,
      action: identity ? '检查 dsh-sync.json 中的 gitUserName / gitUserEmail 后重试；留空使用插件默认身份，无需修改全局 Git 配置。'
        : workspace.operation ? '按上述 Git 原因检查工作区文件和影子仓库的写入权限后重试；本机文件保留。'
        : workspace.error === 'auth' ? '检查仓库登录状态和访问权限。' : '核对该工作区的仓库地址、网络连接和写入权限后重试。' });
  }
  if (!issues.length && result.error) issues.push({ code: 'SYNC_ERROR', scope: '会话与设置', reason: String(result.hint || result.error), action: '处理上述问题后重试同步。' });
  return issues;
}
