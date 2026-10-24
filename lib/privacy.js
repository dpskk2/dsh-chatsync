import { ZSTD_MAGIC, decodeZstdFrames, parseSessionLog } from './merge.js';
import { sessionIdOfLogPath } from './session-path.js';

const MAX_FILE = 8 * 1024 * 1024;
export const MAX_SESSION_BYTES = 256 * 1024 * 1024;
const MAX_BATCH = 8 * 1024 * 1024;
const BATCH_OBJECTS = 256;
const MAX_ENUM = 32 * 1024 * 1024;

const fileLimit = file => sessionIdOfLogPath(file) ? MAX_SESSION_BYTES : MAX_FILE;

// Both normal and exit snapshots use the same bounded command protocol.
// Inspect staged changes, not every unchanged file in the project.
function* snapshotSizeCommands() {
  const listing = yield { args: ['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '--no-ext-diff', '--no-color', '--diff-filter=ACMT', '-z', '--'],
    failure: '无法检查工作区暂存文件大小', cap: MAX_ENUM };
  if (listing.out && !listing.out.endsWith('\0')) throw new Error('工作区暂存文件清单不完整');
  const fields = listing.out.split('\0'); fields.pop();
  if (fields.length % 2) throw new Error('工作区暂存文件清单不完整');
  const files = [];
  for (let i = 0; i < fields.length; i += 2) {
    const row = /^:\d{6} (\d{6}) [a-f0-9]{40,64} ([a-f0-9]{40,64}) [ACMT]$/.exec(fields[i]);
    if (!row || !fields[i + 1]) throw new Error('工作区暂存文件清单不完整');
    if (row[1] !== '160000') files.push({ file: fields[i + 1], object: row[2] });
  }
  const findings = [];
  for (let start = 0; start < files.length; start += BATCH_OBJECTS) {
    const batch = files.slice(start, start + BATCH_OBJECTS);
    const metadata = yield { args: ['cat-file', '--batch-check'], input: batch.map(f => f.object).join('\n') + '\n',
      failure: '无法检查工作区暂存对象大小', cap: BATCH_OBJECTS * 128 };
    const rows = metadata.out.trimEnd().split('\n');
    if (rows.length !== batch.length) throw new Error('工作区暂存对象清单不完整');
    for (let i = 0; i < rows.length; i++) {
      const match = /^([a-f0-9]{40,64}) blob (\d+)$/.exec(rows[i]);
      if (!match || match[1] !== batch[i].object || !Number.isSafeInteger(Number(match[2]))) throw new Error('工作区暂存对象格式不正确');
      const size = Number(match[2]), limit = fileLimit(batch[i].file);
      if (size > limit) findings.push({ ...batch[i], size, limit, reasons: ['内容超过单文件扫描上限'] });
    }
  }
  if (!findings.length) return findings;
  // Renames/copies can reuse a blob already in this repository's history.
  // Keeping it in another snapshot adds no new oversized object. The complete
  // outgoing scan still blocks any such object that has never been uploaded.
  const head = yield { args: ['rev-parse', '--verify', 'HEAD'], optional: true, cap: 128 };
  if (!head || !/^[a-f0-9]{40,64}$/.test(head.out.trim())) return findings;
  const history = yield { args: ['rev-list', '--objects', head.out.trim()],
    failure: '无法检查工作区已有对象', cap: MAX_ENUM };
  const existing = new Set(history.out.split('\n').map(line => /^([a-f0-9]{40,64})(?: |$)/.exec(line)?.[1]).filter(Boolean));
  return findings.filter(f => !existing.has(f.object));
}

export async function checkWorkspaceSnapshotSizes(engine, gitdir, root) {
  const prefix = ['--git-dir=' + gitdir, '--work-tree=' + root], commands = snapshotSizeCommands();
  let step = commands.next();
  while (!step.done) {
    const command = step.value;
    const result = await engine.gitInput([...prefix, ...command.args], command.input || '', 60000, false, { maxOutputBytes: command.cap });
    if (!engine.ok(result) && !command.optional) throw new Error(command.failure);
    step = commands.next(engine.ok(result) ? result : null);
  }
  return step.value;
}

export function checkWorkspaceSnapshotSizesSync(engine, gitdir, root) {
  const commands = snapshotSizeCommands(); let step = commands.next();
  while (!step.done) {
    const command = step.value;
    const result = engine.gitWSync(gitdir, root, command.args, 20000,
      { input: command.input, maxOutputBytes: command.cap });
    if (!engine.ok(result) && !command.optional) throw new Error(command.failure);
    step = commands.next(engine.ok(result) ? result : null);
  }
  return step.value;
}

// Preserve actionable Git messages while keeping common credentials out of
// user-visible status, copied diagnostics and the local status journal.
export function redactGitDiagnostic(value) {
  return String(value || '')
    .replace(/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z ]+ )?PRIVATE KEY-----|$)/g, '[已隐藏私钥]')
    .replace(/(https?:\/\/)[^/\s@]+@/gi, '$1[已隐藏]@')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, '[已隐藏令牌]')
    .replace(/\bsk-[A-Za-z0-9_-]{24,}\b|\bAKIA[A-Z0-9]{16}\b/g, '[已隐藏密钥]')
    .replace(/((?:api[-_]?key|access[-_]?token|password|secret)\s*["']?\s*[:=]\s*["']?)([^\s"'<>]+)/gi, '$1[已隐藏]')
    .slice(0, 4096);
}

// Recognize explicit synthetic examples, not every value in a test file.
const testSource = file => /(?:^|\/)(?:tests?|__tests__|fixtures?)\/.*\.(?:[cm]?[jt]sx?|py|rb|go)$/i.test(file);
export function inspectContentDetails(file, buffer) {
  const reasons = [];
  const matches = [];
  if (buffer.length && sessionIdOfLogPath(file) && !parseSessionLog(buffer)) reasons.push('会话记录不完整或序号不连续');
  if (/(?:^|\/)(?:\.env(?:\.[^/]+)?|id_(?:rsa|ed25519)|credentials[^/]*|[^/]+\.(?:pem|p12|pfx|key|kdbx))$/i.test(file)
    && !/(?:\.example|\.sample|\.template)$/i.test(file)) reasons.push('敏感文件名');
  let text;
  if (buffer.subarray(0, 4).equals(ZSTD_MAGIC)) {
    text = decodeZstdFrames(buffer, sessionIdOfLogPath(file) ? MAX_SESSION_BYTES : MAX_FILE);
    if (text === null) return { reasons: [...reasons, '压缩会话无法在扫描上限内完整读取'], matches };
  } else if (!buffer.includes(0)) text = buffer.toString('utf8');
  if (text) {
    const record = (reason, pattern, example = () => false) => {
      let reported = 0;
      for (const match of text.matchAll(pattern)) {
        if (example(match)) continue;
        reasons.push(reason);
        matches.push({ reason, line: text.slice(0, match.index).split('\n').length });
        if (++reported >= 20) break;
      }
    };
    record('私钥内容', /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g, match => {
      // A quoted header alone in test source is a detector fixture, not key data.
      // Header + escaped/newline payload, and headers in ordinary files still block.
      const quote = text[match.index - 1];
      return testSource(file) && (quote === '"' || quote === "'") && text[match.index + match[0].length] === quote;
    });
    record('GitHub 令牌格式', /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g);
    record('服务密钥格式', /\bsk-[A-Za-z0-9_-]{24,}\b|\bAKIA[A-Z0-9]{16}\b/g);
    record('疑似明文凭据字段', /(?:api[-_]?key|access[-_]?token|password|secret)\s*["']?\s*[:=]\s*["']?([A-Za-z0-9_+/.=-]{20,})/gi,
      match => testSource(file) && /^(?:fixture|test-only|example|placeholder|dummy)(?:-[a-z]+)+$/.test(match[1]));
  }
  return { reasons: [...new Set(reasons)], matches };
}

export function inspectContent(file, buffer) { return inspectContentDetails(file, buffer).reasons; }

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
      const limit = fileLimit(candidates.get(sha));
      if (size > limit) { findings.push({ file: candidates.get(sha), object: sha, size, limit, reasons: ['内容超过单文件扫描上限'] }); continue; }
      blobs.push({ sha, size });
    }
  }
  let checked = 0, bytes = 0, batches = 0, next = 0;
  while (next < blobs.length) {
    const batch = []; let batchBytes = 0;
    while (next < blobs.length && batch.length < BATCH_OBJECTS
      && (batchBytes + blobs[next].size <= MAX_BATCH || !batch.length)) {
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
      const inspection = inspectContentDetails(candidates.get(blob.sha), value);
      if (inspection.reasons.length) findings.push({ file: candidates.get(blob.sha), object: blob.sha, size: blob.size, ...inspection });
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
