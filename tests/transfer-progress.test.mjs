import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine, parseTransfer } from '../lib/sync.js';

test('carriage return progress reports the latest percentage and supports split chunks', () => {
  const text = 'Receiving objects: 12% (12/100), 1.00 MiB | 1.00 MiB/s\rReceiving objects: 72% (72/100), 6.00 MiB | 2.00 MiB/s\r';
  assert.equal(parseTransfer(text).pct, 72);
  assert.equal(parseTransfer(text).size, 6 * 1048576);
  const engine = new SyncEngine('.');
  engine.step('fetch', 'download');
  engine.liveTransfer('fetch', 'main', text.slice(0, 95));
  engine.liveTransfer('fetch', 'main', text.slice(95));
  assert.equal(engine.progress.transfer.pct, 72);
  engine.step('analyze', 'check');
  assert.equal(engine.progress.transfer, null, 'a completed transfer cannot stand in for the next stage');
});

test('lock polling updates live progress without duplicating the elapsed-time stage', () => {
  const engine = new SyncEngine('.');
  engine.step('wait-lock', '等待上次同步结束');
  const first = engine._stages[0].at;
  for (let i = 0; i < 80; i++) engine.step('wait-lock', '等待上次同步结束');
  assert.equal(engine._stages.length, 1);
  assert.equal(engine._stages[0].at, first);
  assert.equal(engine.progress.label, '等待上次同步结束');
  engine.step('verify', '连接仓库');
  assert.deepEqual(engine._stages.map(s => s.stage), ['wait-lock', 'verify']);
});
