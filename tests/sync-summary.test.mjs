import assert from 'node:assert/strict';
import test from 'node:test';
import { summarize, lastDetail } from '../lib/http/summary.js';

test('a completed no-change sync has the current message', () => {
  assert.equal(summarize({}), '已是最新,无需变更');
});

test('workspace errors are reported even when discovery failed before counting projects', () => {
  const result = { workspaces: { total: 0, errors: [{ error: '网络连接失败' }] } };
  assert.equal(summarize(result), '工作区失败: 项目（网络连接失败）');
  assert.equal(lastDetail(result).workspaces.errors.length, 1);
});

test('a deferred sync is never summarized as current', () => {
  assert.equal(
    summarize({ deferred: true, message: '正在后台重新核对上次未完成的同步。' }),
    '正在后台重新核对上次未完成的同步。',
  );
  assert.equal(summarize({ deferred: true }), '同步尚未完成，请稍后重试。');
  assert.equal(lastDetail({ deferred: true }).deferred, true);
});

test('a deferred sync with an error reports the failure', () => {
  assert.equal(summarize({ deferred: true, error: 'network' }), '未完成: network');
});
