import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { zstdCompressSync } from 'node:zlib';
import { conversationPresentation, recoveryPresentation } from '../lib/recovery-presentation.js';
import { RecoveryStore } from '../lib/recovery.js';
import { recordSessionTitle } from '../lib/session-info.js';

const event = (type, data, seq, extra = {}) => ({ type, data, seq, time: 1, surfaceOp: 'append', ...extra });
const user = (text, seq, kind = 'user', extra = {}) =>
  event(
    'user/message',
    { id: 'u-' + seq, role: 'user', source: { kind }, content: [{ type: 'text', text }] },
    seq,
    extra,
  );
const assistant = (text, seq, extra = {}) =>
  event(
    'assistant/message',
    { message: { id: 'a-' + seq, role: 'assistant', content: [{ type: 'text', text }] } },
    seq,
    extra,
  );
const log = events =>
  [{ type: 'session', version: 4, id: 'session-example', cwd: 'C:/fixture' }, ...events]
    .map(v => JSON.stringify(v))
    .join('\n') + '\n';
const record = { path: 'sessions/project/session-example/session.v4.jsonl.zstd' };

test('human conversation excludes injected user-role context, inbox echoes and system requests', () => {
  const text = log([
    event('agent/inbox/spliced', { inserted: [{ content: [{ type: 'text', text: '你好' }] }] }, 0),
    user('你好', 1),
    ...['agent-instructions', 'runtime-context', 'skill-catalog', 'time-context'].map((kind, i) =>
      user('INTERNAL-' + kind, i + 2, kind),
    ),
    event('system/message', { message: { role: 'system', content: [{ type: 'text', text: 'SYSTEM' }] } }, 6),
    event('request/header', { system: 'REQUEST' }, 7),
    assistant('你好！👋\n\n有什么可以帮你的吗？', 8),
  ]);
  const view = recoveryPresentation(record, zstdCompressSync(Buffer.from(text)));
  assert.equal(view.kind, 'conversation');
  assert.equal(view.total, 2);
  assert.deepEqual(
    view.messages.map(m => m.role),
    ['user', 'assistant'],
  );
  assert.equal(view.messages[0].content[0].text, '你好');
  assert.equal(view.messages[1].content[0].text, '你好！👋\n\n有什么可以帮你的吗？');
  assert.doesNotMatch(JSON.stringify(view), /INTERNAL|SYSTEM|REQUEST/);
});

test('conversation retains seen append-origin replies and excludes replacement copies and reasoning', () => {
  const answer = assistant('已完成', 2);
  answer.data.message.content.unshift({ type: 'reasoning', text: 'INTERNAL REASONING' });
  const view = conversationPresentation(
    log([
      user('原问题', 0),
      assistant('原回答', 1),
      answer,
      assistant('模型用的压缩替代', 3, { surfaceOp: { op: 'replace', start: 0, end: 2 } }),
    ]),
  );
  assert.deepEqual(
    view.messages.map(m => m.content[0].text),
    ['原问题', '原回答', '已完成'],
  );
  assert.doesNotMatch(JSON.stringify(view), /INTERNAL|压缩替代/);
});

test('full message projection reaches replies beyond raw text preview limits and pages by visible messages', () => {
  const rows = [user('hidden'.repeat(30000), 0, 'runtime-context')];
  for (let i = 0; i < 180; i++) rows.push(i % 2 ? assistant('回答 ' + i, i + 1) : user('问题 ' + i, i + 1));
  const text = log(rows);
  const first = conversationPresentation(text),
    second = conversationPresentation(text, { offset: first.nextOffset }),
    last = conversationPresentation(text, { offset: second.nextOffset });
  assert.equal(first.total, 180);
  assert.deepEqual([first.messages.length, second.messages.length, last.messages.length], [80, 80, 20]);
  assert.equal(first.messages[0].content[0].text, '问题 0');
  assert.equal(last.messages.at(-1).content[0].text, '回答 179');
  assert.equal(last.hasMore, false);
});

test('reading a saved original and paging never rewrites its bytes or record', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-readable-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const store = new RecoveryStore(home);
  const buffer = zstdCompressSync(Buffer.from(log([user('one', 0), assistant('two', 1)])));
  const saved = store.save({ ...record, kind: 'main', status: 'merged' }, { local: buffer, remote: buffer });
  const metadata = fs.readFileSync(store.recordPath(saved.id));
  const view = store.preview(saved.id, { offsets: { local: 1 } });
  assert.equal(view.local.presentation.messages[0].role, 'assistant');
  assert.equal(view.remote.presentation.messages[0].role, 'user');
  assert.deepEqual(store.version(saved, 'local'), buffer);
  assert.deepEqual(fs.readFileSync(store.recordPath(saved.id)), metadata);
});

test('session cache shows usable title and directory rather than event clocks and runtime counters', () => {
  const value = {
    record: {
      rows: {
        title: { val: '问候', seq: 9 },
        workingDirectory: { val: 'C:/project', seq: 20 },
        tokenUsage: { val: 99, seq: 21 },
      },
    },
  };
  const view = recoveryPresentation(
    { path: 'storages/session_projcache/sessions/a.json' },
    Buffer.from(JSON.stringify(value)),
  );
  assert.equal(view.kind, 'fields');
  assert.deepEqual(view.fields, [
    { name: '标题', value: '问候' },
    { name: '工作目录', value: 'C:/project' },
  ]);
  assert.doesNotMatch(JSON.stringify(view), /seq|tokenUsage/);
});

test('settings and merge ledgers display actual values, mask credentials and never evaluate expressions', () => {
  const ledger = recoveryPresentation(
    { path: 'storages/sync-meta/settings.yaml.vmap.json' },
    Buffer.from(
      JSON.stringify({
        theme: { clock: 5, value: 'dark' },
        apiKey: { clock: 1, value: 'not-a-real-key' },
        enabled: { clock: 2, value: true },
      }),
    ),
  );
  assert.ok(ledger.fields.some(field => field.name === '主题' && field.value === 'dark'));
  assert.ok(ledger.fields.some(field => field.name === '启用' && field.value === '开启'));
  assert.doesNotMatch(JSON.stringify(ledger), /not-a-real-key|clock/);
  const yaml = recoveryPresentation(
    { path: 'profiles/desktop/cordis.patch.yml' },
    Buffer.from('- id: app\n  config:\n    fontSize: 18\n    value: !!js doNotExecute()\n'),
  );
  assert.equal(yaml.kind, 'fields');
  assert.ok(yaml.fields.some(field => field.value === '18'));
  assert.ok(yaml.fields.some(field => field.value === '动态配置：doNotExecute()'));
});

test('project membership, images, binary files and text each have a readable presentation', () => {
  const projects = recoveryPresentation(
    { path: 'storages/workspace.json' },
    Buffer.from(
      JSON.stringify({
        tables: { workspaces: { w: { title: '项目 A', path: 'C:/a', sessionIds: ['a', 'b'] } } },
        global: { archivedSessionIds: ['old'] },
      }),
    ),
  );
  assert.equal(projects.projects[0].sessions, 2);
  assert.equal(projects.archived, 1);
  const image = recoveryPresentation({ path: 'attachments/picture.png' }, Buffer.from([137, 80, 78, 71, 0]));
  assert.equal(image.kind, 'image');
  assert.match(image.url, /^data:image\/png;base64,/);
  assert.equal(recoveryPresentation({ path: 'project/report.docx' }, Buffer.from([0, 1, 2])).kind, 'file');
  assert.equal(recoveryPresentation({ path: 'project/note.md' }, Buffer.from('# Note')).kind, 'markdown');
});

test('damaged lines are signalled without inventing messages; attachment metadata stays readable', () => {
  const message = user('查看图片', 0);
  message.data.content.push({ type: 'image', attachment: { name: 'example.png', size: 100 } });
  const view = conversationPresentation(log([message]) + '{broken\n');
  assert.equal(view.incomplete, true);
  assert.deepEqual(view.messages[0].content[1], {
    type: 'attachment',
    name: 'example.png',
    mediaType: 'image',
    bytes: 100,
  });
});

test('Chinese plugin metadata is exported and included in the package', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
  const zh = JSON.parse(fs.readFileSync(new URL('../locale/zh.json', import.meta.url)));
  assert.equal(zh.meta.title, '同步');
  assert.equal(pkg.exports['./locale/*'], './locale/*');
  assert.ok(pkg.files.includes('locale/*.json'));
});

test('a saved list cache supplies its own title even when the original session is no longer on disk', () => {
  const bytes = Buffer.from(JSON.stringify({ record: { rows: { title: { val: '问候' } } } }));
  const engine = {
    home: 'C:/nonexistent-fixture',
    loadConfig: () => ({ remote: '' }),
    recovery: { version: () => bytes },
  };
  assert.equal(
    recordSessionTitle(engine, {
      id: 'record',
      path: 'storages/session_projcache/sessions/session-00000000-0000-4000-8000-000000000001.json',
    }),
    '问候',
  );
});
