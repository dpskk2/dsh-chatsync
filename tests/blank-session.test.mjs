/**
 * 回归:未分组统计必须与 DSH 侧栏的可见性口径一致。
 *
 * 背景(0.12.14 实测):DSH 客户端把「从未开始过轮次」的空白会话(blank)从侧栏过滤掉
 * ——dsh-client-ui-workspace 的 sessionVisible():`session.blank && id !== current → 不渲染`,
 * 且「未分组」分组只在 stray.length > 0 时创建;blank 判定见 dsh-api-session-controller
 * `blank = state.blank && type !== 'turn/start'`。插件原先只做「磁盘会话 − 登记表」差集,
 * 于是把这类看不见的空会话也报成未分组,让引导浮层/状态行长期显示「N 个会话未分组」,
 * 而用户在侧栏既看不到也无法处理。
 *
 * 本文件覆盖:空白会话被排除、有轮次的仍计入、明文日志同样判定、多帧/帧边界切断 JSON 行、
 * 判定缓存随日志追加失效、无法判定时保守计入,以及扫描/幽灵清理口径不受影响。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as zlib from 'node:zlib';
import { SyncEngine } from '../lib/sync.js';

const { zstdCompressSync } = zlib;

const GROUP = '--C-Users-test-default-workspace--';
const CWD = 'C:\\Users\\test\\default-workspace';
const ID_A = 'session-11111111-1111-4111-8111-111111111111';
const ID_B = 'session-22222222-2222-4222-8222-222222222222';
const ID_C = 'session-33333333-3333-4333-8333-333333333333';

const jsonl = (rows) => Buffer.from(rows.map((r) => JSON.stringify(r) + '\n').join(''));

/** 每个事件单独压成一帧 —— 与真实 DSH 的拼接多帧日志一致 */
function zstdFrames(rows) {
  return Buffer.concat(rows.map((r) => zstdCompressSync(jsonl([r]))));
}

function makeHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-blank-session-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

/** 写一个会话目录;compress=false 写明文 session.jsonl,raw 直接给字节(损坏/手工帧用) */
function writeSession(home, id, rows, { name = 'session.v4.jsonl.zstd', compress = true, raw = null } = {}) {
  const sdir = path.join(home, 'sessions', GROUP, id);
  fs.mkdirSync(sdir, { recursive: true });
  const all = [{ type: 'session', version: 4, id, cwd: CWD }, ...rows];
  const buf = raw ? raw : (compress ? zstdFrames(all) : jsonl(all));
  const file = path.join(sdir, name);
  fs.writeFileSync(file, buf);
  return { sdir, file };
}

function writeRegistry(home, sessionIds = []) {
  fs.mkdirSync(path.join(home, 'storages'), { recursive: true });
  fs.writeFileSync(path.join(home, 'storages', 'workspace.json'), JSON.stringify({
    global: { workspaceIds: ['w1'], archivedSessionIds: [] },
    tables: { workspaces: { w1: { path: CWD, title: 'default-workspace', sessionIds, createdAt: 'x', updatedAt: 'x' } } },
  }, null, 2));
}

/** 空白会话:DSH 里就是「点过新会话但没发消息」——只有预设/沙箱/end-seed,没有 turn/start */
const blankRows = [
  { type: 'permission/preset', seq: 0, time: 1, data: { preset: 'workspace-write' } },
  { type: 'session/end-seed', seq: 1, time: 2, data: {} },
];
const turnRows = [
  { type: 'turn/start', seq: 0, time: 1, data: {} },
  { type: 'session/end-seed', seq: 1, time: 2, data: {} },
];

test('空白会话(从未 turn/start)不再计入未分组', { skip: !zstdCompressSync }, (t) => {
  const home = makeHome(t);
  writeSession(home, ID_A, blankRows);
  assert.deepEqual(new SyncEngine(home).ungroupedSessionIds(), []);
});

test('开始过轮次的会话仍然计入未分组', { skip: !zstdCompressSync }, (t) => {
  const home = makeHome(t);
  writeSession(home, ID_A, blankRows);
  writeSession(home, ID_B, turnRows);
  assert.deepEqual(new SyncEngine(home).ungroupedSessionIds(), [ID_B]);
});

test('已登记的空白会话同样不计入(登记表优先,与是否空白无关)', { skip: !zstdCompressSync }, (t) => {
  const home = makeHome(t);
  writeSession(home, ID_A, blankRows);
  writeSession(home, ID_B, turnRows);
  writeRegistry(home, [ID_A, ID_B]);
  assert.deepEqual(new SyncEngine(home).ungroupedSessionIds(), []);
});

test('明文 session.jsonl 也按 turn/start 判定', (t) => {
  const home = makeHome(t);
  writeSession(home, ID_A, blankRows, { name: 'session.jsonl', compress: false });
  writeSession(home, ID_B, turnRows, { name: 'session.jsonl', compress: false });
  assert.deepEqual(new SyncEngine(home).ungroupedSessionIds(), [ID_B]);
});

test('帧边界切断一行 JSON 时仍能识别 turn/start', { skip: !zstdCompressSync }, (t) => {
  const home = makeHome(t);
  const head = JSON.stringify({ type: 'session', version: 4, id: ID_C, cwd: CWD }) + '\n';
  const turn = JSON.stringify({ type: 'turn/start', seq: 0, time: 1 }) + '\n';
  const raw = Buffer.concat([
    zstdCompressSync(Buffer.from(head + turn.slice(0, 12))),
    zstdCompressSync(Buffer.from(turn.slice(12))),
  ]);
  writeSession(home, ID_C, [], { raw });
  assert.deepEqual(new SyncEngine(home).ungroupedSessionIds(), [ID_C]);
});

test('日志追加轮次后判定缓存失效(同一引擎实例内)', { skip: !zstdCompressSync }, (t) => {
  const home = makeHome(t);
  const { file } = writeSession(home, ID_A, blankRows);
  const engine = new SyncEngine(home);
  assert.deepEqual(engine.ungroupedSessionIds(), []);
  fs.appendFileSync(file, zstdCompressSync(jsonl([{ type: 'turn/start', seq: 2, time: 3 }])));
  assert.deepEqual(engine.ungroupedSessionIds(), [ID_A]);
});

test('无法判定的日志按「有轮次」保守处理(宁可多报,不静默忽略真会话)', { skip: !zstdCompressSync }, (t) => {
  const home = makeHome(t);
  const good = Buffer.concat([
    zstdCompressSync(jsonl([{ type: 'session', version: 4, id: ID_A, cwd: CWD }])),
    zstdCompressSync(jsonl([{ type: 'permission/preset', seq: 0, time: 1 }])),
  ]);
  writeSession(home, ID_A, [], { raw: good.subarray(0, good.length - 2) }); // 末帧截断
  assert.deepEqual(new SyncEngine(home).ungroupedSessionIds(), [ID_A]);
});

test('扫描/幽灵清理口径不受影响:localSessionIds 仍包含空白会话', { skip: !zstdCompressSync }, (t) => {
  const home = makeHome(t);
  writeSession(home, ID_A, blankRows);
  writeSession(home, ID_B, turnRows);
  const engine = new SyncEngine(home);
  assert.deepEqual([...engine.localSessionIds()].sort(), [ID_A, ID_B]);
  assert.deepEqual(engine.ungroupedSessionIds(), [ID_B]);
});
