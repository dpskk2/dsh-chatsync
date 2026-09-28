import test from 'node:test';
import assert from 'node:assert/strict';
import * as zlib from 'node:zlib';
import { mergeSessionLog, decodeZstdFrames, decodeZstdFirstFrame } from '../lib/merge.js';
const { zstdCompressSync } = zlib;

const header = { type: 'session', version: 4, id: 'test' };
const encode = (rows) => Buffer.from(rows.map(JSON.stringify).join('\n') + '\n');

test('append-only histories retain bytes, references and event order', () => {
  const base = [header, { type: 'chunk', seq: 0, time: 2 }];
  const long = encode([...base, { type: 'message', seq: 1, time: 1, sourceEventSeqs: [0], surfaceOp: { replace: [0] } }]);
  for (const [a, b] of [[encode(base), long], [long, encode(base)]]) {
    assert.deepEqual(mergeSessionLog(a, b).value, long);
  }
});

test('overlapping sequence numbers on independent branches are never mixed', () => {
  const a = encode([header, { type: 'chunk', seq: 0, time: 1 }, { type: 'message', seq: 1, time: 3, sourceEventSeqs: [0] }]);
  const b = encode([header, { type: 'chunk', seq: 0, time: 2 }, { type: 'message', seq: 1, time: 4, sourceEventSeqs: [0] }]);
  assert.deepEqual(mergeSessionLog(a, b), { ok: false, reason: 'divergent-session-history' });
  assert.equal(mergeSessionLog(b, a).ok, false);
});

test('rewritten seeds, different headers and malformed rows are not normalized', () => {
  assert.equal(mergeSessionLog(encode([header, { type: 'session/end-seed', time: 1 }]), encode([header, { type: 'session/end-seed', time: 2 }])).ok, false);
  assert.equal(mergeSessionLog(encode([header]), encode([{ ...header, version: 5 }])).reason, 'header-mismatch');
  assert.equal(mergeSessionLog(encode([header]), Buffer.concat([encode([header]), Buffer.from('{broken')])).ok, false);
});

test('concatenated compressed frames are read completely and preserved without recompression', { skip: !zstdCompressSync }, () => {
  const prefix = zstdCompressSync(encode([header]));
  const full = Buffer.concat([prefix, zstdCompressSync(encode([{ type: 'event', seq: 0, time: 1 }]))]);
  assert.equal(decodeZstdFrames(full), encode([header, { type: 'event', seq: 0, time: 1 }]).toString());
  assert.deepEqual(mergeSessionLog(prefix, full).value, full);
  const truncated = full.subarray(0, full.length - 2);
  assert.equal(decodeZstdFrames(truncated), null);
  assert.equal(decodeZstdFirstFrame(truncated), encode([header]).toString());
  assert.equal(mergeSessionLog(prefix, truncated).ok, false);
});

test('frame boundaries do not depend on magic bytes inside raw content', { skip: !zstdCompressSync }, () => {
  const content = Buffer.from([40, 181, 47, 253, 65]);
  // Single-segment frame, raw final block, deliberately containing the magic.
  const frame = Buffer.concat([Buffer.from([40, 181, 47, 253, 32, 5, 41, 0, 0]), content]);
  assert.equal(decodeZstdFrames(frame), content.toString('utf8'));
  for (let cut = 4; cut < frame.length; cut++) assert.equal(decodeZstdFrames(frame.subarray(0, cut)), null);
  const skip = Buffer.from([80, 42, 77, 24, 1, 0, 0, 0, 42]);
  assert.equal(decodeZstdFrames(Buffer.concat([frame, skip, frame])), Buffer.concat([content, content]).toString('utf8'));
});
