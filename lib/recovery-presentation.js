import path from 'node:path';
import { decodeZstdFrames, ZSTD_MAGIC } from './merge.js';
import { parseYaml, CordisExpression } from './yaml.js';

const MAX_DECODED = 64 * 1024 * 1024;
const PAGE = 80;
const labels = {
  title: '标题',
  model: '模型',
  provider: '模型服务',
  theme: '主题',
  language: '语言',
  fontSize: '字号',
  enabled: '启用',
  mode: '模式',
  autoPullOnStart: '启动时同步',
  autoPushOnExit: '退出时同步',
  workspaceSync: '同步项目文件',
  showSidebarSync: '侧边栏同步入口',
  autoRestartAfterRepair: '同步后检查分组',
  remote: '同步仓库',
  branch: '同步分支',
  sessionIds: '会话',
  workspaceIds: '项目',
  archivedSessionIds: '已归档会话',
  sessions: '会话',
  attachments: '附件',
  settings: '设置',
  contentScope: '同步内容',
  globalInstructionsSync: '指令与技能',
  name: '名称',
  path: '位置',
  cwd: '工作目录',
};
const secret = /(?:api[-_]?key|token|password|secret|credential|authorization)/i;
const sessionLog = file => /^sessions\//.test(file) && /\.jsonl(?:\.zstd)?$/.test(file);

function textOf(buffer, file) {
  if (buffer.length > MAX_DECODED) return null;
  return /\.zstd$/i.test(file) || buffer.subarray(0, 4).equals(ZSTD_MAGIC)
    ? decodeZstdFrames(buffer, MAX_DECODED)
    : buffer.toString('utf8');
}

function blocks(content) {
  const result = [];
  for (const part of Array.isArray(content) ? content : []) {
    if (part?.type === 'text' && typeof part.text === 'string') result.push({ type: 'text', text: part.text });
    if (['image', 'file', 'audio', 'video', 'document'].includes(part?.type)) {
      const attachment = part.attachment || part;
      result.push({
        type: 'attachment',
        name:
          attachment.name ||
          attachment.filename ||
          { image: '图片', audio: '音频', video: '视频' }[part.type] ||
          '附件',
        mediaType: part.type,
        bytes: attachment.size || attachment.bytes || null,
      });
    }
  }
  return result;
}

/** Read the human transcript, never model-input replacements or injected context. */
export function conversationPresentation(text, { offset = 0 } = {}) {
  const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const messages = [];
  let total = 0,
    unreadable = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      unreadable++;
      continue;
    }
    if (event.surfaceOp && event.surfaceOp !== 'append') continue;
    let role, message;
    if (event.type === 'user/message') {
      message = event.data;
      if (message?.source?.kind && message.source.kind !== 'user') continue;
      if (message?.role && message.role !== 'user') continue;
      role = 'user';
    } else if (event.type === 'assistant/message') {
      message = event.data?.message || event.data;
      role = 'assistant';
    } else continue;
    const content = blocks(message?.content);
    if (!content.length) continue;
    if (total >= start && messages.length < PAGE)
      messages.push({ id: message.id || String(event.seq ?? total), role, content, time: event.time || null });
    total++;
  }
  return {
    kind: 'conversation',
    messages,
    total,
    offset: start,
    nextOffset: start + messages.length,
    hasMore: start + messages.length < total,
    incomplete: unreadable > 0,
  };
}

function friendlyValue(value, key) {
  if (secret.test(key)) return value ? '••••••' : '未设置';
  if (value instanceof CordisExpression) return '动态配置：' + value.source;
  if (typeof value === 'boolean') return value ? '开启' : '关闭';
  if (value === null || value === undefined) return '未设置';
  if (Array.isArray(value))
    return value.every(v => typeof v !== 'object') ? value.map(String).join('、') || '无' : value.length + ' 项';
  return String(value);
}

function settingsFields(value) {
  const rows = [];
  const walk = (item, prefix = '', depth = 0) => {
    if (rows.length >= 160 || depth > 12) return;
    if (Array.isArray(item) && item.some(value => value && typeof value === 'object')) {
      item.forEach((value, index) =>
        walk(
          value?.config || value,
          [prefix, value?.id || value?.name || '第 ' + (index + 1) + ' 项'].filter(Boolean).join(' / '),
          depth + 1,
        ),
      );
      return;
    }
    if (item && typeof item === 'object' && !(item instanceof CordisExpression) && !Array.isArray(item)) {
      for (const [key, child] of Object.entries(item)) {
        const title = labels[key] || key;
        const name = prefix ? prefix + ' / ' + title : title;
        if (secret.test(key)) rows.push({ name, value: friendlyValue(child, key) });
        else if (
          child &&
          typeof child === 'object' &&
          Object.hasOwn(child, 'value') &&
          (Object.hasOwn(child, 'clock') || Object.hasOwn(child, 'actor'))
        )
          walk(child.value, name, depth + 1);
        else walk(child, name, depth + 1);
      }
    } else rows.push({ name: prefix || '内容', value: friendlyValue(item, prefix) });
  };
  walk(value);
  return rows;
}

function cachePresentation(value) {
  const rows = value?.record?.rows;
  if (!rows || typeof rows !== 'object') return null;
  const fields = [];
  for (const key of ['title', 'workingDirectory', 'model', 'agentPreset']) {
    const item = rows[key]?.val;
    if (item !== undefined && item !== null)
      fields.push({
        name: { workingDirectory: '工作目录', agentPreset: '助手预设' }[key] || labels[key],
        value:
          typeof item === 'object'
            ? friendlyValue(item.name || item.id || item.mode || '已配置', key)
            : friendlyValue(item, key),
      });
  }
  return {
    kind: 'fields',
    title: '会话列表信息',
    fields,
  };
}

function registryPresentation(value) {
  if (!value?.tables?.workspaces) return null;
  return {
    kind: 'projects',
    projects: Object.entries(value.tables.workspaces).map(([id, ws]) => ({
      id,
      title: ws.title || ws.name || path.basename(String(ws.path || id).replaceAll('\\', '/')),
      location: ws.path || '',
      sessions: Array.isArray(ws.sessionIds) ? ws.sessionIds.length : 0,
    })),
    archived: value.global?.archivedSessionIds?.length || 0,
  };
}

/** Presentation only: never rewrites or discards any saved bytes. */
export function recoveryPresentation(record, buffer, options = {}) {
  if (buffer === null) return { kind: 'missing' };
  const file = String(record.path || '').replaceAll('\\', '/');
  const name = file.split('/').pop() || '文件';
  const image = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  }[path.extname(file).toLowerCase()];
  if (image && buffer.length <= 8 * 1024 * 1024)
    return { kind: 'image', name, bytes: buffer.length, url: 'data:' + image + ';base64,' + buffer.toString('base64') };
  const text = textOf(buffer, file);
  if (text === null) return { kind: 'file', name, bytes: buffer.length, note: '文件较大，请恢复后查看。' };
  if (sessionLog(file)) return conversationPresentation(text, options);
  if (buffer.includes(0)) return { kind: 'file', name, bytes: buffer.length };
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    if (/\.ya?ml$/i.test(file)) {
      const parsed = parseYaml(text, { cordis: true });
      if (parsed.ok) value = parsed.value;
    }
  }
  if (value !== undefined) {
    if (/^storages\/session_projcache\//.test(file)) {
      const cache = cachePresentation(value);
      if (cache) return cache;
    }
    if (file === 'storages/workspace.json') {
      const projects = registryPresentation(value);
      if (projects) return projects;
    }
    return {
      kind: 'fields',
      title: /(?:settings|cordis|sync-meta|dsh-sync)/.test(file) ? '设置' : '文件内容',
      fields: settingsFields(value),
    };
  }
  return {
    kind: /\.(?:md|markdown)$/i.test(file) ? 'markdown' : 'text',
    name,
    text: text.slice(0, 256 * 1024),
    truncated: text.length > 256 * 1024,
  };
}
