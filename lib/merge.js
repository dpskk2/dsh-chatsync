/**
 * dsh-chatsync 合并层 —— 纯函数,不依赖 git / SyncEngine / 任何 npm 包。
 *
 * 设计(见 docs/merge-engine-refactor.md):把「合并」从 git merge 的三路行级合并里
 * 拆出来,按文件类型给一条确定性、收敛的规则;不存在「停下来问用户」的分支。
 *
 *  - classifyFile(relPath)              → 文件类型
 *  - mergeSessionLog(ours, theirs)      → 会话日志追加历史选择(分叉不混排)
 *  - mergeVmap / updateVmap / diffLeafPaths / mergeJsonByVmap → 字段级 LWW-Map CRDT
 *
 * 所有函数都是纯的(输入 Buffer/对象,返回新值),便于脱离 git 直接单测。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml, emitYaml } from './yaml.js';

/* ---- zstd:运行时有 zstd 才可用,旧版本自动降级(退回明文/不可合并) ---- */
let zstdDecompressSync = null;
try { ({ zstdDecompressSync } = await import('node:zlib')); } catch { /* 降级 */ }

/** zstd 帧魔数(小端 0xFD2FB528) */
export const ZSTD_MAGIC = Buffer.from([0x28, 0xB5, 0x2F, 0xFD]);

// Frame/block lengths from the Zstandard format specification:
// https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md
// Node may return partial output for a truncated frame, so check framing first.
function zstdFrameEnd(buf, offset) {
  if (offset + 5 > buf.length || !buf.subarray(offset, offset + 4).equals(ZSTD_MAGIC)) throw new Error('bad frame');
  const descriptor = buf[offset + 4];
  if (descriptor & 8) throw new Error('reserved frame bit');
  const single = Boolean(descriptor & 32);
  const contentSize = [single ? 1 : 0, 2, 4, 8][descriptor >>> 6];
  let cursor = offset + 5 + (single ? 0 : 1) + [0, 1, 2, 4][descriptor & 3] + contentSize;
  let last = false;
  while (!last) {
    if (cursor + 3 > buf.length) throw new Error('truncated block header');
    const block = buf.readUIntLE(cursor, 3);
    const type = (block >>> 1) & 3;
    if (type === 3) throw new Error('reserved block type');
    last = Boolean(block & 1);
    cursor += 3 + (type === 1 ? 1 : block >>> 3);
    if (cursor > buf.length) throw new Error('truncated block');
  }
  cursor += descriptor & 4 ? 4 : 0;
  if (cursor > buf.length) throw new Error('truncated checksum');
  return cursor;
}

/** Header readers need only the first complete frame, even when the read ends mid-stream. */
export function decodeZstdFirstFrame(buf) {
  if (typeof zstdDecompressSync !== 'function') return null;
  try { return zstdDecompressSync(buf.subarray(0, zstdFrameEnd(buf, 0))).toString('utf8'); } catch { return null; }
}

/** Decode the complete stream; a damaged frame must not silently drop events. */
export function decodeZstdFrames(buf) {
  if (!buf.subarray(0, 4).equals(ZSTD_MAGIC) || typeof zstdDecompressSync !== 'function') return null;
  try {
    const chunks = [];
    let offset = 0;
    while (offset < buf.length) {
      if (offset + 8 <= buf.length && (buf.readUInt32LE(offset) & 0xfffffff0) === 0x184d2a50) {
        const end = offset + 8 + buf.readUInt32LE(offset + 4);
        if (end > buf.length) return null;
        offset = end;
        continue;
      }
      const end = zstdFrameEnd(buf, offset);
      const { buffer, engine } = zstdDecompressSync(buf.subarray(offset, end), { info: true });
      const consumed = engine.bytesWritten;
      if (consumed !== end - offset) return null;
      chunks.push(buffer);
      offset += consumed;
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch { return null; }
}

/* ================= 文件分类 ================= */

/**
 * 按相对路径分类,决定走哪条合并策略。
 * @returns 'session-log' | 'crdt-json' | 'crdt-yaml' | 'crdt-meta' | 'opaque'
 */
export function classifyFile(relPath) {
  const p = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (/^sessions\/[^/]+\/session-[0-9a-f-]{36}\/session(\.v\d+)?\.jsonl(\.zstd)?$/i.test(p)) return 'session-log';
  if (/^storages\/sync-meta\/.*\.vmap\.json$/i.test(p)) return 'crdt-meta';
  if (p === 'storages/workspace.json') return 'crdt-json';
  if (p === 'profiles/web/package.json') return 'crdt-json';
  if (/\.ya?ml$/i.test(p)) return 'crdt-yaml';
  return 'opaque';
}

/* ================= 会话日志:原样选择追加历史 ================= */

/**
 * Only select an existing append-only history. Never renumber or interleave Session
 * events: seq, surfaceOp, turn/step and tool lifecycles are format-owned relations.
 * Divergent histories must remain separate and be reported by the caller.
 */
export function mergeSessionLog(oursBuf, theirsBuf) {
  if (oursBuf.equals(theirsBuf)) return { ok: true, value: oursBuf };
  const decode = (buf) => {
    const compressed = buf.subarray(0, 4).equals(ZSTD_MAGIC);
    const text = compressed ? decodeZstdFrames(buf) : buf.toString('utf8');
    if (text === null) return null;
    try {
      const rows = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
      if (!rows.length || rows[0]?.type !== 'session') return null;
      if (rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) return null;
      if (rows.slice(1).some((r) => r.type === 'session')) return null;
      return rows.map((r) => JSON.stringify(r));
    } catch { return null; }
  };
  const ours = decode(oursBuf);
  const theirs = decode(theirsBuf);
  if (!ours || !theirs) return { ok: false, reason: 'invalid-session-log' };
  if (ours[0] !== theirs[0]) return { ok: false, reason: 'header-mismatch' };
  const prefix = (a, b) => a.length <= b.length && a.every((row, i) => row === b[i]);
  if (prefix(ours, theirs)) return { ok: true, value: theirsBuf };
  if (prefix(theirs, ours)) return { ok: true, value: oursBuf };
  return { ok: false, reason: 'divergent-session-history' };
}

/* ================= 字段级 LWW-Map CRDT(JSON 配置) ================= */

/** 时钟比较:返回 >0 表示 a 比 b 新;相等时按 actor 字典序决定全序 */
export function cmpClock(a, b) {
  const A = (a && typeof a === 'object') ? a : { t: 0, actor: '' };
  const B = (b && typeof b === 'object') ? b : { t: 0, actor: '' };
  if (A.t !== B.t) return A.t - B.t;
  if (A.actor === B.actor) return 0;
  return String(A.actor) > String(B.actor) ? 1 : -1;
}

/**
 * vmap(LWW-Map)自身合并:同键取 (t,actor) 大者,异键并集。
 * vmap 形如 { format:1, path:'settings.yaml', fields:{ '<leaf.path>': {t,actor} } }
 */
export function mergeVmap(a, b) {
  const A = (a && typeof a === 'object') ? a : { fields: {} };
  const B = (b && typeof b === 'object') ? b : { fields: {} };
  const fields = {};
  const keys = new Set([...Object.keys(A.fields || {}), ...Object.keys(B.fields || {})]);
  for (const k of keys) {
    const ca = (A.fields && A.fields[k]) || null;
    const cb = (B.fields && B.fields[k]) || null;
    if (ca && cb) fields[k] = cmpClock(ca, cb) >= 0 ? ca : cb;
    else fields[k] = ca || cb;
  }
  return { format: 1, path: A.path || B.path || '', fields };
}

const isScalar = (v) => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const isPlainObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 顺序不敏感深比较:map 忽略键序、数组保留项序(避免 key 重排导致假「已变更」) */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a); const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

/** 列出对象所有「叶子路径」(标量或数组节点)的 dot-path */
export function leafPaths(obj) {
  const out = [];
  const walk = (v, p) => {
    if (isScalar(v) || Array.isArray(v)) { out.push(p); return; }
    for (const k of Object.keys(v || {})) walk(v[k], p ? `${p}.${k}` : k);
  };
  walk(obj, '');
  return out;
}

/** 深比较 base vs next,返回「值发生变化」的叶子路径集合(供提交时 bump vmap 用) */
export function diffLeafPaths(base, next) {
  const out = new Set();
  const walk = (b, n, p) => {
    if (isScalar(n) || isScalar(b) || Array.isArray(n) || Array.isArray(b)) {
      if (!deepEqual(b, n)) out.add(p);
      return;
    }
    const keys = new Set([...Object.keys(b || {}), ...Object.keys(n || {})]);
    for (const k of keys) walk((b && b[k]) ?? undefined, (n && n[k]) ?? undefined, p ? `${p}.${k}` : k);
  };
  walk(base, next, '');
  return out;
}

/** 提交时更新 vmap:changedPaths 打上新时钟 {t,actor},未变叶子保留旧时钟 */
export function updateVmap(vmap, changedPaths, t, actor) {
  const base = (vmap && typeof vmap === 'object') ? vmap : { format: 1, path: '', fields: {} };
  const fields = { ...(base.fields || {}) };
  for (const p of changedPaths) fields[p] = { t, actor };
  return { format: 1, path: base.path || '', fields };
}

/** 列表元素身份:标量取自身;map 依次尝试 id → provider+model → name → 内容哈希 */
export function listIdentity(item) {
  if (isScalar(item)) return item;
  if (Array.isArray(item)) return JSON.stringify(item);
  if (isPlainObj(item)) {
    if ('id' in item) return 'id:' + item.id;
    if ('provider' in item && 'model' in item) return `pm:${item.provider}:${item.model}`;
    if ('name' in item) return 'name:' + item.name;
    return 'h:' + JSON.stringify(item);
  }
  return JSON.stringify(item);
}

/** 列表合并:按元素身份 OR-set(并集);同身份元素递归合并(首版无墓碑,删除可能复活,见设计 §5.4) */
function mergeList(ours, theirs, oursVmap, theirsVmap, pathKey) {
  const idOf = (item) => JSON.stringify(listIdentity(item));
  const oursById = new Map(ours.map((it) => [idOf(it), it]));
  const theirsById = new Map(theirs.map((it) => [idOf(it), it]));
  const order = []; const seen = new Set();
  for (const it of ours) { const id = idOf(it); if (!seen.has(id)) { seen.add(id); order.push(id); } }
  for (const it of theirs) { const id = idOf(it); if (!seen.has(id)) { seen.add(id); order.push(id); } }
  const out = [];
  for (const id of order) {
    const o = oursById.get(id); const t = theirsById.get(id);
    if (o !== undefined && t !== undefined) {
      out.push(deepEqual(o, t) ? o : mergeJsonByVmap(undefined, o, t, oursVmap, theirsVmap, pathKey));
    } else if (o !== undefined) out.push(o);
    else out.push(t);
  }
  return out;
}

/**
 * 三路 JSON 合并(base/ours/theirs + 两侧 vmap)。
 * 标量 → LWW(比较两侧 vmap 该叶子的时钟);映射 → 递归并集;数组 → 按元素身份并集。
 * 返回合并后的值(纯对象)。
 *
 * 注意:这里接收「两侧各自的 vmap」而非合并后的 vmap —— 因为判断某叶子「谁更新」
 * 必须比较 ours 侧时钟 vs theirs 侧时钟;合并后的单一时钟只知道胜者、不知道方向。
 */
export function mergeJsonByVmap(base, ours, theirs, oursVmap, theirsVmap, pathKey = '') {
  const fieldOf = (m) => (m && m.fields && m.fields[pathKey]) || null;
  // 标量叶子(含两侧类型不一致 → 退化 LWW)
  if (isScalar(ours) || isScalar(theirs) || Array.isArray(ours) !== Array.isArray(theirs)) {
    if (deepEqual(ours, theirs)) return ours;
    const cO = fieldOf(oursVmap); const cT = fieldOf(theirsVmap);
    if (cO && cT) return cmpClock(cO, cT) >= 0 ? ours : theirs;
    if (cO) return ours;                       // 仅本侧改过(有版本图)
    if (cT) return theirs;                     // 仅远侧改过(有版本图)
    // 无版本图(引导期)→ base 感知三路:谁改了取谁;都改了取本侧(确定性)
    if (base !== undefined) {
      const oChanged = !deepEqual(ours, base);
      const tChanged = !deepEqual(theirs, base);
      if (oChanged && !tChanged) return ours;
      if (!oChanged && tChanged) return theirs;
    }
    return ours;
  }
  if (Array.isArray(ours) && Array.isArray(theirs)) return mergeList(ours, theirs, oursVmap, theirsVmap, pathKey);
  // 两侧都是普通对象 → 递归
  const out = {};
  const keys = new Set([...Object.keys(ours), ...Object.keys(theirs)]);
  for (const k of keys) {
    const hasO = Object.prototype.hasOwnProperty.call(ours, k);
    const hasT = Object.prototype.hasOwnProperty.call(theirs, k);
    const childKey = pathKey ? `${pathKey}.${k}` : k;
    if (hasO && hasT) {
      out[k] = mergeJsonByVmap(base ? base[k] : undefined, ours[k], theirs[k], oursVmap, theirsVmap, childKey);
    } else if (hasO) out[k] = ours[k];
    else out[k] = theirs[k];
  }
  return out;
}

/** 便捷:把合并结果写回磁盘(工作树路径),目录自动创建 */
export function writeMerged(relPath, buf, rootDir) {
  const target = path.join(rootDir, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buf);
}

/**
 * YAML 配置合并:两侧解析为对象 → mergeJsonByVmap(字段级 LWW-Map) → 序列化回 YAML。
 * 任一侧解析失败(超出子集)→ { ok:false },由调用方降级为 opaque 三方文本合并。
 * 返回 { ok, value(string) }。
 */
export function mergeYamlByVmap(baseText, oursText, theirsText, oursVmap, theirsVmap) {
  const pb = baseText != null && baseText !== '' ? parseYaml(baseText) : { ok: true, value: undefined };
  const po = parseYaml(oursText);
  const pt = parseYaml(theirsText);
  if (!po.ok || !pt.ok || !pb.ok) return { ok: false, reason: 'yaml-parse' };
  const merged = mergeJsonByVmap(pb.value, po.value, pt.value, oursVmap, theirsVmap, '');
  return { ok: true, value: emitYaml(merged) };
}
