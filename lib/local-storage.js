import hostFs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { LOCAL_DATA, safePath, digest, atomicJson, recoveryCategory } from './recovery.js';
import { scopeMirrorPath } from './scope.js';

// These are physical backup trees, including opaque archive files. Electron's
// virtual ASAR view must not turn an archive into a traversable directory.
const fs = process.versions.electron ? createRequire(import.meta.url)('original-fs') : hostFs;

const location = (engine, name) => safePath(engine.home, LOCAL_DATA + (name ? '/' + name : ''));
const childLocation = (engine, prefix, leaf) => path.join(location(engine, prefix), leaf);
const policies = new Set([0, 7, 30, 90, 180, 365]);
const notes = {
  recovery: ['恢复与冲突备份', '可找回记录中的文件版本；会话附件仍需另外保留。'],
  seeds: ['会话应用种子', '用于接续会话写入；仍在应用的种子不能清理。'],
  config: ['同步配置历史', '可找回此前保存的同步连接和偏好。'],
  repair: ['修复原件与预览', '用于核对、撤销或继续修复。'],
  repositories: ['同步仓库与历史', '保存历次会话、附件或项目快照；当前仓库历史单独管理。'],
  projects: ['项目旁原件备份', '替换项目文件前保留的原件；可能与其他备份使用硬链接。'],
  other: ['其他本地材料', '未确认用途或仍被依赖的材料保留原位。'],
};

function read(file, fallback) {
  try {
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 16 * 1024 * 1024) throw new Error('元数据不可读取');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
function children(root) {
  try { if (fs.lstatSync(root).isSymbolicLink()) throw new Error('不遍历目录链接'); return fs.readdirSync(root).sort(); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
function fileHash(file) {
  const hash = createHash('sha256'), fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(1024 * 1024);
  try { for (let count; (count = fs.readSync(fd, buffer, 0, buffer.length, null));) hash.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
// Never follow directory junctions. A bounded, incomplete scan cannot authorize deletion.
function inspect(root, content = false) {
  let bytes = 0, allocatedBytes = 0, files = 0, newest = 0, linked = false;
  const hash = createHash('sha256');
  const walk = (file, relative) => {
    if (++files > 200000) throw new Error('文件过多，请分项检查');
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink()) throw new Error('含符号链接或目录联接，保留原位');
    newest = Math.max(newest, st.mtimeMs);
    hash.update(JSON.stringify([relative, st.size, st.mtimeMs, st.dev, st.ino]));
    if (st.isDirectory()) for (const child of fs.readdirSync(file).sort()) walk(path.join(file, child), relative + '/' + child);
    else if (st.isFile()) {
      bytes += st.size;
      if (st.nlink > 1) linked = true;
      else allocatedBytes += st.size;
      if (content) hash.update(fileHash(file));
    } else throw new Error('含特殊文件，保留原位');
  };
  walk(root, '');
  return { bytes, allocatedBytes, files, newest, linked, fingerprint: hash.digest('hex') };
}
function removeTree(root, progress) {
  const st = fs.lstatSync(root);
  if (st.isSymbolicLink()) throw new Error('清理期间出现目录链接，已停止');
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(root)) removeTree(path.join(root, name), progress);
    fs.rmdirSync(root);
  } else if (st.isFile()) {
    // Direct unlink handles Windows readonly Git objects without changing the
    // permissions of their other hardlinks. Electron's recursive rm does not.
    fs.unlinkSync(root); progress.bytes += st.size;
  } else throw new Error('清理期间出现特殊文件，已停止');
}
export function storagePolicy(engine) {
  const value = read(location(engine, 'storage-policy.json'), { retentionDays: 30 });
  if (!value || !policies.has(value.retentionDays)) throw new Error('保留时间配置损坏，请重新保存');
  return value;
}
export function saveStoragePolicy(engine, { retentionDays } = {}) {
  if (!policies.has(retentionDays)) throw new Error('请选择有效的保留时间');
  const root = location(engine, 'storage-policy.json'); fs.mkdirSync(path.dirname(root), { recursive: true });
  atomicJson(root, { retentionDays });
  return { ok: true, policy: { retentionDays } };
}
// Inventory awaits Git. Track the control files separately so a preference,
// queue or dependency changed by another request during that await invalidates it.
function dependencyFingerprint(engine) {
  const hash = createHash('sha256');
  const include = file => {
    hash.update(file);
    try {
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error('处理记录含目录链接');
      hash.update(fileHash(file));
    } catch (error) { if (error.code !== 'ENOENT') throw error; hash.update('missing'); }
  };
  for (const file of ['dsh-sync.json', 'storages/workspace.json', 'storages/workspace-local-paths.json']) include(safePath(engine.home, file));
  for (const file of ['storage-policy.json', 'session-applications.json', 'data-repair/queue.json', 'data-repair/verification.json']) include(location(engine, file));
  for (const prefix of ['recovery', 'data-forks', 'branch-preservations', 'data-repair/plans', 'session-repair/plans', 'workspace-history-plans']) {
    const names = children(location(engine, prefix)); hash.update(JSON.stringify([prefix, names]));
    for (const name of names) {
      const relative = prefix + '/' + name + (prefix === 'recovery' ? '/record.json' : '');
      include(location(engine, relative));
    }
  }
  return hash.digest('hex');
}
// Pending or referenced processing records protect the materials they name.
function trackedRecords(engine, now, state, metadata) {
  const pending = new Set(), referenced = new Set();
  const journal = metadata('session-applications.json', {});
  if (!journal || Array.isArray(journal) || typeof journal !== 'object') state.uncertain = true;
  for (const value of Object.values(journal || {})) if (typeof value?.source === 'string') pending.add(value.source);
  else state.uncertain = true;
  const queue = metadata('data-repair/queue.json', []), verification = metadata('data-repair/verification.json', []);
  if (!Array.isArray(queue) || !Array.isArray(verification)) state.uncertain = true;
  for (const id of [...(Array.isArray(queue) ? queue : []), ...(Array.isArray(verification) ? verification : [])]) {
    if (typeof id === 'string') pending.add(id); else state.uncertain = true;
  }
  const records = new Map();
  for (const id of children(location(engine, 'recovery'))) {
    try {
      const record = engine.recovery.read(id); records.set(id, record);
      for (const key of ['sourceId', 'undoes']) if (record[key]) referenced.add(record[key]);
      if (Object.values(record.imports || {}).some(v => v.status !== 'verified')) pending.add(id);
    } catch { state.uncertain = true; }
  }
  const collectReferences = value => {
    if (typeof value === 'string' && records.has(value)) referenced.add(value);
    else if (value && typeof value === 'object') for (const child of Object.values(value)) collectReferences(child);
  };
  for (const prefix of ['data-forks', 'branch-preservations']) for (const name of children(location(engine, prefix))) {
    collectReferences(metadata(prefix + '/' + name, null));
  }
  for (const prefix of ['data-repair/plans', 'session-repair/plans', 'workspace-history-plans']) {
    for (const file of children(location(engine, prefix))) {
      const plan = metadata(prefix + '/' + file, null);
      if (!plan) { state.uncertain = true; continue; }
      const active = pending.has(plan.id) || !Number.isFinite(plan.expiresAt) || plan.expiresAt > now;
      if (active) {
        pending.add(plan.id || file);
        if (plan.recoveryId) referenced.add(plan.recoveryId);
        for (const f of plan.files || []) if (f.backupId) referenced.add(f.backupId);
      }
    }
  }
  return { pending, referenced, records };
}
  // Every active project view is protected even if it is momentarily clean.
async function addRepositoryItems(engine, cfg, state, warnings, add) {
  const active = new Set([path.dirname(scopeMirrorPath(engine.home, cfg))]);
  let workspaces = [];
  try { workspaces = engine.workspaces(); } catch { state.uncertain = true; warnings.push('项目登记不可读取，项目备份暂保留'); }
  for (const ws of workspaces) {
    const key = digest(Buffer.from(JSON.stringify([ws.id, cfg.remote, cfg.workspaceBranchPrefix]))).slice(0, 24);
    active.add(location(engine, 'project-views/' + key));
  }
  for (const prefix of ['main-views', 'project-views']) for (const key of children(location(engine, prefix))) {
    const root = childLocation(engine, prefix, key), tree = path.join(root, 'tree');
    let reason = active.has(root) ? '当前同步仓库，保留工作副本与 Git 历史' : prefix === 'project-views' ? '项目工作副本与共享 Git 历史关联，请保留' : '';
    // Local-only commits and dirty files may be the only copy. Do not discard them.
    if (!reason) {
      try {
        inspect(root);
        const gitdir = path.join(root, prefix === 'main-views' ? 'tree/.git' : 'repo.git');
        const status = await engine.gitW(gitdir, tree, ['--no-optional-locks', 'status', '--porcelain']);
        const ahead = await engine.gitW(gitdir, tree, ['rev-list', '--branches', '--tags', 'HEAD', '--not', '--remotes']);
        if (!engine.ok(status) || !engine.ok(ahead) || status.out.trim() || ahead.out.trim()) reason = '有未上传、未提交或无法核对的独有内容';
      } catch { reason = '仓库状态不可核对，保留原位'; }
    }
    add('repositories', root, reason, { separateConfirmation: true });
  }
  add('repositories', path.join(engine.home, '.git'), '旧主仓库或当前主仓库的历史，普通备份清理不改写它');
  add('repositories', path.join(engine.home, 'workspace-repos'), '旧项目仓库可能含独有历史，请单独迁移核对');
  return workspaces;
}
  // Only inspect the exact vault generated by project-sync and verify its owner.
function addProjectBackups(engine, cfg, workspaces, { records, pending, referenced }, add) {
  for (const ws of workspaces) {
    let project;
    try { project = engine.workspaceRealPathOf(ws, cfg); } catch { project = null; }
    if (typeof project !== 'string') continue;
    const root = project.replace(/[\\/]+$/, '') + '.chatsync-backups';
    if (!fs.existsSync(root)) continue;
    try {
      // Validate every component of the external path, not only its last segment.
      const absolute = path.resolve(root), drive = path.parse(absolute).root;
      safePath(drive, path.relative(drive, absolute).split(path.sep).join('/'));
      const owner = read(path.join(root, 'owner.json'), null);
      if (owner?.format !== 1 || owner.project !== path.resolve(project)) throw new Error('项目备份归属不符');
      for (const id of children(root).filter(n => n !== 'owner.json')) {
        const record = records.get(id);
        const reason = !record || record.status !== 'restored' || record.applicationWarning || recoveryCategory(record) !== 'history' || pending.has(id) || referenced.has(id)
          ? '项目原件尚未完成处理或缺少记录' : '';
        add('projects', safePath(root, id), reason, { separateConfirmation: true });
      }
    } catch (error) { add('projects', root, error.message); }
  }
}
async function inventory(engine, now = Date.now()) {
  const dependencyBefore = dependencyFingerprint(engine);
  const cfg = engine.loadConfig(), policy = storagePolicy(engine), items = [], warnings = [];
  const state = { uncertain: false };
  const metadata = (name, fallback) => {
    try { return read(location(engine, name), fallback); }
    catch { state.uncertain = true; warnings.push('无法核对 ' + name + '，相关材料暂不清理'); return fallback; }
  };
  const tracked = trackedRecords(engine, now, state, metadata);
  const { pending, referenced, records } = tracked;
  const add = (category, root, reason = '', extra = {}) => {
    if (!fs.existsSync(root)) return;
    const id = digest(Buffer.from(path.resolve(root))).slice(0, 32);
    let info = { bytes: 0, allocatedBytes: 0, files: 0, newest: 0, fingerprint: null };
    try {
      const absolute = path.resolve(root), drive = path.parse(absolute).root;
      safePath(drive, path.relative(drive, absolute).split(path.sep).join('/'));
      info = inspect(root);
    }
    catch (error) { reason = error.message; }
    if (!reason && state.uncertain) reason = '存在无法核对的处理记录，暂保留';
    if (!reason && policy.retentionDays > 0 && now - info.newest < policy.retentionDays * 86400000) reason = '仍在所选保留时间内';
    items.push({ id, category, path: root, name: path.basename(root), ...info, protected: Boolean(reason), reason, ...extra });
  };
  for (const id of children(location(engine, 'recovery'))) {
    const record = records.get(id);
    let reason = !record ? '记录损坏或不完整' : '';
    if (record && (!['merged', 'applied', 'repaired', 'restored'].includes(record.status) || recoveryCategory(record) !== 'history')) reason = '仍待处理或核对，请先到恢复页完成';
    if (pending.has(id) || referenced.has(id)) reason = '被未完成处理或其他恢复记录引用';
    add('recovery', childLocation(engine, 'recovery', id), reason, { recordId: id });
  }
  for (const file of children(location(engine, 'session-applications'))) {
    const relative = LOCAL_DATA + '/session-applications/' + file;
    add('seeds', childLocation(engine, 'session-applications', file), pending.has(relative) ? '会话正在应用，仍需此种子' : '');
  }
  for (const file of children(location(engine, 'config-history'))) add('config', childLocation(engine, 'config-history', file));
  for (const prefix of ['data-repair/plans', 'session-repair/plans', 'workspace-history-plans', 'data-repair/archived']) {
    for (const file of children(location(engine, prefix))) {
      const id = file.replace(/\.json$/, '');
      add('repair', childLocation(engine, prefix, file), pending.has(id) ? '修复、预览或结果核对尚未完成' : '');
    }
  }
  const workspaces = await addRepositoryItems(engine, cfg, state, warnings, add);
  addProjectBackups(engine, cfg, workspaces, tracked, add);
  const handled = new Set(['recovery', 'session-applications', 'config-history', 'data-repair', 'session-repair',
    'workspace-history-plans', 'main-views', 'project-views']);
  for (const name of children(location(engine, ''))) if (!handled.has(name)) add('other', childLocation(engine, '', name), '运行状态、处理记录或未知材料，保留原位');
  for (const name of ['backup', 'patches']) add('other', path.join(engine.home, name), '手工备份或补丁原件，需单独确认用途');
  if (state.uncertain) for (const item of items) if (!item.protected) { item.protected = true; item.reason = '存在无法核对的处理记录，暂保留'; }
  if (dependencyFingerprint(engine) !== dependencyBefore) throw new Error('检查期间配置或处理记录发生变化，请重新查看');
  return { ok: true, policy, warnings, items,
    categories: Object.entries(notes).map(([id, [title, purpose]]) => ({ id, title, purpose,
      bytes: items.filter(i => i.category === id).reduce((sum, i) => sum + i.bytes, 0) })),
    totalBytes: items.reduce((sum, i) => sum + i.bytes, 0),
    note: '显示逻辑字节；硬链接、压缩与文件系统分配会影响实际释放空间。当前 Git 历史不会被截短；云端仍保留的内容可能再次下载。' };
}

export async function scanLocalStorage(engine) {
  if (engine.inFlight) throw new Error('同步进行中，请完成后查看');
  const release = engine.acquireProcessLock(); if (!release) throw new Error('另一同步或恢复进程正在运行');
  try { return await inventory(engine); } finally { release(); }
}
export async function previewStorageCleanup(engine, { ids } = {}) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || new Set(ids).size !== ids.length) throw new Error('请选择要清理的材料');
  const scan = await scanLocalStorage(engine), selected = ids.map(id => scan.items.find(i => i.id === id));
  if (selected.some(item => !item || item.protected)) throw new Error('所选材料仍受保护或已变化，请重新查看');
  for (const item of selected) Object.assign(item, inspect(item.path, true));
  const token = randomUUID(), preview = { token, items: selected, createdAt: Date.now(), expiresAt: Date.now() + 600000,
    bytes: selected.reduce((sum, item) => sum + item.bytes, 0), separateConfirmation: selected.some(i => i.separateConfirmation),
    warning: '将永久清理所选本地恢复来源，不能撤销。不会删除当前会话、附件、项目文件或云端历史。' };
  const pending = engine._storageCleanupPreviews ||= new Map();
  if (pending.size >= 5) pending.delete(pending.keys().next().value);
  pending.set(token, preview);
  return { ok: true, ...preview };
}
export async function applyStorageCleanup(engine, { token, confirm, confirmSeparate } = {}) {
  const preview = engine._storageCleanupPreviews?.get(token);
  if (!preview || preview.expiresAt < Date.now() || confirm !== true) throw new Error('清理预览已过期或尚未确认，请重新预览');
  if (preview.separateConfirmation && confirmSeparate !== true) throw new Error('旧同步仓库和项目旁备份需要单独确认');
  if (engine.inFlight) throw new Error('同步进行中，请完成后清理');
  const release = engine.acquireProcessLock(); if (!release) throw new Error('另一同步或恢复进程正在运行');
  try {
    const current = await inventory(engine), results = [];
    // Recheck the entire selection before deleting anything.
    for (const item of preview.items) {
      const live = current.items.find(i => i.id === item.id);
      if (!live || live.protected || inspect(live.path, true).fingerprint !== item.fingerprint) throw new Error('预览后材料或依赖已变化，未清理，请重新查看');
    }
    engine._storageCleanupPreviews.delete(token);
    for (const item of preview.items) {
      // Same-volume rename keeps the selected tree fixed and avoids recursively
      // deleting a pathname that an external writer could replace after preview.
      const staged = item.path + '.chatsync-cleaning-' + randomUUID();
      const progress = { bytes: 0 };
      try {
        fs.renameSync(item.path, staged);
        if (inspect(staged, true).fingerprint !== item.fingerprint) {
          if (!fs.existsSync(item.path)) fs.renameSync(staged, item.path);
          throw new Error('材料发生变化，保留原件');
        }
        removeTree(staged, progress);
        results.push({ id: item.id, name: item.name, path: item.path, ok: true, removedBytes: item.bytes, exclusiveBytes: item.allocatedBytes, sharedLinks: item.linked });
      } catch (error) {
        if (fs.existsSync(staged) && !fs.existsSync(item.path)) { try { fs.renameSync(staged, item.path); } catch {} }
        results.push({ id: item.id, name: item.name, path: item.path, ok: false, removedBytes: progress.bytes,
          error: (progress.bytes ? '部分内容已清理，尚存材料保留；' : '') + error.message, retainedPath: fs.existsSync(staged) ? staged : item.path });
      }
    }
    return { ok: results.every(r => r.ok), results, removedBytes: results.reduce((sum, r) => sum + (r.removedBytes || 0), 0),
      hint: '逐项清理结果已核对；移除字节为逻辑大小，实际磁盘释放受硬链接和文件系统影响。' };
  } finally { release(); }
}
