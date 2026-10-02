/**
 * 回归测试:界面提示「重启会打断哪几次对话」用的**会话名**解析。
 *
 * 背景:0.12.14 的引导卡/确认框直接显示 session-<uuid>,用户看不出是哪个会话。
 * 现在优先用宿主 agents 服务里运行中的会话对象取标题,取不到再读宿主的投影缓存
 * (storages/session_projcache/sessions/<id>.json 的 title 行),都没有才由界面退化为目录名/短 id。
 *
 * 安全性:纯文件读取 + 内存 ctx,不碰网络、不调度重启、不读真实 ~/.dsh。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveSessionTitles, readCachedSessionTitle, truncateDisplayText, probeSessionActivity, TITLE_DISPLAY_MAX } from '../lib/session-activity.js';

function tempHome(t, prefix = 'dsh-session-titles-') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(home)), path.resolve(os.tmpdir()));
    assert.match(path.basename(home), new RegExp('^' + prefix));
    fs.rmSync(home, { recursive: true, force: true });
  });
  return home;
}

function sessionId() {
  const id = 'session-' + randomUUID();
  assert.match(id, /^session-[0-9a-f-]{36}$/);
  return id;
}

/** 按宿主真实布局写一份投影缓存记录 */
function writeProjection(home, id, title) {
  const dir = path.join(home, 'storages', 'session_projcache', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify({
    record: { identity: { createdAt: 1, cwd: 'C:\\work' }, rows: { title: { ver: 1, seq: 3, val: title } } },
  }), 'utf8');
}

test('session titles come from the live agents service first, then from the projection cache', (t) => {
  const home = tempHome(t);
  const liveId = sessionId();
  const cachedId = sessionId();
  const unknownId = sessionId();
  writeProjection(home, cachedId, '缓存里的会话名');
  writeProjection(home, liveId, '缓存里的旧名');

  const ctx = {
    get: (name) => (name === 'agents' ? {
      list: () => [
        { id: liveId, status: 'running', session: { title: '正在生成的会话名' } },
        { id: unknownId, status: 'idle' },
      ],
    } : undefined),
  };

  const titles = resolveSessionTitles(ctx, [liveId, cachedId, unknownId], home);
  assert.equal(titles[liveId], '正在生成的会话名');
  assert.equal(titles[cachedId], '缓存里的会话名');
  assert.equal(titles[unknownId], undefined, '两处都没有名字时不编造');

  /* agents 服务缺失:全部走投影缓存 */
  const noAgents = resolveSessionTitles({ get: () => undefined }, [liveId, cachedId], home);
  assert.equal(noAgents[liveId], '缓存里的旧名');
  assert.equal(noAgents[cachedId], '缓存里的会话名');

  /* 任何异常都只影响单个 id,不抛异常 */
  const broken = resolveSessionTitles({ get() { throw new Error('boom'); } }, [cachedId], home);
  assert.equal(broken[cachedId], '缓存里的会话名', 'agents 抛错时仍应退回投影缓存');
  assert.deepEqual(resolveSessionTitles(null, [], home), {});
});

test('title shapes are tolerated and long titles are trimmed for the overlay', (t) => {
  const home = tempHome(t);
  const structId = sessionId();
  const headerId = sessionId();
  /* 结构化标题快照 + 会话 header 上的标题 */
  const ctx = {
    get: (name) => (name === 'agents' ? {
      list: () => [
        { id: structId, status: 'running', session: { title: { title: '结构化标题' } } },
        { id: headerId, status: 'running', session: { header: { title: '头部标题' } } },
      ],
    } : undefined),
  };
  const titles = resolveSessionTitles(ctx, [structId, headerId], home);
  assert.equal(titles[structId], '结构化标题');
  assert.equal(titles[headerId], '头部标题');

  assert.equal(truncateDisplayText('短名字'), '短名字');
  const long = '很长的会话名字'.repeat(20);
  const trimmed = truncateDisplayText(long);
  assert.equal([...trimmed].length, TITLE_DISPLAY_MAX + 1, '截断后应带一个省略号');
  assert.ok(trimmed.endsWith('…'));
  assert.equal(truncateDisplayText('  留白  '), '留白');
  assert.equal(truncateDisplayText(null), '');
});

test('projection cache reads are safe and the probe carries titles only when asked', async (t) => {
  const home = tempHome(t);
  const id = sessionId();
  writeProjection(home, id, '会话甲');
  assert.equal(readCachedSessionTitle(home, id), '会话甲');
  assert.equal(readCachedSessionTitle(home, sessionId()), null, '缺失的缓存记录返回 null');
  assert.equal(readCachedSessionTitle(home, ''), null);

  const ctx = { get: (name) => (name === 'agents' ? { list: () => [{ id, status: 'running', session: { title: '会话甲' } }] } : undefined) };
  const plain = await probeSessionActivity(ctx, { home, now: Date.now() });
  assert.equal(plain.activeCount, 1);
  assert.equal('titles' in plain, false, '默认不解析会话名(同步/守卫路径不需要)');
  const withTitles = await probeSessionActivity(ctx, { home, now: Date.now(), titles: true });
  assert.equal(withTitles.titles[id], '会话甲');
  /* 没有活跃会话时不必返回空映射 */
  const idle = await probeSessionActivity({ get: (name) => (name === 'agents' ? { list: () => [{ id, status: 'idle' }] } : undefined) }, { home, now: Date.now(), titles: true });
  assert.equal(idle.activeCount, 0);
  assert.equal('titles' in idle, false);
});
