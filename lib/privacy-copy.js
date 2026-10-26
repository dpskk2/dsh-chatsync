import { parseSessionLog } from './merge.js';
import { inspectContentDetails } from './privacy.js';

// This produces an import source for a NEW host-generated fork. Never replace
// the active original with these changed historical event bodies.
export function redactedSessionSource(file, buffer, { additionalValues = [] } = {}) {
  const rows = parseSessionLog(buffer);
  if (!rows) throw new Error('原件日志无效，未生成脱敏副本');
  const values = [...new Set(additionalValues.filter(v => typeof v === 'string' && v.length >= 4))].sort(
    (a, b) => b.length - a.length,
  );
  let replacements = 0;
  const redact = text => {
    for (const value of values)
      if (text.includes(value)) {
        const parts = text.split(value);
        replacements += parts.length - 1;
        text = parts.join('[已脱敏]');
      }
    text = text.replace(
      /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b|\bsk-[A-Za-z0-9_-]{24,}\b|\bAKIA[A-Z0-9]{16}\b/g,
      () => {
        replacements++;
        return '[已脱敏]';
      },
    );
    return text.replace(
      /((?:api[-_]?key|access[-_]?token|password|secret)\s*["']?\s*[:=]\s*["']?)([A-Za-z0-9_+/.=-]{20,})/gi,
      (_match, prefix) => {
        replacements++;
        return prefix + '[已脱敏]';
      },
    );
  };
  const visit = value => {
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    return value;
  };
  const copied = rows.map(visit);
  for (const row of copied)
    if (row.type === 'session/title' && typeof row.data?.title === 'string') row.data.title += '（脱敏副本）';
  const source = Buffer.from(copied.map(row => JSON.stringify(row)).join('\n') + '\n');
  if (!replacements) throw new Error('未找到可脱敏内容，未创建副本');
  const inspection = inspectContentDetails(file, source);
  if (inspection.reasons.length) throw new Error('脱敏副本仍未通过敏感检查：' + inspection.reasons.join('、'));
  return { source, replacements };
}
