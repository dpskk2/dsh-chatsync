import { parseYaml, emitYaml } from './yaml.js';

// DSH 0.2.1 stores live settings in ordered Cordis patch lists. Legacy
// settings.yaml is still accepted, but its imported backup is never transported.
export function isSettingsFile(file) {
  return file === 'settings.yaml' || /^(?:profiles\/[^/]+\/)?cordis\.patch\.yml$/.test(file);
}

const LOCAL_NAMES = /^(?:api[-_]?key|(?:access|refresh|auth|bearer|session|client)[-_]?token|(?:client|access|private)[-_]?key|client[-_]?secret|token|password|secret|authorization|cookie|headers|env|environment|proxy|httpProxy|httpsProxy|allProxy|noProxy|workspaceBase|home|cwd|path|directory|dataRoot|modelDirectory|vadModelPath|executable|command|args|deviceId|inputDeviceId|microphoneId)$/i;
const LOCAL_ENV = /^(?:DSH_HOME|DSH_AGENTS_HOME|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/i;
const localPath = value => typeof value === 'string' && /^(?:[a-z]:[\\/]|\\\\|\/|~[\\/]|file:)/i.test(value);
function localField(key, value) {
  if (LOCAL_NAMES.test(key) || LOCAL_ENV.test(key)) return true;
  if (key === 'name' && localPath(value)) return true;
  if (/(?:Path|Directory|Root)$/.test(key) && localPath(value)) return true;
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return Boolean(url.username || url.password) || /^(?:localhost|127(?:\.\d+){3}|\[::1\]|0\.0\.0\.0)$/i.test(url.hostname);
  } catch { return false; }
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
function syncEntry(value) {
  return /^(?:dsh-chatsync|chatsync)$/.test(value.id || '')
    || /^(?:@dpskk2\/dsh-chatsync|chatsync)$/.test(value.name || '');
}
function localFields(value, fields, prefix = [], patch = false) {
  if (!value || typeof value !== 'object') return value;
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
    if (localField(key, child) || (patch && syncEntry(value) && ['config', 'disabled'].includes(key))) {
      fields.push({ path: full, value: child }); continue;
    }
    out[key] = localFields(child, fields, full, patch);
  }
  return out;
}

export function settingsProjection(buf, file = 'settings.yaml') {
  if (/(?:^|\n)[^\n]*:\s*[&*!]/.test(buf.toString('utf8'))) throw new Error('设置格式不支持安全字段投影（' + file + '）；请关闭设置同步后重试');
  const parsed = parseYaml(buf.toString('utf8'));
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
  return { value: Buffer.from(emitYaml(value)), fields };
}

export function restoreLocalSettings(remote, local, file = 'settings.yaml') {
  const projected = settingsProjection(remote, file);
  const value = parseYaml(projected.value.toString('utf8')).value;
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
  return Buffer.from(emitYaml(value));
}
