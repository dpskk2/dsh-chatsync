// js-yaml 4.1.1 is vendored with its MIT license; no install-time dependency.
import { load, dump, JSON_SCHEMA } from './vendor/js-yaml.mjs';

function checked(value, seen = new Set(), depth = 0, budget = { count: 0 }) {
  if (++budget.count > 100000 || depth > 64) throw new Error('YAML structure exceeds safe limits');
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) throw new Error('YAML aliases are not supported');
  seen.add(value);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Unsupported YAML object');
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsupported YAML key');
    checked(child, seen, depth + 1, budget);
  }
}
export function parseYaml(text) {
  try {
    if (Buffer.byteLength(String(text)) > 8 * 1024 * 1024) throw new Error('YAML exceeds safe limits');
    const value = load(String(text), { schema: JSON_SCHEMA });
    checked(value);
    return { ok: true, value: value === undefined ? null : value };
  } catch (error) { return { ok: false, reason: error.message }; }
}
export function emitYaml(value) {
  checked(value);
  return dump(value, { schema: JSON_SCHEMA, sortKeys: true, noRefs: true, lineWidth: -1, noCompatMode: true });
}
export function roundTrip(value) { const parsed = parseYaml(emitYaml(value)); return parsed.ok ? parsed.value : null; }
