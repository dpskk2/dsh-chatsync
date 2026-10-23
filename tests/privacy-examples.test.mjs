import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectContent, inspectContentDetails } from '../lib/privacy.js';
import { syncIssues } from '../lib/diagnostics.js';
import { SyncEngine } from '../lib/sync.js';

test('explicit examples in test source do not block but real credentials in tests still do', () => {
  const marker = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
  const example = `assert.equal(inspectContent('key.txt', Buffer.from('${marker}')), true);\nconst password = 'fixture-webdav-secret';\nconst text = 'secret: test-only-do-not-expose';`;
  assert.deepEqual(inspectContent('tests/privacy.test.mjs', Buffer.from(example)), []);
  assert.deepEqual(inspectContent('tests/privacy.test-work-laptop.mjs', Buffer.from(example)), []);
  assert.ok(inspectContent('notes.txt', Buffer.from(example)).length > 0);
  const token = 'ghp_' + 'A'.repeat(40);
  assert.ok(inspectContent('tests/example.test.mjs', Buffer.from(token)).includes('GitHub 令牌格式'));
  assert.ok(inspectContent('tests/example.test.mjs', Buffer.from(marker + '\\n' + 'A'.repeat(80))).includes('私钥内容'));
  const password = ['correct', 'horse', 'battery', 'staple'].join('-');
  assert.ok(inspectContent('tests/example.test.mjs', Buffer.from('password: ' + password)).includes('疑似明文凭据字段'));
});

test('sensitive findings expose line numbers without matched credential values', () => {
  const value = 'sk-' + 'B'.repeat(40);
  const result = inspectContentDetails('tests/example.mjs', Buffer.from('first line\n' + value));
  assert.equal(result.matches[0].line, 2);
  assert.equal(result.reasons[0], '服务密钥格式');
  assert.ok(!JSON.stringify(result).includes(value));
});

test('parallel workspace failures retain independent reports and precise issues', () => {
  const engine = new SyncEngine('.');
  engine.recordPrivacyReport({ label: '工作区 A', workspaceId: 'a', root: '/project/a', findings: [{ file: 'key.txt', reasons: ['私钥内容'], matches: [{ line: 3 }] }] });
  engine.recordPrivacyReport({ label: '工作区 B', workspaceId: 'b', findings: [{ file: 'large.bin', reasons: ['内容超过单文件扫描上限'], size: 10 * 1048576, limit: 8 * 1048576 }] });
  const issues = syncIssues({ privacy: engine._privacyReport, privacyReports: engine._privacyReports, workspaces: { errors: [{ id: 'a', title: 'A', error: 'push' }, { id: 'b', title: 'B', error: 'push' }] } });
  assert.equal(issues.length, 2);
  assert.equal(issues[0].code, 'SENSITIVE_CONTENT'); assert.deepEqual(issues[0].lines, [3]);
  assert.equal(issues[1].code, 'SCAN_FILE_TOO_LARGE'); assert.match(issues[1].reason, /10.0 MiB.*8 MiB/);
});
