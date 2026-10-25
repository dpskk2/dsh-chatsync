import fs from 'node:fs';
import path from 'node:path';
import { safePath, currentFile, digest, atomicJson, LOCAL_DATA } from './recovery.js';
import { canonicalWorkspacePath } from './workspace-target.js';

const hash = bytes => bytes === null ? null : digest(bytes);
function readState(file) {
  try { const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value;
  } catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('项目同步记录损坏，已停止以保留本机文件'); }
}
function projectFiles(root, extra, prefix = '', files = []) {
  for (const item of fs.readdirSync(prefix ? safePath(root, prefix) : root, { withFileTypes: true })) {
    const name = prefix ? prefix + '/' + item.name : item.name;
    if (item.name.toLowerCase() === '.git' || item.name.endsWith('.chatsync-backups') || item.isSymbolicLink()) continue;
    if (item.isDirectory()) {
      if (item.name === 'node_modules' || extra.includes(item.name) || fs.existsSync(path.join(root, name, '.git'))) continue;
      projectFiles(root, extra, name, files);
    } else if (item.isFile()) files.push(name);
  }
  return files;
}
async function ignored(engine, gitdir, root, files) {
  if (!files.length) return new Set();
  const r = await engine.gitInput(['--git-dir=' + gitdir, '--work-tree=' + root, 'check-ignore', '--no-index', '-z', '--stdin'], files.join('\0') + '\0');
  if (r.code !== 0 && r.code !== 1) throw new Error('无法完整读取项目忽略规则');
  return new Set(r.out.split('\0').filter(Boolean));
}

// An atomic move retains the latest path contents before replacing anything.
// An editor that creates a new destination during the move/link window wins;
// the old inode and the intended incoming bytes remain in local recovery.
export function applyProjectFile(engine, ws, root, name, expected, incoming) {
  const target = safePath(root, name), before = currentFile(target);
  if (hash(before) !== expected) return false;
  const record = engine.recovery.save({ kind: 'restore-backup', status: 'prepared', workspaceId: ws.id,
    path: name, reason: 'project-import' }, { local: before, remote: incoming });
  const dir = path.dirname(engine.recovery.recordPath(record.id));
  // Keep the retained inode on the project's filesystem, including D:/E: drives.
  const vault = root.replace(/[\\/]+$/, '') + '.chatsync-backups';
  // Never follow a sibling symlink or reuse an unrelated directory.
  const owner = JSON.stringify({ format: 1, project: path.resolve(root) });
  if (!fs.existsSync(vault)) {
    fs.mkdirSync(vault);
    fs.writeFileSync(path.join(vault, 'owner.json'), owner, { flag: 'wx', flush: true });
  }
  if (fs.lstatSync(vault).isSymbolicLink() || !fs.lstatSync(vault).isDirectory()
    || fs.lstatSync(path.join(vault, 'owner.json')).isSymbolicLink()
    || fs.readFileSync(path.join(vault, 'owner.json'), 'utf8') !== owner)
    throw new Error('项目备份目录已被占用或不可信，已停止以保留原件');
  const retainedDir = path.join(vault, record.id); fs.mkdirSync(retainedDir);
  const moved = path.join(retainedDir, 'latest-original'), temp = path.join(retainedDir, 'incoming-file');
  engine.recovery.finish(record.id, { retainedOriginal: moved });
  const probe = path.join(path.dirname(target), '.chatsync-link-probe-' + record.id);
  let retained = false;
  try {
    // Check exclusive installation on the actual destination filesystem before
    // moving the original (FAT/exFAT and some network drives lack hard links).
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temp, incoming ?? Buffer.alloc(0), { flag: 'wx', flush: true });
    fs.linkSync(temp, probe); fs.unlinkSync(probe);
    if (before !== null) {
      fs.renameSync(target, moved); retained = true;
      const latest = fs.readFileSync(moved);
      if (hash(latest) !== expected) {
        // Keep a checked copy as well as the retained inode (an old open editor
        // handle may still write to that inode). Never overwrite a new path.
        fs.writeFileSync(path.join(dir, 'local.bin'), latest, { flush: true });
        engine.recovery.finish(record.id, { status: 'restored', versions: { ...record.versions,
          local: { bytes: latest.length, sha256: digest(latest) } }, retainedOriginal: moved });
        try { fs.linkSync(moved, target); } catch (e) { if (e.code !== 'EEXIST') throw e; }
        return false;
      }
    }
    if (incoming !== null) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // link is exclusive: an independent save cannot be silently replaced.
      fs.linkSync(temp, target);
      if (!fs.readFileSync(target).equals(incoming)) throw new Error('项目写入后读回不一致');
    }
    engine.recovery.finish(record.id, { status: 'restored', ...(retained ? { retainedOriginal: moved } : {}) });
    return true;
  } catch (error) {
    if (retained) { try { fs.linkSync(moved, target); } catch {} }
    engine.recovery.finish(record.id, { status: 'restored', retainedOriginal: retained ? moved : null,
      applicationWarning: error.message });
    if (['EEXIST', 'ENOENT'].includes(error.code)) return false;
    throw error;
  } finally {
    if (fs.existsSync(probe)) fs.unlinkSync(probe);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export async function syncProject(engine, ws, cfg, reason, opts) {
  const root = engine.workspaceRealPathOf(ws, cfg);
  if (!root) return { id: ws.id, error: 'no-path' };
  const real = canonicalWorkspacePath(root), home = canonicalWorkspacePath(engine.home);
  const contains = (parent, child) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
  if (contains(home, real) || contains(real, home))
    return { id: ws.id, error: '工作区目录与 DSH 数据目录重叠，已停止以保留主仓库保护。', path: root };
  fs.mkdirSync(root, { recursive: true });
  recoverProjectApplications(engine, ws, root);
  const key = digest(Buffer.from(JSON.stringify([ws.id, cfg.remote, cfg.workspaceBranchPrefix]))).slice(0, 24);
  const base = safePath(engine.home, LOCAL_DATA + '/project-views/' + key);
  const tree = path.join(base, 'tree'), stateFile = path.join(base, 'files.json');
  const first = !fs.existsSync(stateFile); fs.mkdirSync(tree, { recursive: true });
  const gitdir = engine.workspaceGitDir(ws.id);
  (engine._projectRoots ||= new Map()).set(gitdir, root);
  await engine.ensureWorkspaceMirror(ws.id, tree, cfg);
  // A process can have died midway through a merge. Only this isolated tree is
  // rolled back; no abort/reset/checkout is ever allowed on the user's project.
  if (fs.existsSync(path.join(gitdir, 'MERGE_HEAD'))) {
    const abort = await engine.gitW(gitdir, tree, ['merge', '--abort']);
    if (!engine.ok(abort)) throw new Error('上次项目合并未完成，已保留隔离副本，请检查影子仓库');
  }
  const migrated = {};
  if (first && await engine.rev('HEAD', gitdir, tree)) {
    const index = await engine.gitW(gitdir, tree, ['read-tree', 'HEAD']);
    const seed = engine.ok(index) && await engine.gitW(gitdir, tree, ['checkout-index', '-a', '-f']);
    if (!seed || !engine.ok(seed)) throw new Error('无法建立项目隔离副本');
    const tracked = await engine.gitW(gitdir, tree, ['ls-files', '-z']);
    if (!engine.ok(tracked)) throw new Error('无法核对旧版项目快照');
    for (const name of tracked.out.split('\0').filter(Boolean)) migrated[name] = hash(currentFile(safePath(tree, name)));
  }
  const prior = readState(stateFile), initial = {}, exported = { ...(prior.exported || {}) };
  if (first && !prior.applied) prior.applied = migrated;
  const candidates = projectFiles(root, cfg.workspaceExtraIgnore || []);
  const excluded = await ignored(engine, gitdir, root, candidates);
  const files = candidates.filter(file => !excluded.has(file));
  const present = new Set(files);
  for (const file of files) {
    engine.throwIfCancelled();
    const bytes = fs.readFileSync(safePath(root, file)); initial[file] = digest(bytes);
    const dest = safePath(tree, file);
    currentFile(dest); // Refuses a directory or link at the target before it is overwritten.
    if (initial[file] === prior.applied?.[file] || initial[file] === exported[file]) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes);
    exported[file] = initial[file];
  }
  for (const file of new Set([...Object.keys(prior.applied || {}), ...Object.keys(exported)])) {
    if (present.has(file)) continue;
    // An ignored file (or nested repository) is not a local deletion request.
    if (fs.existsSync(safePath(root, file))) continue;
    const dest = safePath(tree, file); if (fs.existsSync(dest)) fs.unlinkSync(dest);
    initial[file] = null; exported[file] = null;
  }
  atomicJson(stateFile, { ...prior, exported });
  let result;
  try { result = await engine.syncWorkspaceTree(ws, cfg, reason, opts, tree); }
  finally {
    if (engine._syncControl?.cancelled && fs.existsSync(path.join(gitdir, 'MERGE_HEAD')))
      await engine.gitW(gitdir, tree, ['merge', '--abort']);
  }
  result.path = root;
  if (result.error) return result;
  const listing = await engine.gitW(gitdir, tree, ['ls-files', '-z']);
  if (!engine.ok(listing)) throw new Error('无法核对项目取回内容');
  const incoming = listing.out.split('\0').filter(Boolean);
  const ignoredIncoming = await ignored(engine, gitdir, root, incoming);
  const next = { ...(prior.applied || {}) }, pending = [];
  for (const file of new Set([...incoming, ...Object.keys(prior.applied || {})])) {
    engine.throwIfCancelled();
    if (excluded.has(file) || ignoredIncoming.has(file)) continue;
    const before = currentFile(safePath(root, file));
    const after = incoming.includes(file) ? currentFile(safePath(tree, file)) : null;
    if (hash(before) === hash(after)) { next[file] = hash(before); continue; }
    if (opts.uploadOnly) { pending.push(file); continue; }
    if (hash(before) !== (initial[file] ?? null) || !applyProjectFile(engine, ws, root, file, initial[file] ?? null, after)) {
      pending.push(file); continue;
    }
    next[file] = hash(after);
  }
  atomicJson(stateFile, { applied: next, exported });
  if (pending.length) return { ...result, error: '项目中有同步期间的新修改或待取回内容，已保留本机文件；请再次同步。', pendingFiles: pending };
  return result;
}

// Recover an interrupted move before reading deletions or creating any commit.
export function recoverProjectApplications(engine, ws, root) {
  let recovered = 0;
  for (const record of engine.recovery.list()) {
    if (record.workspaceId !== ws.id || record.reason !== 'project-import' || record.status !== 'prepared') continue;
    const vault = root.replace(/[\\/]+$/, '') + '.chatsync-backups';
    const moved = fs.existsSync(vault) ? safePath(vault, record.id + '/latest-original') : path.join(vault, record.id, 'latest-original');
    const target = safePath(root, record.path);
    if (fs.existsSync(moved)) {
      const latest = fs.readFileSync(moved), dir = path.dirname(engine.recovery.recordPath(record.id));
      fs.writeFileSync(path.join(dir, 'local.bin'), latest, { flush: true });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (!fs.existsSync(target)) { try { fs.linkSync(moved, target); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
      engine.recovery.finish(record.id, { status: 'restored', retainedOriginal: moved,
        versions: { ...record.versions, local: { bytes: latest.length, sha256: digest(latest) } },
        applicationWarning: '上次项目应用中断，已保留最近原件，请核对后重试。' });
    } else engine.recovery.finish(record.id, { status: 'restored', applicationWarning: '上次项目应用未完成，原件备份保留。' });
    recovered++;
  }
  if (recovered) throw new Error('上次项目应用中断，已找回或保留本机文件；请检查项目和恢复记录后再次同步。');
}
