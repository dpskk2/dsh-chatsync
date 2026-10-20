import { ZSTD_MAGIC, decodeZstdFrames, parseSessionLog } from './merge.js';
import { sessionIdOfLogPath } from './session-path.js';

const MAX_FILE = 8 * 1024 * 1024;
const MAX_BATCH = 8 * 1024 * 1024;
const BATCH_OBJECTS = 256;
const MAX_ENUM = 32 * 1024 * 1024;

export function inspectContent(file, buffer) {
  const reasons = [];
  if (buffer.length && sessionIdOfLogPath(file) && !parseSessionLog(buffer)) reasons.push('会话记录不完整或序号不连续');
  if (/(?:^|\/)(?:\.env(?:\.[^/]+)?|id_(?:rsa|ed25519)|credentials[^/]*|[^/]+\.(?:pem|p12|pfx|key|kdbx))$/i.test(file)
    && !/(?:\.example|\.sample|\.template)$/i.test(file)) reasons.push('敏感文件名');
  let text;
  if (buffer.subarray(0, 4).equals(ZSTD_MAGIC)) {
    text = decodeZstdFrames(buffer, MAX_FILE);
    if (text === null) return [...reasons, '压缩会话无法在扫描上限内完整读取'];
  } else if (!buffer.includes(0)) text = buffer.toString('utf8');
  if (text) {
    if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(text)) reasons.push('私钥内容');
    if (/\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/.test(text)) reasons.push('GitHub 令牌格式');
    if (/\bsk-[A-Za-z0-9_-]{24,}\b|\bAKIA[A-Z0-9]{16}\b/.test(text)) reasons.push('服务密钥格式');
    if (/(?:api[-_]?key|access[-_]?token|password|secret)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9_+/.=-]{20,}/i.test(text)) reasons.push('疑似明文凭据字段');
  }
  return [...new Set(reasons)];
}

// Scan every new Git blob, including secrets removed in a later unsent commit.
// Findings contain filenames/reasons only, never matched values or surrounding text.
export async function scanOutgoing(engine, target, gitdir = null, root = engine.home) {
  const prefix = gitdir ? ['--git-dir=' + gitdir, '--work-tree=' + root] : [];
  const progressLabel = engine.progress?.label;
  const head = await engine.rev(target, gitdir, root);
  if (!/^[a-f0-9]{40,64}$/.test(head || '')) throw new Error('无法固定待上传提交');
  engine.step('privacy', '检查待上传历史，请稍候…');
  const limited = (args, input = '', timeout = 60000, binary = false, cap = MAX_ENUM) =>
    engine.gitInput([...prefix, ...args], input, timeout, binary, { maxOutputBytes: cap });
  // Use one immutable commit throughout all batches, including deleted history.
  const listed = await limited(['rev-list', '--objects', head, '--not', '--remotes=origin']);
  if (!engine.ok(listed)) throw new Error('无法枚举待上传历史');
  const candidates = new Map();
  for (const line of listed.out.split('\n')) {
    const match = /^([0-9a-f]{40,64}) (.+)$/.exec(line);
    if (match) candidates.set(match[1], match[2]);
  }
  const changes = await limited(['log', '--format=', '--name-only', '--diff-filter=ACMRT', '-z', head, '--not', '--remotes=origin', '--']);
  if (!engine.ok(changes)) throw new Error('无法检查待上传文件名');
  const nameFindings = [];
  for (const file of new Set(changes.out.split('\0').map(name => name.replace(/^\n+/, '')).filter(Boolean))) {
    const reasons = inspectContent(file, Buffer.alloc(0));
    if (reasons.length) nameFindings.push({ file, reasons });
  }
  const blobs = [], findings = [...nameFindings];
  const objects = [...candidates.keys()];
  for (let start = 0; start < objects.length; start += BATCH_OBJECTS) {
    const chunk = objects.slice(start, start + BATCH_OBJECTS);
    const metadata = await limited(['cat-file', '--batch-check'], chunk.join('\n') + '\n', 60000, false, BATCH_OBJECTS * 128);
    if (!engine.ok(metadata)) throw new Error('无法检查待上传对象');
    const rows = metadata.out.trimEnd().split('\n');
    if (rows.length !== chunk.length) throw new Error('待上传对象清单不完整');
    for (let i = 0; i < rows.length; i++) {
      const match = /^([a-f0-9]{40,64}) (blob|tree) (\d+)$/.exec(rows[i]);
      if (!match || match[1] !== chunk[i]) throw new Error('待上传对象格式不正确');
      const [, sha, type, sizeText] = match, size = Number(sizeText);
      if (!Number.isSafeInteger(size)) throw new Error('待上传对象大小不正确');
      if (type === 'tree') continue;
      if (size > MAX_FILE) { findings.push({ file: candidates.get(sha), reasons: ['内容超过单文件扫描上限'] }); continue; }
      blobs.push({ sha, size });
    }
  }
  let checked = 0, bytes = 0, batches = 0, next = 0;
  while (next < blobs.length) {
    const batch = []; let batchBytes = 0;
    while (next < blobs.length && batch.length < BATCH_OBJECTS
      && batchBytes + blobs[next].size <= MAX_BATCH) {
      const blob = blobs[next++]; batch.push(blob); batchBytes += blob.size;
    }
    const contents = await limited(['cat-file', '--batch'], batch.map(b => b.sha).join('\n') + '\n', 60000, true,
      batchBytes + BATCH_OBJECTS * 128);
    if (!engine.ok(contents)) throw new Error('无法读取待上传内容');
    let offset = 0;
    for (const blob of batch) {
      const newline = contents.out.indexOf(10, offset);
      const expected = blob.sha + ' blob ' + blob.size;
      if (newline < 0 || contents.out.subarray(offset, newline).toString('utf8') !== expected) throw new Error('待上传内容读取不完整');
      offset = newline + 1;
      const value = contents.out.subarray(offset, offset + blob.size);
      if (value.length !== blob.size || contents.out[offset + blob.size] !== 10) throw new Error('待上传内容读取不完整');
      offset += blob.size + 1;
      const reasons = inspectContent(candidates.get(blob.sha), value);
      if (reasons.length) findings.push({ file: candidates.get(blob.sha), reasons });
      checked++; bytes += blob.size;
    }
    if (offset !== contents.out.length) throw new Error('待上传内容包含未检查的额外数据');
    batches++;
    if (engine.progress?.running) engine.step('privacy', '检查待上传历史… ' + checked + '/' + blobs.length + ' 个内容对象');
  }
  if (engine.progress?.running && engine.progress.label.startsWith('检查待上传历史…'))
    engine.step('push', progressLabel || '准备上传已检查内容…');
  return { head, findings, checked, bytes, batches,
    limits: { fileBytes: MAX_FILE, batchBytes: MAX_BATCH, batchObjects: BATCH_OBJECTS, enumerationBytes: MAX_ENUM } };
}
