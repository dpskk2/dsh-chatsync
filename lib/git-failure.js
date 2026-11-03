// Turn a failed git network command into a reason and next step the user can act on.
// The raw Git lines stay in `detail` for the technical record.
import { redactGitDiagnostic } from './privacy.js';

const PROGRESS_LINE =
  /^(?:remote:\s*)?(?:Enumerating|Counting|Compressing|Writing|Receiving|Resolving|Total|Delta compression|Unpacking)\b/i;

/** Git's own error lines, without progress noise; at most three. */
export function gitErrorLines(text) {
  return redactGitDiagnostic(text)
    .split(/[\r\n]+/)
    .map(line => line.trim())
    .filter(line => line && !PROGRESS_LINE.test(line) && !/^hint:/i.test(line))
    .slice(-3);
}

// Order matters: specific rejections before the generic network patterns.
const KINDS = [
  {
    kind: 'git-missing',
    title: '未安装 Git',
    test: (r, t) => r.code === -1 && /ENOENT/i.test(t),
    reason: () => '未找到 Git',
    action: '安装 Git for Windows 后重启 DSH',
    retry: false,
  },
  {
    kind: 'auth',
    title: '登录或权限问题',
    test: (_, t) =>
      /could not read Username|terminal prompts disabled|authentication failed|could not read password|not logged in|failed to execute prompt|invalid username or password|returned error: 401\b|permission to \S+ denied|permission denied \(publickey|host key verification failed/i.test(
        t,
      ),
    reason: () => '登录失效，或账号无写入权限',
    action: '重新登录托管站账号',
    retry: false,
  },
  {
    kind: 'not-found',
    title: '找不到同步仓库',
    test: (_, t) => /repository not found|does not appear to be a git repository|returned error: 404\b/i.test(t),
    reason: () => '仓库不存在或无权访问',
    action: '核对仓库地址',
    retry: false,
  },
  {
    kind: 'too-large',
    title: '单个文件过大',
    test: (_, t) => /exceeds GitHub's file size limit|GH001|large files detected|file size limit|this exceeds/i.test(t),
    reason: () => '有文件超过托管站上限（GitHub 100 MB）',
    action: '在同步仓库明细中找到并移出',
    retry: false,
  },
  {
    kind: 'request-too-large',
    title: '上传数据包被拒收',
    test: (_, t) => /returned error: 413\b|HTTP 413|request entity too large|body too large/i.test(t),
    reason: () => '被代理或网关拒收（HTTP 413）',
    action: '换代理或直连',
    retry: false,
  },
  {
    kind: 'quota',
    title: '托管站容量已满',
    test: (_, t) => /quota|storage limit|repository (?:is )?(?:over|too large)|disk quota/i.test(t),
    reason: () => '托管站空间已满',
    action: '清理空间或换仓库',
    retry: false,
  },
  {
    kind: 'rejected',
    title: '远端已有新内容',
    test: (_, t) => /\[rejected\]|non-fast-forward|fetch first|stale info|failed to update ref/i.test(t),
    reason: () => '另一台电脑刚上传了新内容',
    action: '重新同步',
    retry: false,
  },
  {
    kind: 'protected',
    title: '仓库规则拒绝',
    test: (_, t) => /pre-receive hook declined|protected branch|\[remote rejected\]|GH006|GH013/i.test(t),
    reason: () => '受保护分支或服务器检查拒绝推送',
    action: '在托管站取消分支保护',
    retry: false,
  },
  {
    kind: 'disk',
    title: '本机磁盘已满',
    test: (_, t) => /no space left on device|ENOSPC|disk full/i.test(t),
    reason: () => '磁盘空间不足',
    action: '清理磁盘后重试',
    retry: false,
  },
  {
    kind: 'proxy',
    title: '代理连接失败',
    test: (_, t) =>
      /proxy|Failed to connect to (?:127\.0\.0\.1|localhost|::1)\b|Unsupported proxy|CONNECT tunnel failed|SOCKS/i.test(
        t,
      ),
    reason: () => '连不上代理',
    action: '检查代理软件是否开启、端口是否一致',
    retry: true,
  },
  {
    kind: 'network',
    title: '网络连接中断',
    test: (_, t) =>
      /could not resolve host|failed to connect|connection (?:reset|refused|closed|timed out)|timed out|early EOF|unexpected disconnect|RPC failed|curl \d+|SSL|TLS|schannel|recv failure|send failure|the remote end hung up|broken pipe|network is unreachable|empty reply/i.test(
        t,
      ),
    reason: () => '连接中断',
    action: '检查网络或代理后重试',
    retry: true,
  },
];

/**
 * @param {{ code?: number|null, err?: string, out?: string, timedOut?: boolean, stalledMs?: number }} result
 * @param {'push'|'fetch'|'clone'} op
 */
export function describeGitFailure(result, op) {
  const verb = op === 'push' ? '上传' : '下载';
  const text = `${result?.err || ''}\n${result?.out || ''}`;
  const detail = gitErrorLines(text);
  if (result?.timedOut) {
    const minutes = Math.max(1, Math.round((result.stalledMs || 0) / 60000));
    return result.stalledMs
      ? {
          kind: 'stalled',
          title: '传输停滞',
          reason: `${verb} ${minutes} 分钟无进展，已停止`,
          action: '检查网络或代理后重试',
          detail,
          retry: false,
        }
      : {
          kind: 'too-slow',
          title: '传输耗时过长',
          reason: `${verb}超过 4 小时未完成`,
          action: '换更快的网络或代理',
          detail,
          retry: false,
        };
  }
  for (const entry of KINDS)
    if (entry.test(result || {}, text))
      return {
        kind: entry.kind,
        title: entry.title,
        reason: entry.reason(),
        action: entry.action,
        detail,
        retry: entry.retry,
      };
  return {
    kind: 'other',
    title: '其他 Git 错误',
    reason: detail.at(-1) || 'Git 退出码 ' + (result?.code ?? '未知'),
    action: '附上 Git 原文反馈',
    detail,
    retry: true,
  };
}

/** Fields a main-sync result carries for a failed upload. Pauses that are not Git errors pass through. */
export function pushFailure(result) {
  if (result?.paused) return { error: 'push' };
  const failure = describeGitFailure(result, 'push');
  return {
    error: 'push',
    hint: failure.reason + '。' + failure.action,
    failure: {
      op: 'push',
      kind: failure.kind,
      title: failure.title,
      reason: failure.reason,
      action: failure.action,
      detail: failure.detail,
    },
  };
}
