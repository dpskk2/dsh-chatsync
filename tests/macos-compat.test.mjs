import test from 'node:test';
import assert from 'node:assert/strict';
import { contentKind, transportable } from '../lib/scope.js';
import { invalidOnWindows, windowsUnsafeNewFiles } from '../lib/host-limits.js';
import { nativeCredentialHelper } from '../lib/engine/host-process.js';
import { explainRemoteSessionFailure, validateTransferSession } from '../lib/session-transfer.js';
import { jsonl, sessionId, logPath } from './fixtures/issue4-data.mjs';

test('files Finder and Explorer leave behind never enter the transport', () => {
  for (const file of [
    '.DS_Store',
    'sessions/.DS_Store',
    'sessions/issue4/.DS_Store',
    'attachments/.DS_Store',
    'attachments/._photo.png',
    'skills/my-skill/._SKILL.md',
    'skills/Thumbs.db',
    'attachments/desktop.ini',
  ])
    assert.equal(transportable(file), false, file);
  // A dot-file with an ordinary name is user data.
  for (const file of ['skills/my-skill/.prettierrc', 'attachments/_photo.png', 'attachments/a._b.png'])
    assert.equal(transportable(file), true, file);
  assert.equal(contentKind('sessions/.DS_Store'), 'sessions', 'classification alone would have transported it');
});

test('names Windows refuses stay out of new uploads, but shared files keep syncing', () => {
  for (const name of [
    'skills/a?b.md',
    'skills/a:b.md',
    'skills/x/NUL',
    'skills/com1.txt',
    'skills/end.',
    'skills/end ',
  ]) {
    assert.equal(invalidOnWindows(name), true, name);
  }
  for (const name of [
    'skills/中文 文件.md',
    'skills/console.md',
    'skills/.hidden',
    'attachments/ab/sha/photo (1).png',
  ]) {
    assert.equal(invalidOnWindows(name), false, name);
  }
  assert.deepEqual(
    windowsUnsafeNewFiles(['skills/a?b.md', 'skills/c?d.md', 'skills/ok.md'], new Set(['skills/c?d.md'])),
    ['skills/a?b.md'],
  );
});

test('each OS signs in through its own credential store', () => {
  assert.equal(nativeCredentialHelper('win32'), 'manager');
  assert.equal(nativeCredentialHelper('darwin'), 'osxkeychain');
});

test('a session an older host refuses says which computer to update', () => {
  for (const message of [
    'current-generation delivery marker names the wrong Session',
    'format v4 contains unknown event type "future/event" at seq 3',
  ])
    assert.match(explainRemoteSessionFailure(message), /更新到相同版本/);
  // A damaged log is not a version problem.
  assert.equal(explainRemoteSessionFailure('会话记录不完整或序号不连续：x'), '会话记录不完整或序号不连续：x');
});

// The same synthetic rows lib/session-transfer.js validates, through the installed official catalog.
const engine = { hostPath: undefined };
const header = {
  type: 'session',
  version: 4,
  id: sessionId,
  createdAt: 1700000000000,
  cwd: process.platform === 'win32' ? 'C:\\synthetic' : '/synthetic',
  isSeeded: false,
  delegationDepth: 0,
};
const title = seq => ({
  seq,
  time: 1700000000000 + seq,
  type: 'session/title',
  data: { title: 't' + seq, messageSeqs: [], source: { kind: 'user' } },
});

test('the supported host catalog accepts a v4 session and refuses an unknown required event', async () => {
  await validateTransferSession(engine, logPath, jsonl([header, title(0)]));
  await assert.rejects(
    validateTransferSession(
      { ...engine },
      logPath,
      jsonl([header, title(0), { seq: 1, time: 1700000000001, type: 'future/unknown-event', data: {} }]),
    ),
    /unknown event type/,
  );
});
