import { parseSyncRemote, remoteWeb, REMOTE_FORMAT_HINT } from './remote.js';
import { writeSyncConfig } from './config-file.js';

/** Why this computer's own login could not read a non-GitHub remote. */
function credentialReadError(engine, parsed, remote, result) {
  const detail = `${result.err || ''}\n${result.out || ''}`;
  const tail = '原同步仓库未更改。';
  if (result.code === -1) return '未检测到 Git。请安装 Git 后重试；' + tail;
  if (engine.isAuthError(detail) || /permission denied \(publickey|host key verification failed/i.test(detail))
    return parsed.transport === 'ssh'
      ? `这台电脑还不能用 SSH 登录 ${parsed.label}。请先为这台电脑配置 SSH 密钥，并在终端运行 git ls-remote ${remote} 确认可以读取；${tail}`
      : `这台电脑还没有 ${parsed.label} 的登录凭据。请先在终端运行 git ls-remote ${remote}，按提示登录后重试；${tail}`;
  if (/not found|returned error: 40[34]\b|access denied|forbidden/i.test(detail))
    return `${parsed.label} 找不到这个仓库，或当前账号无权访问。请检查地址和权限；${tail}`;
  if (result.timedOut) return `连接 ${parsed.label} 超时。请检查网络或代理后重试；${tail}`;
  return `无法用这台电脑的登录读取该仓库。请在终端运行 git ls-remote ${remote} 查看具体原因；${tail}`;
}

/** Validate an explicit destination change without creating repositories or transferring data. */
export async function saveConnection(engine, body) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    typeof body.remote !== 'string' ||
    typeof body.expectedRemote !== 'string'
  ) {
    throw new Error('请重新打开备份地址设置后重试。');
  }
  const remote = body.remote.trim();
  const parsed = remote ? parseSyncRemote(remote) : null;
  if (remote && !parsed) throw new Error(REMOTE_FORMAT_HINT);
  const patch = remote
    ? { remote, autoRepo: false }
    : { remote: '', autoRepo: true, repoOwner: '', repoName: 'dsh-sync' };
  const checkCurrent = () => {
    const current = engine.loadConfig();
    if (current.configError) throw new Error(current.configError);
    if (engine.inFlight || engine.progress?.running) throw new Error('同步正在进行，请完成后再保存设置。');
    if ((current.remote || '') !== body.expectedRemote) throw new Error('备份地址已发生变化，请取消后重新打开设置。');
    for (const [key, value] of Object.entries(patch)) {
      if (engine.overrides?.[key] !== undefined && engine.overrides[key] !== value)
        throw new Error('备份地址受宿主配置限制，请先修改宿主配置。');
    }
  };
  checkCurrent();
  let hint = remote ? '已验证并保存备份仓库。' : '已使用默认备份；首次同步时自动创建或复用 dsh-sync 私有仓库。';
  if (parsed && parsed.provider !== 'github') {
    const verified = await engine.verifyPrivateRemote(remote);
    if (!verified.ok) throw new Error(verified.error.replace(/本次不会上传。$/, '原同步仓库未更改。'));
    // Other hosts expose no permission API: prove this computer's login can read it.
    const read = await engine.git(['ls-remote', '--heads', remote], 60000);
    if (!engine.ok(read)) throw new Error(credentialReadError(engine, parsed, remote, read));
    hint = `已确认 ${parsed.label} 上的仓库需要登录才能读取，且这台电脑可以读取；写入权限在首次上传时确认。`;
  } else if (parsed) {
    const result = await engine.gh(['repo', 'view', parsed.fullName, '--json', 'visibility,viewerPermission']);
    if (!engine.ok(result)) throw new Error(engine.githubRequestError(result));
    let info;
    try {
      info = JSON.parse(result.out);
    } catch {
      /* fail closed */
    }
    if (
      !info ||
      !['PRIVATE', 'PUBLIC', 'INTERNAL'].includes(info.visibility) ||
      typeof info.viewerPermission !== 'string'
    ) {
      throw new Error('无法确认仓库信息，请稍后重试。原备份地址未更改。');
    }
    if (info.visibility !== 'PRIVATE') throw new Error('该仓库不是私有仓库，请先在 GitHub 创建或选择私有仓库。');
    if (!['WRITE', 'MAINTAIN', 'ADMIN'].includes(info.viewerPermission))
      throw new Error('当前 GitHub 账号没有该仓库的写入权限，请更换仓库或调整权限。');
  }
  // Recheck after the network request and serialize against sync and other destination changes.
  const release = engine.acquireProcessLock();
  if (!release) throw new Error('同步正在进行，请完成后再保存设置。');
  try {
    checkCurrent();
    writeSyncConfig(engine.configPath(), patch);
    const c = engine.loadConfig();
    return {
      config: {
        remote: c.remote || '',
        remoteWeb: remoteWeb(c.remote),
        branch: c.branch,
        autoRepo: c.autoRepo !== false,
      },
      hint,
    };
  } finally {
    release();
  }
}

/**
 * Read-only check of the default backup right after it is chosen: which account
 * gh uses and whether its dsh-sync repository will be reused or created. Never
 * creates a repository or changes the configuration.
 */
export async function checkDefaultBackup(engine) {
  const cfg = engine.loadConfig();
  if (cfg.configError) return { ok: false, message: cfg.configError };
  // A new choice deserves a fresh attempt on the next manual sync.
  engine._bootstrapAt = 0;
  const repo = cfg.repoName || 'dsh-sync';
  let owner = cfg.repoOwner;
  if (!owner) {
    const login = await engine.gh(['api', 'user', '--jq', '.login']);
    owner = engine.ok(login) ? login.out.trim() : '';
    if (!owner) return { ok: false, message: engine.githubRequestError(login) };
  }
  const view = await engine.gh(['repo', 'view', `${owner}/${repo}`, '--json', 'visibility']);
  if (engine.ok(view)) {
    let visibility;
    try {
      visibility = JSON.parse(view.out).visibility;
    } catch {
      /* fail closed */
    }
    if (visibility === 'PRIVATE')
      return {
        ok: true,
        message: `GitHub 账号 ${owner} 已登录；将复用 ${owner}/${repo} 私有仓库，点击「立即同步」即可连接。`,
      };
    if (visibility === 'PUBLIC' || visibility === 'INTERNAL')
      return {
        ok: false,
        message: `${owner}/${repo} 不是私有仓库，同步时不会上传。请在 GitHub 改为私有，或使用其他仓库。`,
      };
    return { ok: false, message: 'GitHub 返回的仓库信息异常。请稍后重试；本次不会上传。' };
  }
  if (
    !view.timedOut &&
    view.code !== -1 &&
    /HTTP 404|could not resolve to a repository|not found/i.test(`${view.err || ''}\n${view.out || ''}`)
  ) {
    return { ok: true, message: `GitHub 账号 ${owner} 已登录；将在首次同步时创建 ${owner}/${repo} 私有仓库。` };
  }
  return { ok: false, message: engine.githubRequestError(view) };
}
