// Re-parent only the current, checked snapshot. Old commits remain reachable
// through a local backup ref; the remote is never reset or force-pushed.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { LOCAL_DATA, safePath, atomicJson } from './recovery.js';
import { scanOutgoing } from './privacy.js';

async function context(engine, workspaceId) {
  if (engine.inFlight) throw new Error('同步正在进行，请完成后重试');
  const cfg = engine.loadConfig(), ws = engine.workspaces().find(ws => ws.id === workspaceId);
  if (!ws || !cfg.remote || !cfg.workspaceSync) throw new Error('请先连接仓库并开启此项目的文件同步');
  const dir = engine.workspaceGitDir(ws.id);
  if (!fs.existsSync(dir)) throw new Error('尚无项目同步副本');
  const result = await engine.git(['--git-dir=' + dir, 'config', '--get', 'core.worktree']);
  if (!engine.ok(result)) throw new Error('无法读取项目同步副本');
  const tree = result.out.trim();
  // Older releases used the real project as the Git worktree. Require a normal
  // 0.20.2 sync attempt first, so even diagnostic Git runs stay isolated.
  const views = safePath(engine.home, LOCAL_DATA + '/project-views');
  if (!tree.startsWith(views + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('请先运行一次新版同步，再处理旧项目历史');
  const branch = engine.workspaceBranchOf(cfg, ws.id), head = await engine.rev('HEAD', dir, tree);
  if (!head || fs.existsSync(dir + '/MERGE_HEAD')) throw new Error('项目快照缺失或合并尚未完成，请先重试同步');
  engine.applyProxyEnv(cfg);
  const verified = await engine.verifyPrivateRemote(cfg.remote);
  if (!verified.ok) throw new Error(verified.error || '无法验证私有远端');
  const probe = await engine.gitW(dir, tree, ['ls-remote', '--heads', cfg.remote, 'refs/heads/' + branch]);
  if (!engine.ok(probe)) throw new Error('无法核对远端项目状态，未修改本地历史');
  const remote = probe.out.trim().split(/\s+/)[0] || null;
  const known = await engine.rev('refs/remotes/origin/' + branch, dir, tree);
  if (remote !== known) throw new Error('远端项目已变化，请先运行同步，再重新预览');
  return { cfg, ws, dir, tree, branch, head, remote };
}
export async function previewWorkspaceHistory(engine, workspaceId) {
  const release = engine.acquireProcessLock();
  if (!release) throw new Error('另一进程正在同步，请稍后重试');
  try {
    const c = await context(engine, workspaceId);
    const old = await scanOutgoing(engine, c.head, c.dir, c.tree);
    if (!old.findings.length || old.findings.some(f => !f.reasons.every(r => r === '内容超过单文件扫描上限')))
      throw new Error('此入口仅处理旧项目历史中的超限文件；其他上传问题请按提示处理');
    const treeHash = await engine.rev(c.head + '^{tree}', c.dir, c.tree);
    const created = await engine.gitW(c.dir, c.tree, ['-c', 'user.name=' + c.cfg.gitUserName,
      '-c', 'user.email=' + c.cfg.gitUserEmail, 'commit-tree', treeHash,
      ...(c.remote ? ['-p', c.remote] : []), '-m', 'ChatSync: rebuild checked unpublished project snapshot']);
    if (!engine.ok(created)) throw new Error('无法准备独立快照，未修改历史');
    const candidate = created.out.trim(), report = await scanOutgoing(engine, candidate, c.dir, c.tree);
    if (report.findings.length) throw new Error('当前快照仍有超限或敏感内容；请先排除文件并重新同步，再处理旧历史');
    const id = randomUUID(), backup = 'chatsync-local-history/' + id;
    const plan = { id, workspaceId, head: c.head, remote: c.remote, candidate, branch: c.branch,
      remoteUrl: c.cfg.remote, treeHash, backup, createdAt: Date.now() };
    const folder = safePath(engine.home, LOCAL_DATA + '/workspace-history-plans'); fs.mkdirSync(folder, { recursive: true });
    atomicJson(safePath(folder, id + '.json'), plan);
    return { ok: true, previewId: id, workspaceId, backupBranch: backup,
      message: '将保留全部旧提交为本机备份，以相同文件快照重新建立待上传历史。项目文件和远端不变；完成后请再次同步。' };
  } finally { release(); }
}
export async function applyWorkspaceHistory(engine, previewId) {
  if (!/^[a-f0-9-]{36}$/.test(previewId || '')) throw new Error('请先预览旧项目历史');
  const release = engine.acquireProcessLock();
  if (!release) throw new Error('另一进程正在同步，请稍后重试');
  try {
    const file = safePath(engine.home, LOCAL_DATA + '/workspace-history-plans/' + previewId + '.json');
    const plan = JSON.parse(fs.readFileSync(file, 'utf8')), c = await context(engine, plan.workspaceId);
    if (plan.id !== previewId || plan.backup !== 'chatsync-local-history/' + previewId
      || !Number.isFinite(plan.createdAt) || plan.createdAt > Date.now()
      || !/^[a-f0-9]{40,64}$/.test(plan.candidate || '') || Date.now() - plan.createdAt > 10 * 60 * 1000
      || c.head !== plan.head || c.remote !== plan.remote || c.cfg.remote !== plan.remoteUrl || c.branch !== plan.branch
      || await engine.rev(plan.candidate + '^{tree}', c.dir, c.tree) !== plan.treeHash
      || await engine.rev(c.head + '^{tree}', c.dir, c.tree) !== plan.treeHash)
      throw new Error('快照或远端已变化，请重新预览；未修改历史');
    if ((await scanOutgoing(engine, plan.candidate, c.dir, c.tree)).findings.length) throw new Error('独立快照未通过上传检查');
    const input = ['start', `create refs/heads/${plan.backup} ${plan.head}`,
      `update refs/heads/${c.branch} ${plan.candidate} ${plan.head}`, 'prepare', 'commit', ''].join('\n');
    const changed = await engine.gitInput(['--git-dir=' + c.dir, '--work-tree=' + c.tree, 'update-ref', '--stdin'], input);
    if (!engine.ok(changed)) throw new Error('项目历史已变化或无法保留备份，未完成重建');
    engine._safeUploadHeads?.delete(c.dir);
    fs.unlinkSync(file);
    return { ok: true, backupBranch: plan.backup, previousHead: plan.head,
      message: '旧提交已保留为本机备份，项目文件和远端未变。请再次点击立即同步。' };
  } finally { release(); }
}
