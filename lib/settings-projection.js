import { parseYaml, emitYaml, CordisExpression } from './yaml.js';

// DSH 0.2.1 stores live settings in ordered Cordis patch lists. Legacy
// settings.yaml is still accepted, but its imported backup is never transported.
export function isSettingsFile(file) {
  return file === 'settings.yaml' || file === 'dsh-sync.json' || /^(?:profiles\/[^/]+\/)?cordis\.patch\.yml$/.test(file);
}

const LOCAL_NAMES = /^(?:api[-_]?key|access[-_]?token|token|password|secret|proxy|httpProxy|httpsProxy|workspaceBase|home)$/i;
const SYNC_PREFERENCES = new Set(['enabled', 'mode', 'lifecycleAutomation', 'autoPullOnStart', 'autoPushOnExit',
  'showSidebarSync', 'autoRestartAfterRepair', 'workspaceSync', 'contentScope', 'intervalSeconds',
  'eventDebounceSeconds', 'minCommitIntervalSeconds', 'patches']);
function localField(key, value) {
  return LOCAL_NAMES.test(key);
}

// Insert blocks have no id of their own. Address them by their anchor metadata,
// never by a list index that could attach a key to a reordered plugin.
function selector(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  for (const key of ['id', 'name', 'provider', 'serverName']) {
    if (typeof item[key] === 'string' || typeof item[key] === 'number') return { key, value: item[key] };
  }
  if (Array.isArray(item.insert)) return { insert: true, value: JSON.stringify(Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'insert').sort(([a], [b]) => a.localeCompare(b)))) };
  return null;
}
const matchesSelector = (item, selected) => {
  const own = selector(item);
  return own && JSON.stringify(own) === JSON.stringify(selected);
};
function localFields(value, fields, prefix = [], patch = false) {
  if (!value || typeof value !== 'object') return value;
  if (value instanceof CordisExpression) return value;
  if (Array.isArray(value)) return value.map((item, index) => {
    const selected = selector(item), before = fields.length;
    const projected = localFields(item, fields, [...prefix, selected || index], patch);
    if (fields.length !== before && (!selected || !matchesSelector(projected, selected)
      || value.filter(entry => matchesSelector(entry, selected)).length !== 1)) {
      throw new Error('设置列表缺少唯一稳定标识，无法安全保留本机字段');
    }
    return projected;
  });
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const full = [...prefix, key];
    if (localField(key, child)) {
      fields.push({ path: full, value: child }); continue;
    }
    out[key] = localFields(child, fields, full, patch);
  }
  return out;
}

export function settingsProjection(buf, file = 'settings.yaml') {
  if (file === 'settings.yaml' && /(?:^|\n)[^\n]*:\s*[&*!]/.test(buf.toString('utf8'))) throw new Error('设置格式不支持安全字段投影（' + file + '）');
  if (file === 'dsh-sync.json') {
    const own = JSON.parse(buf.toString('utf8'));
    if (!own || typeof own !== 'object' || Array.isArray(own)) throw new Error('同步偏好格式错误');
    for (const key of ['enabled', 'autoPullOnStart', 'autoPushOnExit', 'showSidebarSync', 'autoRestartAfterRepair', 'workspaceSync', 'patches']) {
      if (Object.hasOwn(own, key) && typeof own[key] !== 'boolean') throw new Error('同步偏好格式错误：' + key);
    }
    if (own.lifecycleAutomation !== undefined && own.lifecycleAutomation !== 1) throw new Error('同步偏好格式错误：lifecycleAutomation');
    if (own.mode !== undefined && !['auto', 'manual'].includes(own.mode)) throw new Error('同步偏好格式错误：mode');
    if (own.contentScope !== undefined && own.contentScope !== null && (Array.isArray(own.contentScope) || typeof own.contentScope !== 'object'
      || Object.entries(own.contentScope).some(([key, value]) => !['sessions', 'attachments', 'settings'].includes(key) || typeof value !== 'boolean'))) throw new Error('同步偏好格式错误：contentScope');
    const shared = Object.fromEntries(Object.entries(own).filter(([key]) => SYNC_PREFERENCES.has(key)));
    // Old manual configurations could contain enabled:true while their effective
    // lifecycle switch was off. Export that meaning, not a misleading raw flag.
    if (own.mode === 'manual' && own.lifecycleAutomation === undefined
      && !Object.hasOwn(own, 'autoPullOnStart') && !Object.hasOwn(own, 'autoPushOnExit')) {
      shared.enabled = false; shared.lifecycleAutomation = 1;
    }
    return { value: Buffer.from(JSON.stringify(shared, null, 2) + '\n'), fields: [] };
  }
  const parsed = parseYaml(buf.toString('utf8'), { cordis: file !== 'settings.yaml' });
  const patch = file !== 'settings.yaml';
  // Unknown tags (including executable !!js), aliases, and malformed structures
  // fail closed. Never evaluate host expressions or fall back to copying secrets.
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object'
    || Array.isArray(parsed.value) !== patch
    || (patch && parsed.value.some(item => !item || typeof item !== 'object' || Array.isArray(item)))) {
    throw new Error('设置格式不支持安全字段投影（' + file + '）；请关闭设置同步后重试');
  }
  const fields = [];
  const value = localFields(parsed.value, fields, [], patch);
  return { value: Buffer.from(emitYaml(value, { cordis: patch })), fields };
}

export function restoreLocalSettings(remote, local, file = 'settings.yaml') {
  const projected = settingsProjection(remote, file);
  if (file === 'dsh-sync.json') {
    const own = local ? JSON.parse(local.toString('utf8')) : {};
    return Buffer.from(JSON.stringify({ ...own, ...JSON.parse(projected.value) }, null, 2) + '\n');
  }
  const value = parseYaml(projected.value.toString('utf8'), { cordis: file !== 'settings.yaml' }).value;
  const fields = local ? settingsProjection(local, file).fields : [];
  for (const { path: parts, value: own } of fields) {
    let target = value;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (key && typeof key === 'object') {
        if (!Array.isArray(target)) throw new Error('设置列表结构变化，无法保留本机字段');
        const matches = target.filter(item => matchesSelector(item, key));
        if (matches.length > 1) throw new Error('设置列表标识重复，无法保留本机字段');
        // A deliberately removed plugin/provider stays removed. Its original
        // configuration remains available in the local import backup.
        if (!matches.length) { target = null; break; }
        target = matches[0]; continue;
      }
      if (!Object.hasOwn(target, key)) { target = null; break; }
      if (!target[key] || typeof target[key] !== 'object') throw new Error('设置字段结构变化，无法保留本机字段');
      target = target[key];
    }
    if (target) target[parts.at(-1)] = own;
  }
  return Buffer.from(emitYaml(value, { cordis: file !== 'settings.yaml' }));
}
