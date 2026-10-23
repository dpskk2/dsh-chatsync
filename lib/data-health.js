import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { zstdCompressSync } from 'node:zlib';
import { LOCAL_DATA, safePath, currentFile, atomicJson, digest } from './recovery.js';
import { parseSessionLog, validateSessionLog, completeZstdPrefix, decodeZstdFrames, ZSTD_MAGIC } from './merge.js';
import { sessionIdOfLogPath, sessionLogGeneration } from './session-path.js';
import { assertDshClosed } from './session-repair.js';
import { decodeRecoverySession } from './session-recovery.js';
import { transferCatalog } from './session-transfer.js';
import { readSyncConfig } from './config-file.js';
import { parseSyncRemote } from './remote.js';
import { scopeMirrorPath } from './scope.js';
import { readCachedSessionTitle } from './session-activity.js';
import { classifyGrouping } from './host-grouping.js';

const MAX = 256 * 1024 * 1024, REGISTRY = 'storages/workspace.json';
const norm = value => String(value || '').replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
const location = (engine, file) => safePath(engine.home, file);
function read(engine, file) {
  const target = location(engine, file);
  try { if (fs.statSync(target).size > MAX) throw new Error('文件超过 256 MiB，未读取'); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  return currentFile(target);
}
function physicalLogs(engine) {
  const logs = [];
  const root = location(engine, 'sessions');
  if (!fs.existsSync(root)) return logs;
  for (const group of fs.readdirSync(root, { withFileTypes: true })) {
    if (!group.isDirectory() || group.isSymbolicLink()) continue;
    for (const session of fs.readdirSync(location(engine, 'sessions/' + group.name), { withFileTypes: true })) {
      if (!session.isDirectory() || session.isSymbolicLink()) continue;
      const dir = 'sessions/' + group.name + '/' + session.name;
      for (const item of fs.readdirSync(location(engine, dir), { withFileTypes: true })) {
        const file = dir + '/' + item.name, id = sessionIdOfLogPath(file);
        if (id && item.isFile() && !item.isSymbolicLink()) logs.push({ file, id, version: sessionLogGeneration(file) });
      }
    }
  }
  return logs;
}
function registry(engine) {
  const bytes = read(engine, REGISTRY);
  if (!bytes) return { global: { workspaceIds: [], archivedSessionIds: [] }, tables: { workspaces: {} } };
  const value = JSON.parse(bytes.toString().replace(/^\uFEFF/, ''));
  if (!value?.tables?.workspaces || !value.global || Array.isArray(value.tables.workspaces)) throw new Error('项目登记表结构损坏');
  if (Object.values(value.tables.workspaces).some(w => !w || typeof w.path !== 'string' || !Array.isArray(w.sessionIds)
    || w.sessionIds.some(id => typeof id !== 'string'))) throw new Error('项目或会话登记格式损坏');
  return value;
}
export function scanDataHealth(engine) {
  const issues = [], groups = new Map();
  try { readSyncConfig(engine.configPath()); }
  catch { issues.push({ key: 'dsh-sync.json', kind: 'config', file: 'dsh-sync.json', message: '同步配置损坏，传输已暂停', action: '预览配置恢复' }); }
  for (const log of physicalLogs(engine)) {
    let rows;
    try { rows = parseSessionLog(read(engine, log.file)); } catch { /* report unreadable too */ }
    const valid = rows && rows[0].id === log.id;
    if (!valid) issues.push({ key: log.file, kind: 'log', sessionId: log.id, file: log.file,
      message: rows ? '会话身份与目录不一致' : '会话日志残缺、损坏或无法读取', action: '预览可恢复内容' });
    const items = groups.get(log.id) || []; items.push({ ...log, header: valid ? rows[0] : null }); groups.set(log.id, items);
  }
  let ws;
  try { ws = registry(engine); }
  catch { issues.push({ key: REGISTRY, kind: 'registry-file', file: REGISTRY, message: '项目登记表损坏', action: '从历史原件预览恢复' }); }
  if (ws && Object.values(ws.tables.workspaces).some(w => typeof w.title !== 'string' || typeof w.createdAt !== 'string' || typeof w.updatedAt !== 'string'))
    issues.push({ key: 'registry-metadata', kind: 'registry-normalize', file: REGISTRY, message: '项目登记缺少宿主要求的时间信息', action: '预览登记兼容修复' });
  const liveGrouping = engine.hostGroupingState();
  const grouping = liveGrouping.available ? liveGrouping : ws ? classifyGrouping(engine, ws) : {};
  const ungroupedIds = new Set(grouping.ungroupedIds || []);
  for (const [id, logs] of groups) {
    const version = Math.max(...logs.map(log => log.version)), active = logs.filter(log => log.version === version);
    if (active.length > 1) issues.push({ key: 'ambiguous:' + id, kind: 'ambiguous', sessionId: id,
      files: active.map(log => log.file), message: '同一会话存在多份当前日志', action: '选择保留版本并归档其他原件' });
    const header = active.length === 1 ? active[0].header : null;
    if (!ws || !header) continue;
    const assigned = Object.entries(ws.tables.workspaces).filter(([, w]) => w?.sessionIds?.includes(id));
    const archived = ws.global.archivedSessionIds?.includes(id);
    let cwdAvailable = false;
    try { cwdAvailable = typeof header.cwd === 'string' && path.isAbsolute(header.cwd) && fs.statSync(header.cwd).isDirectory(); } catch {}
    if (!archived && (assigned.length || ungroupedIds.has(id)) && typeof header.cwd === 'string' && !cwdAvailable) issues.push({ key: 'relocate:' + id, kind: 'relocate',
      sessionId: id, file: active[0].file, cwd: header.cwd, message: '聊天原来的项目文件夹在这台电脑上不可用', action: '选择本机项目，继续此会话' });
    const duplicates = assigned.length > 1 || assigned.some(([, w]) => w.sessionIds.filter(sid => sid === id).length > 1);
    if (duplicates || (header.cwd && (assigned.some(([, w]) => norm(w.path) !== norm(header.cwd))
      || (!archived && !assigned.length && ungroupedIds.has(id))))) {
      issues.push({ key: 'membership:' + id, kind: 'membership', sessionId: id, file: active[0].file,
        cwd: header.cwd, archived: Boolean(archived), currentProjects: assigned.map(([wid, w]) => ({ id: wid, title: w.title || w.path })),
        message: duplicates ? '会话重复登记' : assigned.length ? '项目归属与会话原始目录不一致' : '同步后会话失去项目归属',
        action: '预览归属修复' });
    }
  }
  if (ws) for (const [wid, w] of Object.entries(ws.tables.workspaces)) for (const id of new Set(w?.sessionIds || [])) {
    const saved = engine.recovery.list().find(record => sessionIdOfLogPath(record.path) === id);
    if (!groups.has(id)) issues.push({ key: 'missing:' + wid + ':' + id, kind: 'missing', sessionId: id, file: saved?.path,
      message: '项目有会话登记，但本机没有日志；可能尚未取回', action: '先同步，或选择历史原件恢复' });
  }
  const sessionRows = ids => [...groups].flatMap(([id, logs]) => {
    if (!ids.has(id)) return [];
    const version = Math.max(...logs.map(log => log.version)), active = logs.filter(log => log.version === version);
    if (active.length !== 1 || !active[0].header) return [];
    return [{ key: 'grouping:' + id, kind: 'grouping', sessionId: id, file: active[0].file, cwd: active[0].header.cwd,
      title: readCachedSessionTitle(engine.home, id) || '未命名会话', refreshOnly: grouping.refreshableIds?.includes(id) || false }];
  });
  const ungroupedSessions = sessionRows(ungroupedIds);
  return { issues: issues.map(issue => ({ ...issue, ...(issue.sessionId ? { title: readCachedSessionTitle(engine.home, issue.sessionId) || '未命名会话' } : {}) })),
    ungroupedSessions, ordinaryUngroupedSessions: sessionRows(new Set(grouping.ordinaryIds || [])),
    archivedUngroupedSessions: sessionRows(new Set(grouping.archivedIds || [])),
    checkedLogs: [...groups.values()].reduce((n, logs) => n + logs.length, 0),
    repairBackups: engine.recovery.list().filter(r => r.kind === 'data-repair' && r.status === 'repaired')
      .map(r => ({ id: r.id, file: r.path, createdAt: r.createdAt })),
    workspaces: ws ? Object.entries(ws.tables.workspaces).map(([id, w]) => ({ id, title: w.title || w.path, path: w.path,
      localPath: engine.workspaceRealPathOf({ id, ...w }, engine.loadConfig()) })) : [],
    queued: queuedDataRepairs(engine).length };
}
const verificationFile = engine => location(engine, LOCAL_DATA + '/data-repair/verification.json');
export function pendingDataVerification(engine) {
  try { const value = JSON.parse(fs.readFileSync(verificationFile(engine), 'utf8'));
    if (!Array.isArray(value)) throw new Error(); return value;
  } catch (e) { if (e.code === 'ENOENT') return []; throw new Error('修复验收记录损坏，同步已暂停'); }
}
export function acknowledgeDataRepairs(engine) {
  if (pendingDataVerification(engine).length) atomicJson(verificationFile(engine), []);
  return { verified: true, hint: '已记录你的检查结果，可以手动同步；下次启动恢复原有自动同步选择。' };
}

function prefixOf(buffer) {
  if (!buffer) return null;
  const text = buffer.subarray(0, 4).equals(ZSTD_MAGIC) ? completeZstdPrefix(buffer, MAX).text : buffer.toString('utf8');
  const lines = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { JSON.parse(line); lines.push(line); } catch { break; }
  }
  let bytes = Buffer.from(lines.join('\n') + '\n');
  const check = validateSessionLog(bytes);
  if (!check.ok && check.line) bytes = Buffer.from(lines.slice(0, check.line - 1).join('\n') + '\n');
  return parseSessionLog(bytes) ? bytes : null;
}
async function candidates(engine, file, sessionId, before) {
  const found = [], add = (bytes, source) => {
    if (!bytes || bytes.length > MAX || found.some(item => item.hash === digest(bytes))) return;
    try {
      if (sessionId) { const rows = parseSessionLog(bytes); if (!rows || rows[0].id !== sessionId) return; }
      else { const value = JSON.parse(bytes.toString().replace(/^\uFEFF/, ''));
        if (!value || typeof value !== 'object' || Array.isArray(value) || (file !== 'dsh-sync.json' && (!value.tables?.workspaces || !value.global))) return; }
      found.push({ bytes, hash: digest(bytes), source });
    } catch { /* A damaged historical candidate is never promoted. */ }
  };
  if (sessionId) {
    add(prefixOf(before), '本机最后一个连续、完整的事件前缀');
    for (const log of physicalLogs(engine).filter(log => log.id === sessionId)) add(read(engine, log.file), '本机日志 ' + log.file);
  }
  if (file === 'dsh-sync.json') {
    const history = location(engine, LOCAL_DATA + '/config-history');
    if (fs.existsSync(history)) for (const name of fs.readdirSync(history).filter(n => /^[a-f0-9]{64}\.json$/.test(n)).slice(0, 100))
      add(read(engine, LOCAL_DATA + '/config-history/' + name), '此前保存的配置 ' + name.slice(0, 12));
  }
  for (const record of engine.recovery.list().filter(r => r.path === file || (sessionId && sessionIdOfLogPath(r.path) === sessionId)).slice(0, 100)) {
    for (const side of ['local', 'remote']) { try { if (record.versions[side]?.bytes <= MAX) add(engine.recovery.version(record, side), '恢复备份 ' + record.id + '/' + side); } catch {} }
  }
  const homes = new Set([engine._transport?.home, scopeMirrorPath(engine.home, engine.loadConfig()), engine.home].filter(Boolean));
  for (const home of homes) {
    if (!fs.existsSync(path.join(home, '.git'))) continue;
    const prefix = ['--git-dir=' + path.join(home, '.git'), '--work-tree=' + home];
    const history = await engine.git([...prefix, 'log', '-30', '--format=%H', '--all', '--', file]);
    if (!engine.ok(history)) continue;
    for (const head of history.out.trim().split('\n').filter(h => /^[a-f0-9]{40,64}$/.test(h))) {
      const value = await engine.gitInput([...prefix, 'show', head + ':' + file], '', 60000, true, { maxOutputBytes: MAX });
      if (engine.ok(value)) add(value.out, 'Git 历史 ' + head);
    }
  }
  return found;
}
function planRoot(engine) { const dir = location(engine, LOCAL_DATA + '/data-repair/plans'); fs.mkdirSync(dir, { recursive: true }); return dir; }
export async function previewDataRepair(engine, { key, candidateHash, selectedFile, replacementConfig } = {}) {
  if (engine.inFlight) throw new Error('同步进行中，请完成后检查');
  const issue = scanDataHealth(engine).issues.find(item => item.key === key);
  if (!issue) throw new Error('问题已变化，请重新检查');
  const files = [], plan = { id: randomUUID(), key, kind: issue.kind, createdAt: Date.now(), expiresAt: Date.now() + 86400000, files };
  let options = [], warning = '';
  if (issue.kind === 'membership' || issue.kind === 'registry-normalize') {
    const ws = registry(engine), id = issue.sessionId;
    for (const w of Object.values(ws.tables.workspaces)) {
      if (typeof w.title !== 'string') w.title = path.basename(w.path.replaceAll('\\', '/'));
      if (typeof w.createdAt !== 'string') w.createdAt = new Date().toISOString();
      if (typeof w.updatedAt !== 'string') w.updatedAt = w.createdAt;
    }
    const target = Object.entries(ws.tables.workspaces).find(([, w]) => norm(w.path) === norm(issue.cwd));
    if (issue.kind === 'membership') for (const w of Object.values(ws.tables.workspaces)) if (Array.isArray(w.sessionIds)) w.sessionIds = w.sessionIds.filter(sid => sid !== id);
    if (issue.kind === 'membership') {
      const wid = target?.[0] || randomUUID();
      if (!target) { const now = new Date().toISOString(); ws.tables.workspaces[wid] = { path: issue.cwd, title: path.basename(issue.cwd.replaceAll('\\', '/')), sessionIds: [], createdAt: now, updatedAt: now };
        ws.global.workspaceIds = [...new Set([...(ws.global.workspaceIds || []), wid])]; }
      ws.tables.workspaces[wid].sessionIds.push(id);
    }
    files.push({ file: REGISTRY, before: read(engine, REGISTRY), after: Buffer.from(JSON.stringify(ws, null, 2) + '\n') });
    warning = issue.kind === 'membership' ? '将按会话原始目录修正登记，归档状态优先保留。若是你有意安排的分类，请取消。'
      : '将为缺少时间字段的旧项目补齐宿主要求的登记信息，保留全部会话关系，原登记完整备份。';
  } else if (issue.kind === 'ambiguous') {
    if (!issue.files.includes(selectedFile)) return { issue, choices: issue.files, warning: '请选择要保留的日志；其他日志将原样移入恢复备份，不混合事件。' };
    const selected = read(engine, selectedFile);
    if (!parseSessionLog(selected) || parseSessionLog(selected)[0].id !== issue.sessionId) throw new Error('所选日志损坏，请先恢复该日志');
    await decodeRecoverySession(selected, await (engine.loadTransferCatalog || transferCatalog)());
    plan.selectedFile = selectedFile; plan.selectedHash = digest(selected);
    for (const file of issue.files.filter(file => file !== selectedFile)) files.push({ file, before: read(engine, file), after: null });
    warning = '其他当前日志将归档到备份，保留所选日志；如两份都有新增，请先从冲突恢复建立独立会话。';
  } else if (issue.kind === 'config' && replacementConfig) {
    const remote = String(replacementConfig.remote || '').trim();
    if (remote && !parseSyncRemote(remote)) throw new Error('请填写不含凭据的 GitHub 仓库地址');
    const after = Buffer.from(JSON.stringify({ remote, branch: 'main', autoRepo: false, enabled: false, mode: 'manual' }, null, 2) + '\n');
    files.push({ file: 'dsh-sync.json', before: read(engine, 'dsh-sync.json'), after });
    warning = '将备份损坏配置并重建为手动连接；自动同步关闭、自动建仓关闭。重新打开后请核对内容范围。';
  } else if (['log', 'registry-file', 'missing', 'config'].includes(issue.kind) && issue.file) {
    const before = read(engine, issue.file), choices = await candidates(engine, issue.file, issue.sessionId, before);
    options = choices.map(item => ({ hash: item.hash, source: item.source, bytes: item.bytes.length,
      records: issue.sessionId ? parseSessionLog(item.bytes).length - 1 : undefined }));
    if (!candidateHash) return { issue, candidates: options, warning: '请选择要恢复的备份，再查看方案。备份之后新增的内容可能不在其中。' };
    const candidate = choices.find(item => item.hash === candidateHash);
    if (!candidate) throw new Error('恢复来源已变化，请重新预览');
    let after = candidate.bytes;
    if (issue.kind === 'registry-file') {
      const restored = JSON.parse(after.toString().replace(/^\uFEFF/, ''));
      for (const w of Object.values(restored.tables.workspaces)) {
        if (!w || typeof w.path !== 'string' || !Array.isArray(w.sessionIds) || w.sessionIds.some(id => typeof id !== 'string'))
          throw new Error('候选登记缺少可靠的项目路径或会话列表，请选择另一来源');
        if (typeof w.title !== 'string') w.title = path.basename(w.path.replaceAll('\\', '/'));
        if (typeof w.createdAt !== 'string') w.createdAt = new Date().toISOString();
        if (typeof w.updatedAt !== 'string') w.updatedAt = w.createdAt;
      }
      restored.global.workspaceIds = [...new Set([...(restored.global.workspaceIds || []), ...Object.keys(restored.tables.workspaces)])]
        .filter(id => Object.hasOwn(restored.tables.workspaces, id));
      restored.global.archivedSessionIds = [...new Set(restored.global.archivedSessionIds || [])];
      after = Buffer.from(JSON.stringify(restored, null, 2) + '\n');
    }
    if (issue.sessionId) {
      const catalog = await (engine.loadTransferCatalog || transferCatalog)();
      const artifact = decodeRecoverySession(after, catalog);
      if (artifact.header.id !== issue.sessionId) throw new Error('恢复身份不匹配');
      if (issue.file.endsWith('.zstd') && !after.subarray(0, 4).equals(ZSTD_MAGIC)) {
        // Cold discovery requires a separate compressed header frame.
        const boundary = after.indexOf(10) + 1;
        after = Buffer.concat([zstdCompressSync(after.subarray(0, boundary)), zstdCompressSync(after.subarray(boundary))]);
      }
      if (!issue.file.endsWith('.zstd') && after.subarray(0, 4).equals(ZSTD_MAGIC))
        after = Buffer.from(decodeZstdFrames(after, MAX));
      const sourceRows = parseSessionLog(after);
      if (sourceRows[0].version !== sessionLogGeneration(issue.file)) throw new Error('候选日志代际不同，请选择同代来源');
    }
    files.push({ file: issue.file, before, after });
    warning = issue.kind === 'config'
      ? '来源：' + candidate.source + '。将恢复该份配置中的连接与选择；原损坏配置完整备份。'
      : issue.kind === 'registry-file' ? '来源：' + candidate.source + '。将恢复项目关系，并补齐宿主要求的登记字段；原登记完整备份。'
      : '来源：' + candidate.source + '。将恢复这份备份中的对话内容。';
  } else throw new Error('请先同步取回缺失会话；没有可靠日志时不能重建正文');
  for (const item of files) {
    item.beforeHash = item.before === null ? null : digest(item.before);
    item.afterHash = item.after === null ? null : digest(item.after);
    const record = engine.recovery.save({ kind: 'data-repair', path: item.file, status: 'preview', planId: plan.id }, { local: item.before, remote: item.after });
    item.backupId = record.id; delete item.before; delete item.after;
  }
  plan.warning = warning;
  atomicJson(path.join(planRoot(engine), plan.id + '.json'), plan);
  return { planId: plan.id, issue, warning, files, candidates: options, offlineRequired: true };
}
const queueFile = engine => location(engine, LOCAL_DATA + '/data-repair/queue.json');
export function queuedDataRepairs(engine) {
  try { const value = JSON.parse(fs.readFileSync(queueFile(engine), 'utf8')); if (!Array.isArray(value)) throw new Error(); return value; }
  catch (e) { if (e.code === 'ENOENT') return []; throw new Error('待修复队列损坏，已停止'); }
}
function loadPlan(engine, id) {
  if (!/^[0-9a-f-]{36}$/.test(id || '')) throw new Error('修复预览无效');
  const plan = JSON.parse(fs.readFileSync(path.join(planRoot(engine), id + '.json'), 'utf8'));
  if (plan.id !== id || plan.expiresAt < Date.now() || !plan.files?.length) throw new Error('修复预览过期，请重新检查');
  return plan;
}
export function queueDataRepair(engine, id) {
  loadPlan(engine, id);
  const queue = queuedDataRepairs(engine);
  if (!queue.includes(id)) queue.push(id);
  atomicJson(queueFile(engine), queue);
  return { queued: true, restartRequired: true, hint: '修复已安排，完全退出 DSH 后执行。' };
}
export function cancelQueuedDataRepairs(engine) {
  const count = queuedDataRepairs(engine).length;
  if (count) atomicJson(queueFile(engine), []);
  return { cancelled: count, hint: '已取消修复安排。' };
}
export function previewDataRollback(engine, backupId) {
  const record = engine.recovery.read(backupId);
  if (record.kind !== 'data-repair' || record.status !== 'repaired') throw new Error('此备份尚不能撤销');
  const before = engine.recovery.version(record, 'local'), after = engine.recovery.version(record, 'remote');
  const now = read(engine, record.path);
  if ((now === null ? null : digest(now)) !== (after === null ? null : digest(after))) throw new Error('修复后已有新修改，不能覆盖；原件仍可预览');
  if (before === null) throw new Error('没有修复前原件');
  const inverse = engine.recovery.save({ kind: 'data-repair', path: record.path, status: 'preview', undoes: record.id }, { local: after, remote: before });
  const plan = { id: randomUUID(), kind: 'rollback', createdAt: Date.now(), expiresAt: Date.now() + 86400000,
    files: [{ file: record.path, backupId: inverse.id, beforeHash: after === null ? null : digest(after), afterHash: digest(before) }],
    warning: '将恢复修复前的原件；目前的修复结果也会备份。如果原件损坏，同步将再次暂停。' };
  atomicJson(path.join(planRoot(engine), plan.id + '.json'), plan);
  return { planId: plan.id, files: plan.files, warning: plan.warning, offlineRequired: true };
}
export async function applyDataRepair(engine, id, { offline = false, assertClosed = assertDshClosed } = {}) {
  await assertClosed(engine, offline);
  const release = engine.acquireProcessLock(); if (!release) throw new Error('另一同步进程正在运行');
  const applied = [];
  try {
    const plan = loadPlan(engine, id);
    if (plan.selectedFile && digest(read(engine, plan.selectedFile)) !== plan.selectedHash) throw new Error('所选保留日志已变化，请重新预览');
    const materials = plan.files.map(item => {
      const record = engine.recovery.read(item.backupId);
      if (record.kind !== 'data-repair' || record.path !== item.file) throw new Error('修复备份身份错误');
      const before = engine.recovery.version(record, 'local'), after = engine.recovery.version(record, 'remote');
      if ((before === null ? null : digest(before)) !== item.beforeHash || (after === null ? null : digest(after)) !== item.afterHash)
        throw new Error('修复备份校验失败');
      return { ...item, before, after };
    });
    const hashOf = item => { const now = read(engine, item.file); return now === null ? null : digest(now); };
    if (!materials.every(item => [item.beforeHash, item.afterHash].includes(hashOf(item)))) throw new Error('预览后文件已变化，未修复；请重新预览');
    await assertClosed(engine, offline);
    for (const item of materials) {
      const hash = hashOf(item);
      if (hash === item.afterHash) { engine.recovery.finish(item.backupId, { status: 'repaired', planId: id }); continue; }
      if (hash !== item.beforeHash) throw new Error('文件已变化，已停止');
      engine.recovery.finish(item.backupId, { status: 'applying', planId: id });
      const target = location(engine, item.file);
      if (item.after === null) {
        // The original is durably stored in RecoveryStore before removing an
        // ambiguous active filename. Keep another recoverable physical copy.
        const archive = location(engine, LOCAL_DATA + '/data-repair/archived/' + id);
        fs.mkdirSync(archive, { recursive: true }); fs.renameSync(target, path.join(archive, item.backupId));
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const temp = target + '.repair-' + randomUUID(); fs.writeFileSync(temp, item.after, { flag: 'wx', flush: true }); fs.renameSync(temp, target);
      }
      applied.push(item);
      const saved = read(engine, item.file);
      if ((saved === null ? null : digest(saved)) !== item.afterHash) throw new Error('修复读回不一致');
      engine.recovery.finish(item.backupId, { status: 'repaired', planId: id });
    }
    return { repaired: true, planId: id, backups: materials.map(item => item.backupId), hint: '修复完成，请检查会话显示是否正常。' };
  } catch (e) {
    for (const item of applied.reverse()) {
      const current = read(engine, item.file);
      if ((current === null ? null : digest(current)) !== item.afterHash) continue;
      if (item.before !== null) fs.writeFileSync(location(engine, item.file), item.before, { flush: true });
      engine.recovery.finish(item.backupId, { status: 'rolled-back' });
    }
    throw e;
  } finally { release(); }
}
export async function rollbackDataRepair(engine, backupId, { offline = false, assertClosed = assertDshClosed } = {}) {
  await assertClosed(engine, offline);
  const release = engine.acquireProcessLock(); if (!release) throw new Error('另一同步进程正在运行');
  try {
    const record = engine.recovery.read(backupId);
    if (record.kind !== 'data-repair' || record.status !== 'repaired') throw new Error('此记录不是已完成修复的备份');
    const before = engine.recovery.version(record, 'local'), after = engine.recovery.version(record, 'remote');
    const current = read(engine, record.path);
    if ((current === null ? null : digest(current)) !== (after === null ? null : digest(after))) throw new Error('修复后文件已变化，不能覆盖');
    await assertClosed(engine, offline);
    if (before === null) throw new Error('此备份没有原文件');
    fs.writeFileSync(location(engine, record.path), before, { flush: true });
    if (digest(read(engine, record.path)) !== digest(before)) throw new Error('撤销读回失败');
    engine.recovery.finish(backupId, { status: 'rolled-back' });
    return { rolledBack: true, backupId };
  } finally { release(); }
}
export async function applyQueuedDataRepairs(engine) {
  const results = [];
  for (const id of queuedDataRepairs(engine)) {
    results.push(await applyDataRepair(engine, id, { offline: true }));
    const verification = pendingDataVerification(engine);
    if (!verification.includes(id)) atomicJson(verificationFile(engine), [...verification, id]);
    atomicJson(queueFile(engine), queuedDataRepairs(engine).filter(item => item !== id));
  }
  return results;
}
