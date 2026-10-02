/**
 * 回归测试:识别「会话正在生成」→ 自动重启守卫。
 *
 * 安全性约束(本文件必须遵守):
 *  - 绝不触发真实 schtasks 重启:守卫相关的 3 个用例用 process.argv 伪装 Web 宿主
 *    (见 asWebHost),但临时 home 内不存在 restart-dsh-web.ps1,守卫放行时只会落到
 *    missing-script;其余用例在非 Web 宿主下只会落到 unsupported-host。
 *    因此本文件任何路径都不会创建/运行 schtasks 任务。
 *  - 绝不配置真实 remote / 不做任何 git 网络操作。
 *  - 所有临时目录用 fs.mkdtempSync 创建,并在 t.after 中清理。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { probeSessionActivity } from '../lib/session-activity.js';
import { SyncEngine } from '../lib/sync.js';

const WINDOW = 120000; // restartGuard.activityWindowMs 默认值

test('automatic restart waits for transfer completion, result persistence and lock release', async t => {
  const engine = new SyncEngine(tempHome(t), { autoRepo: false });
  let finish, released = false, scheduled = 0;
  engine.acquireProcessLock = () => () => { released = true; };
  engine._syncOnce = () => new Promise(resolve => { finish = resolve; });
  engine.autoRestartHost = () => 'web';
  engine.sessionActivity = () => ({ available: true, activeCount: 0 });
  engine.scheduleRestartAfterRepair = () => {
    scheduled++;
    assert.equal(released, true);
    assert.equal(engine.progress.running, false);
    assert.ok(engine.lastOutcome);
    return true;
  };
  const running = engine.syncOnce();
  assert.equal(scheduled, 0);
  assert.equal(released, false);
  finish({ restartRequired: true, workspaces: { errors: [] } });
  const result = await running;
  assert.equal(scheduled, 1);
  assert.equal(result.restartRequired, false);
});

test('automatic restart leaves a manual prompt for unknown activity, active sessions and transfer failure', t => {
  const engine = new SyncEngine(tempHome(t), { autoRepo: false });
  engine.autoRestartHost = () => 'web';
  engine.scheduleRestartAfterRepair = () => { assert.fail('must not schedule a real or simulated restart'); };
  for (const [activity, errors] of [
    [{ available: false, activeCount: 0 }, []],
    [{ available: true, activeCount: 1 }, []],
    [{ available: true, activeCount: 0 }, [{ error: 'push' }]],
  ]) {
    engine.sessionActivity = () => activity;
    const result = { restartRequired: true, workspaces: { errors } };
    assert.equal(engine.maybeScheduleRepairRestart(result), false);
    assert.equal(result.restartRequired, true);
  }
});

test('unreadable session storage is unknown rather than confirmed idle', t => {
  const result = probeSessionActivity(null, { home: path.join(tempHome(t), 'missing') });
  assert.equal(result.available, false);
  assert.equal(result.source, 'none');
});

/** 建一个临时 DSH home,并注册 t.after 清理(带路径自检,避免误删) */
function tempHome(t, prefix = 'dsh-restart-guard-') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(home)), path.resolve(os.tmpdir()));
    assert.match(path.basename(home), new RegExp('^' + prefix));
    fs.rmSync(home, { recursive: true, force: true });
  });
  return home;
}

/** v3 会话目录名必须是 session-<uuid> */
function sessionId() {
  const id = 'session-' + randomUUID();
  assert.match(id, /^session-[0-9a-f-]{36}$/);
  return id;
}

/**
 * 写入会话日志并设置 mtime。
 * 真实布局是 sessions/<分组>/session-<uuid>/session.v3.jsonl.zstd(与 lib/sync.js
 * 的 scanSessions() 一致);task-3 文字里省略了分组层,所以两种布局各写一份,
 * 避免把测试绑死在某一种目录枚举实现上。会话目录名统一 session-<uuid>,
 * 文件名统一 session.v3.jsonl.zstd。
 * @returns {string[]} 已写入的日志文件路径列表
 */
function writeSessionLog(home, id, mtime) {
  const files = [];
  for (const dir of [path.join(home, 'sessions', 'g1', id), path.join(home, 'sessions', id)]) {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'session.v3.jsonl.zstd');
    fs.writeFileSync(file, 'session-v3-placeholder');
    files.push(file);
  }
  if (mtime) {
    for (const file of files) fs.utimesSync(file, new Date(mtime), new Date(mtime));
  }
  return files;
}

/** 假的 agents 服务 ctx:get('agents') → { list() } */
function agentsCtx(sessions) {
  return { get: (name) => (name === 'agents' ? { list: () => sessions } : undefined) };
}

/** 没有 agents 服务的 ctx */
const noAgentsCtx = { get: () => undefined };

const IS_WIN = process.platform === 'win32';

/**
 * 把进程伪装成 DSH Web 宿主(与 tests/restart-host.test.mjs 同法)。
 * 为什么需要:实现里守卫位于宿主判定**之后**,只有走到 Web 宿主路径才可能命中
 * 「守卫拦下」分支。临时 home 内不存在 restart-dsh-web.ps1,所以失败时最多落到
 * missing-script —— 本文件任何路径都不会创建/运行 schtasks 任务。
 */
function asWebHost(fn) {
  const saved = process.argv;
  try {
    process.argv = ['node.exe', 'C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js', 'web'];
    return fn();
  } finally {
    process.argv = saved;
  }
}

test('agents 服务可用且有一个 running 会话 → source=agents 且 activeIds 命中', async (t) => {
  const home = tempHome(t);
  const running = sessionId();
  const ctx = agentsCtx([
    { id: running, status: 'running' },
    { id: sessionId(), status: 'idle' },
  ]);
  const r = await probeSessionActivity(ctx, { now: Date.now(), activityWindowMs: WINDOW, home });
  assert.equal(r.available, true);
  assert.equal(r.source, 'agents');
  assert.equal(r.activeCount, 1);
  assert.deepEqual(r.activeIds, [running]);
  assert.ok(Number.isFinite(r.checkedAt), 'checkedAt 应为数字时间戳');
});

test('agents 服务全为 idle → activeCount=0 但 available 仍为 true', async (t) => {
  const home = tempHome(t);
  const ctx = agentsCtx([
    { id: sessionId(), status: 'idle' },
    { id: sessionId(), status: 'completed' },
  ]);
  const r = await probeSessionActivity(ctx, { now: Date.now(), activityWindowMs: WINDOW, home });
  assert.equal(r.available, true);
  assert.equal(r.activeCount, 0);
  assert.deepEqual(r.activeIds, []);
});

test('agents 服务缺失/抛错/返回非数组 → 不抛异常且不误判活跃', async (t) => {
  const home = tempHome(t);
  const cases = [
    { name: 'ctx.get 抛错', ctx: { get() { throw new Error('get failed'); } } },
    { name: 'list() 抛错', ctx: { get: () => ({ list() { throw new Error('list failed'); } }) } },
    { name: 'list 返回非数组', ctx: { get: () => ({ list: () => 'not-an-array' }) } },
    { name: 'get 返回 undefined', ctx: { get: () => undefined } },
    { name: 'ctx 没有 get', ctx: {} },
  ];
  for (const c of cases) {
    let r;
    await assert.doesNotReject(
      (async () => { r = await probeSessionActivity(c.ctx, { now: Date.now(), activityWindowMs: WINDOW, home }); })(),
      `${c.name} 不应抛异常`,
    );
    assert.ok(r && typeof r === 'object', `${c.name} 应返回对象`);
    assert.ok(r.available === false || r.activeCount === 0, `${c.name} 不应误判为活跃: ${JSON.stringify(r)}`);
    assert.ok(Array.isArray(r.activeIds), `${c.name} activeIds 应为数组`);
  }
});

test('无 agents 服务时用会话日志 mtime 判定活跃(窗口内活跃/窗口外不活跃)', async (t) => {
  const home = tempHome(t);
  const id = sessionId();
  const t0 = Date.now();
  const files = writeSessionLog(home, id, t0);

  // 注意:探测实现里有 1s 的扫描缓存,这里靠推进 now 参数(>1s)让第二次探测重新扫描,
  // 而不是 sleep,保证断言确定性。
  const active = await probeSessionActivity(noAgentsCtx, { now: t0 + 50, activityWindowMs: WINDOW, home });
  assert.equal(active.source, 'log-activity');
  assert.ok(active.activeCount >= 1, `窗口内应判定活跃: ${JSON.stringify(active)}`);
  assert.ok(active.activeIds.includes(id), `activeIds 应含 ${id}: ${JSON.stringify(active.activeIds)}`);

  const stale = t0 - WINDOW * 10;
  for (const file of files) fs.utimesSync(file, new Date(stale), new Date(stale));
  const idle = await probeSessionActivity(noAgentsCtx, { now: t0 + 5000, activityWindowMs: WINDOW, home });
  assert.equal(idle.activeCount, 0, `窗口外不应判定活跃: ${JSON.stringify(idle)}`);
  assert.ok(['log-activity', 'none'].includes(idle.source), `source 应合法,实测 ${idle.source}`);
});

test('有活跃会话时 Web 宿主的 scheduleRestart 被守卫拦下(不创建 schtasks)', (t) => {
  if (!IS_WIN) { t.skip('isWebHostProcess 仅在 win32 生效'); return; }
  const home = tempHome(t);
  const engine = new SyncEngine(home);
  const probeResult = { available: true, activeCount: 1, activeIds: ['s1'], source: 'agents', checkedAt: Date.now() };
  engine.setActiveSessionProbe(() => probeResult);

  const activity = engine.sessionActivity({ now: Date.now() });
  assert.equal(activity.activeCount, 1);
  assert.deepEqual(activity.activeIds, ['s1']);

  const r = asWebHost(() => engine.scheduleRestart());
  assert.equal(r.scheduled, false);
  assert.equal(r.reason, 'active-session-guard');
  assert.equal(r.activeCount, 1);
  assert.deepEqual(r.activeIds, ['s1']);

  // 守卫位于宿主判定之前:不伪装宿主的 standalone engine 也应直接被拦下(task-3 原始措辞)
  const standalone = engine.scheduleRestart();
  assert.equal(standalone.reason, 'active-session-guard');
  assert.equal(standalone.activeCount, 1);

  // 无副作用断言:临时 home 里没有 restart-dsh-web.ps1,
  // 因此即使守卫失效也只会落到 missing-script,不会创建/运行 schtasks 任务。
  assert.equal(fs.existsSync(path.join(home, 'restart-dsh-web.ps1')), false);
});

test('用户已确认的手动重启(force:true)不受活跃会话守卫拦截(仍不会真调度)', (t) => {
  if (!IS_WIN) { t.skip('isWebHostProcess 仅在 win32 生效'); return; }
  const home = tempHome(t);
  const engine = new SyncEngine(home);
  engine.setActiveSessionProbe(() => ({ available: true, activeCount: 2, activeIds: ['a', 'b'], source: 'agents', checkedAt: Date.now() }));

  // 与 lib/index.js 手动重启路径同参:allowForce=桌面端确认,force=跳过「生成中」守卫
  const forced = asWebHost(() => engine.scheduleRestart('用户手动触发', { allowForce: true, force: true }));
  assert.notEqual(forced.reason, 'active-session-guard', `force 不应被守卫拦截: ${JSON.stringify(forced)}`);
  // 临时 home 无重启脚本 → 必然是 missing-script;既证明守卫放行,也证明没有产生 schtasks 副作用
  assert.equal(forced.reason, 'missing-script');
  assert.equal(forced.scheduled, false);
});

test('无活跃会话时不触发守卫(保持既有宿主判定)', (t) => {
  if (!IS_WIN) { t.skip('isWebHostProcess 仅在 win32 生效'); return; }
  const home = tempHome(t);
  const engine = new SyncEngine(home);
  engine.setActiveSessionProbe(() => ({ available: true, activeCount: 0, activeIds: [], source: 'agents', checkedAt: Date.now() }));

  const r = asWebHost(() => engine.scheduleRestart());
  assert.notEqual(r.reason, 'active-session-guard', `无活跃会话不应触发守卫: ${JSON.stringify(r)}`);
  assert.equal(r.reason, 'missing-script');
  assert.equal(r.scheduled, false);
});
