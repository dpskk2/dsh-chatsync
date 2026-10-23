import { digest } from './recovery.js';

export async function reviewTransfer(engine, direction, target, branch, gitdir = null, root = engine.home) {
  // The selected repository and scope already authorize ordinary sync.
  // Keep optional legacy review support for isolated compatibility checks only.
  if (engine.requireTransferReview !== true) return null;
  if (branch.startsWith('backup/')) return null;
  const prefix = gitdir ? ['--git-dir=' + gitdir, '--work-tree=' + root] : [];
  // Callers pass the immutable commit already scanned / fetched. Resolve only
  // symbolic targets, and read the base needed for this direction. No branch
  // result is cached across previews or uploads.
  const local = direction === 'download' ? await engine.rev('HEAD', gitdir, root) : null;
  const before = direction === 'upload' ? await engine.rev('refs/remotes/origin/' + branch, gitdir, root) : local;
  const to = /^[a-f0-9]{40,64}$/.test(target) ? target : await engine.rev(target, gitdir, root);
  if (!to || to === before) return null;
  if (direction === 'download' && local && await engine.isAncestor(to, local, gitdir, root)) return null;
  let base = before;
  let common = null;
  if (direction === 'download' && local) {
    const found = await engine.git([...prefix, 'merge-base', local, to]);
    if (engine.ok(found)) common = found.out.trim();
    base = common;
  }
  if (!base) {
    const empty = await engine.gitInput([...prefix, 'hash-object', '-t', 'tree', '--stdin'], '');
    if (!engine.ok(empty)) throw new Error('无法读取同步前预览');
    base = empty.out.trim();
  }
  const diff = await engine.git([...prefix, 'diff', '--name-status', '-z', base, to, '--']);
  if (!engine.ok(diff)) throw new Error('无法生成同步前预览');
  const rows = diff.out.split('\0'), counts = { added: 0, modified: 0, deleted: 0 }, executable = [];
  for (let i = 0; i < rows.length; i++) {
    const code = rows[i]; if (!code) continue;
    let file = rows[++i];
    if (code.startsWith('R') || code.startsWith('C')) file = rows[++i];
    if (!file) throw new Error('同步前预览不完整');
    if (engine.reviewIncludes && !engine.reviewIncludes(file)) continue;
    if (code === 'D') counts.deleted++; else if (code === 'A') counts.added++; else counts.modified++;
    if (/^(?:settings\.yaml$|patches\/|profiles\/[^/]+\/(?:cordis(?:\.patch)?\.ya?ml|package\.json)$)/i.test(file)) executable.push(file);
  }
  const changed = counts.added + counts.modified + counts.deleted;
  if (!changed) return null;
  const reasons = [];
  if (!before || (direction === 'download' && !common)) reasons.push(direction === 'upload' ? '首次上传此范围' : '首次取回此范围');
  if (counts.deleted >= 10 || (counts.deleted >= 3 && counts.deleted / Math.max(changed, 1) >= 0.5)) reasons.push('删除较多');
  if (executable.length) reasons.push('设置或可执行配置变化');
  if (!reasons.length) return null;
  const payload = { direction, branch, before, to, remote: engine._verifiedPrivateRemote || engine.loadConfig().remote,
    scope: engine.reviewScope || engine.loadConfig().contentScope, counts, executable };
  return requireReview(engine, payload, reasons, counts, executable, gitdir ? '项目文件' : '会话与设置');
}

export function requireReview(engine, payload, reasons, counts, executable = [], label = '所选内容') {
  if (engine.requireTransferReview !== true) return null;
  const direction = payload.direction;
  const id = digest(Buffer.from(JSON.stringify(payload)));
  if (engine._approvedReviews?.has(id)) return null;
  if (engine._reviewApproval === id && engine._pendingReviews?.has(id)) {
    engine._approvedReviews.add(id); return null;
  }
  const summary = (direction === 'upload' ? '准备上传' : '准备取回') + label + '：新增 ' + counts.added
    + '，修改 ' + counts.modified + '，删除 ' + counts.deleted + '。\n需要确认：' + reasons.join('、')
    + (executable.length ? '\n设置或执行配置：' + executable.slice(0, 12).join('、') : '')
    + '\n确认只适用于这次提交与范围；内容变化后会重新预览。';
  const review = { id, direction, counts, reasons, executable, summary };
  engine._pendingReviews?.set(id, review);
  if (engine._pendingReviews?.size > 64) engine._pendingReviews.delete(engine._pendingReviews.keys().next().value);
  engine._reviewRequired = review;
  engine.onReviewRequired?.(review);
  return review;
}
