import { parseSyncRemote } from './remote.js';
import { writeSyncConfig } from './config-file.js';

/** Validate an explicit destination change without creating repositories or transferring data. */
export async function saveConnection(engine, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.remote !== 'string' || typeof body.expectedRemote !== 'string') {
    throw new Error('请重新打开备份地址设置后重试。');
  }
  const remote = body.remote.trim();
  const parsed = remote ? parseSyncRemote(remote) : null;
  if (remote && !parsed) throw new Error('请输入 GitHub 私有仓库的 HTTPS 或 SSH 地址，不要包含访问令牌。');
  const patch = remote ? { remote, autoRepo: false } : { remote: '', autoRepo: true, repoOwner: '', repoName: 'dsh-sync' };
  const checkCurrent = () => {
    const current = engine.loadConfig();
    if (current.configError) throw new Error(current.configError);
    if (engine.inFlight || engine.progress?.running) throw new Error('同步正在进行，请完成后再保存设置。');
    if ((current.remote || '') !== body.expectedRemote) throw new Error('备份地址已发生变化，请取消后重新打开设置。');
    for (const [key, value] of Object.entries(patch)) {
      if (engine.overrides?.[key] !== undefined && engine.overrides[key] !== value) throw new Error('备份地址受宿主配置限制，请先修改宿主配置。');
    }
  };
  checkCurrent();
  if (parsed) {
    const result = await engine.gh(['repo', 'view', parsed.fullName, '--json', 'visibility,viewerPermission']);
    if (!engine.ok(result)) throw new Error(engine.githubRequestError(result));
    let info;
    try { info = JSON.parse(result.out); } catch { /* fail closed */ }
    if (!info || !['PRIVATE', 'PUBLIC', 'INTERNAL'].includes(info.visibility) || typeof info.viewerPermission !== 'string') {
      throw new Error('无法确认仓库信息，请稍后重试。原备份地址未更改。');
    }
    if (info.visibility !== 'PRIVATE') throw new Error('该仓库不是私有仓库，请先在 GitHub 创建或选择私有仓库。');
    if (!['WRITE', 'MAINTAIN', 'ADMIN'].includes(info.viewerPermission)) throw new Error('当前 GitHub 账号没有该仓库的写入权限，请更换仓库或调整权限。');
  }
  // Recheck after the network request and serialize against sync and other destination changes.
  const release = engine.acquireProcessLock();
  if (!release) throw new Error('同步正在进行，请完成后再保存设置。');
  try {
    checkCurrent();
    writeSyncConfig(engine.configPath(), patch);
    const c = engine.loadConfig();
    return {
      config: { remote: c.remote || '', branch: c.branch, autoRepo: c.autoRepo !== false },
      hint: remote ? '已验证并保存备份仓库。' : '已使用默认备份；首次同步时自动创建或复用 dsh-sync 私有仓库。',
    };
  } finally { release(); }
}
