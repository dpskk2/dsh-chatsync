// js-yaml 4.1.1 is vendored with its MIT license; no install-time dependency.
import { load, dump, JSON_SCHEMA, Type } from './vendor/js-yaml.mjs';

// Carry Cordis expressions as tagged text. Never evaluate them in the sync process.
export class CordisExpression { constructor(source) { this.source = source; } }
const CORDIS_SCHEMA = JSON_SCHEMA.extend([new Type('tag:yaml.org,2002:js', {
  kind: 'scalar', construct: source => new CordisExpression(source ?? ''),
  instanceOf: CordisExpression, represent: value => value.source,
})]);

function checked(value, seen = new Set(), depth = 0, budget = { count: 0 }) {
  if (++budget.count > 100000 || depth > 64) throw new Error('YAML structure exceeds safe limits');
  if (!value || typeof value !== 'object') return;
  if (value instanceof CordisExpression) return;
  if (seen.has(value)) throw new Error('YAML aliases are not supported');
  seen.add(value);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Unsupported YAML object');
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsupported YAML key');
    checked(child, seen, depth + 1, budget);
  }
  if (budget.aliases) seen.delete(value);
}
export function parseYaml(text, { cordis = false } = {}) {
  try {
    if (Buffer.byteLength(String(text)) > 8 * 1024 * 1024) throw new Error('YAML exceeds safe limits');
    const value = load(String(text), { schema: cordis ? CORDIS_SCHEMA : JSON_SCHEMA });
    checked(value, new Set(), 0, { count: 0, aliases: cordis });
    return { ok: true, value: value === undefined ? null : value };
  } catch (error) { return { ok: false, reason: error.message }; }
}
export function emitYaml(value, { cordis = false } = {}) {
  checked(value, new Set(), 0, { count: 0, aliases: cordis });
  return dump(value, { schema: cordis ? CORDIS_SCHEMA : JSON_SCHEMA, sortKeys: true, noRefs: true, lineWidth: -1, noCompatMode: true });
}
