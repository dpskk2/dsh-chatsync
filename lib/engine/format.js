// Part of the SyncEngine (lib/sync.js); moved verbatim from lib/sync.js.


/* ================= 传输统计 —— 解析 git --progress 的 stderr(推/拉的对象数、字节、速度) ================= */

/** 把 "1.5 MiB" / "234 KiB" / "900 B" 换算成字节 */
export function parseBytes(n, unit) {
  const u = String(unit || '').toLowerCase().replace(/i/g, '');
  const mult = u.startsWith('k') ? 1024 : u.startsWith('m') ? 1024 ** 2 : u.startsWith('g') ? 1024 ** 3 : 1;
  return Math.round(parseFloat(n) * mult);
}
/** 字节数 → 可读文本(自动选单位) */
export function humanSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  const abs = Math.abs(bytes);
  if (abs >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + ' GiB';
  if (abs >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(2) + ' MiB';
  if (abs >= 1024) return (bytes / 1024).toFixed(1) + ' KiB';
  return bytes + ' B';
}
/**
 * 从 git --progress 的 stderr 文本里提取传输信息:
 *   Writing objects:  45% (123/456), 1.24 MiB | 1.52 MiB/s   (push)
 *   Receiving objects: 72% (201/280), 2.30 MiB | 3.10 MiB/s  (fetch)
 *   Total 456 (delta 89), reused 12 (delta 0), pack-reused 400
 * 返回 { op, pct, done, total, size, speed, totalObjects, reused, packReused }
 * (size/speed 为字节;op = 'push' | 'fetch';无传输时字段为 null)
 */
export function parseTransfer(errText) {
  const out = { op: null, pct: null, done: null, total: null, size: null, speed: null, totalObjects: null, reused: null, packReused: null };
  for (const line of String(errText || '').split(/\r\n|\r|\n/)) {
    let m = /(Writing|Receiving) objects:.*?(\d+)%\s*\((\d+)\/(\d+)\)/.exec(line);
    if (m) { out.op = m[1] === 'Writing' ? 'push' : 'fetch'; out.pct = +m[2]; out.done = +m[3]; out.total = +m[4]; }
    m = /(\d+(?:\.\d+)?)\s*([KMGT]?i?B)(?:\s*\|\s*(\d+(?:\.\d+)?)\s*([KMGT]?i?B)\/s)?/.exec(line);
    if (m && (line.includes(' objects:') || line.startsWith('Receiving') || line.startsWith('Writing'))) { out.size = parseBytes(m[1], m[2]); out.speed = m[3] ? parseBytes(m[3], m[4]) : null; }
    m = /Total (\d+) \(delta \d+\), reused (\d+) \(delta \d+\), pack-reused (\d+)/.exec(line);
    if (m) { out.totalObjects = +m[1]; out.reused = +m[2]; out.packReused = +m[3]; }
  }
  return out;
}
/** 把传输统计压成一行可读文本,如 "上传 0.11 MiB(12 对象,复用 8)平均 0.9 MiB/s";无传输返回空串 */
export function formatTransfer(st) {
  if (!st || (!st.size && !st.totalObjects)) return '';
  const dir = st.op === 'push' ? '上传' : '下载';
  const parts = [];
  if (st.size != null) parts.push(humanSize(st.size));
  if (st.totalObjects != null) parts.push(st.totalObjects + ' 个对象' + (st.reused ? `(复用 ${st.reused})` : ''));
  if (st.speed != null) parts.push('平均 ' + (st.speed / 1024 / 1024).toFixed(2) + ' MiB/s');
  return dir + ' ' + parts.join(',');
}
export function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
