// Compare DSH versions (major.minor.patch with an optional pre-release) by SemVer
// precedence. Unlike isNewerVersion in updates.js, pre-releases take part here:
// DSH ships release candidates, and the settings version gate must order them.

const VERSION =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** @param {unknown} value */
export function parseDshVersion(value) {
  const match = typeof value === 'string' ? VERSION.exec(value.trim()) : null;
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split('.') : [] };
}

const numeric = part => /^(0|[1-9]\d*)$/.test(part);
function comparePart(a, b) {
  if (numeric(a) && numeric(b)) return Math.sign(Number(a) - Number(b));
  if (numeric(a) !== numeric(b)) return numeric(a) ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * -1, 0 or 1 as `a` is older than, the same as or newer than `b`; null when either
 * cannot be parsed. A pre-release is older than its release; rc.10 is newer than rc.9.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {-1|0|1|null}
 */
export function compareDshVersions(a, b) {
  const left = parseDshVersion(a),
    right = parseDshVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) if (left.core[i] !== right.core[i]) return left.core[i] < right.core[i] ? -1 : 1;
  if (!left.pre.length || !right.pre.length)
    return /** @type {-1|0|1} */ (Math.sign(right.pre.length - left.pre.length));
  for (let i = 0; i < Math.min(left.pre.length, right.pre.length); i++) {
    const order = comparePart(left.pre[i], right.pre[i]);
    if (order) return /** @type {-1|0|1} */ (order);
  }
  return /** @type {-1|0|1} */ (Math.sign(left.pre.length - right.pre.length));
}
