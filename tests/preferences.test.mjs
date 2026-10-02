import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function all(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...(node.children || []).flatMap(all)];
}
function text(node) {
  if (node == null || node === false) return '';
  return typeof node === 'object' ? (node.children || []).map(text).join(' ') : String(node);
}

// Load the shipped browser bundle through its normal slot registration contract.
// Only React hooks and HTTP transport are replaced; no user data or Git is accessed.
function harness(fetchImpl, componentName = 'SyncPreferences', { timers = true } = {}) {
  let hooks = [], cursor = 0, effects = [], bundle;
  const slots = new Map();
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks[i], (next) => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; }];
    },
    useRef(initial) { const [ref] = react.useState({ current: initial }); return ref; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!hooks[i] || !deps || deps.some((d, n) => d !== hooks[i][n])) effects.push(fn);
      hooks[i] = deps;
    },
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
  };
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(def) { bundle = def.factory((name) => { assert.equal(name, 'react'); return react; }); } } },
    fetch: fetchImpl,
    setTimeout, clearTimeout,
    /* 设置分节内的状态轮询是 3s setInterval:测试里不真起定时器,避免进程被挂住 */
    setInterval: timers ? setInterval : () => 0,
    clearInterval: timers ? clearInterval : () => {},
  });
  bundle.apply({ slots: { inject: (_name, cb) => cb(), register: (meta, component) => slots.set(meta.id, component) } });
  /* 设置分节本身就是一个组件(Section),直接用槽位注册到的组件;
     子组件(SyncPreferences / ConnectionSettings)仍按名字从分节树里取。 */
  const root = slots.get('dsh-sync-manage');
  const Preferences = componentName === 'Section'
    ? root
    : all(root({})).find((n) => n.type?.name === componentName).type;
  hooks = []; cursor = 0; effects = [];
  return {
    render(props = {}) { cursor = 0; return Preferences({ busy: false, ...props }); },
    async effects() { const pending = effects; effects = []; pending.forEach((fn) => fn()); await tick(); },
  };
}
const response = (data) => Promise.resolve({ json: async () => data });
const initial = { mode: 'manual', workspaceSync: true, enabled: true };

test('load preferences, save the selected mode and scope, and explain immediate activation', async () => {
  const requests = [];
  let refreshed = false;
  const h = harness((url, options) => {
    assert.equal(url, '/dsh-sync/api/config');
    if (!options) return response({ ok: true, config: initial });
    requests.push(JSON.parse(options.body));
    return response({ ok: true });
  });
  let tree = h.render();
  assert.match(text(tree), /正在读取偏好/);
  await h.effects();
  tree = h.render();
  all(tree).find((n) => n.type === 'select').props.onChange({ target: { value: 'auto' } });
  tree = h.render();
  /* 按标签文字找「同步工作区文件」勾选框(不依赖控件顺序) */
  const workspaceBox = all(tree).find((n) => n.type === 'label'
    && (n.children || []).some((c) => c && c.type === 'input' && c.props.type === 'checkbox')
    && text(n).includes('同步工作区文件'));
  assert.ok(workspaceBox, '应能找到「同步工作区文件」勾选框');
  (workspaceBox.children || []).find((c) => c && c.type === 'input').props.onChange({ target: { checked: false } });
  tree = h.render({ onSaved: () => { refreshed = true; } });
  await tree.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(requests, [{ mode: 'auto', workspaceSync: false, enabled: true }]);
  assert.equal(refreshed, true);
  assert.match(text(h.render()), /已保存.*立即生效/);
});

/* 自动同步周期必须来自实际配置(intervalSeconds),不能再写死「每 5 分钟」。 */
test('auto-sync interval is shown from the effective configuration', async () => {
  const h = harness(() => response({ ok: true, config: { ...initial, mode: 'auto', intervalSeconds: 1800 } }));
  h.render(); await h.effects();
  assert.match(text(h.render()), /每 30 分钟/);
  assert.match(text(h.render()), /定时同步一次/);
});

/* 「自动调度是什么意思」的实际答案必须在界面上:开关在哪、三件事分别是什么、间隔可改。
   实测配置为 manual + enabled:false,原先只有一句「自动调度未运行」却没有任何入口。 */
test('scheduling can be turned on and its interval edited from the preferences form', async () => {
  const requests = [];
  const config = { mode: 'manual', workspaceSync: true, enabled: false, intervalSeconds: 300 };
  const h = harness((_url, options) => {
    if (!options) return response({ ok: true, config });
    requests.push(JSON.parse(options.body));
    return response({ ok: true, config: { ...config, ...JSON.parse(options.body) } });
  });
  h.render(); await h.effects();
  let tree = h.render();
  assert.match(text(tree), /允许自动同步/);
  assert.match(text(tree), /当前自动同步已关闭/);
  assert.match(text(tree), /自动同步的触发时机/);
  /* 打开「允许自动同步」 */
  all(tree).filter((n) => n.type === 'input')[0].props.onChange({ target: { checked: true } });
  tree = h.render();
  await tree.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(requests[0], { mode: 'manual', workspaceSync: true, enabled: true });
  assert.doesNotMatch(text(h.render()), /当前自动同步已关闭/);

  /* 切到自动模式:开关自动打开,并出现间隔输入(默认 5 分钟),改 20 分钟后保存为秒 */
  tree = h.render();
  all(tree).find((n) => n.type === 'select').props.onChange({ target: { value: 'auto' } });
  tree = h.render();
  const interval = all(tree).find((n) => n.type === 'input' && n.props.type === 'number');
  assert.ok(interval, '自动模式下应出现同步间隔输入框');
  assert.equal(interval.props.value, '5');
  interval.props.onChange({ target: { value: '20' } });
  tree = h.render();
  await tree.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(requests[1], { mode: 'auto', workspaceSync: true, enabled: true, intervalSeconds: 1200 });
});

test('connection form saves a custom repository and explains that saving is not verification', async () => {  let saved;
  const config = { remote: '', branch: 'main', autoRepo: true };
  const h = harness((_url, options) => {
    if (!options) return response({ ok: true, config });
    saved = JSON.parse(options.body);
    return response({ ok: true, config: saved });
  }, 'ConnectionSettings');
  h.render(); await h.effects();
  let tree = h.render();
  all(tree).find(n => n.type === 'input' && n.props.type === 'text').props.onChange({ target: { value: ' https://github.com/alice/existing.git ' } });
  tree = h.render();
  await tree.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(saved, { remote: 'https://github.com/alice/existing.git', branch: 'main', autoRepo: true });
  assert.match(text(h.render()), /保存不会验证登录/);
  assert.ok(all(tree).filter(n => n.type === 'a').every(n => n.props.href.startsWith('https://') && n.props.rel.includes('noopener')));
});

test('connection form preserves user input on failure and blocks writes while syncing', async () => {
  let posts = 0;
  const h = harness((_url, options) => {
    if (!options) return response({ ok: true, config: { remote: 'https://github.com/alice/data.git', branch: 'main', autoRepo: false } });
    posts++;
    return response({ ok: false, error: '请完成同步后重试' });
  }, 'ConnectionSettings');
  h.render(); await h.effects();
  await h.render({ busy: true }).props.onSubmit({ preventDefault() {} });
  assert.equal(posts, 0);
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.match(text(h.render()), /请完成同步后重试/);
  assert.equal(all(h.render()).find(n => n.type === 'input').props.value, 'https://github.com/alice/data.git');
  assert.doesNotMatch(text(h.render()), /连接设置已保存/);
});

test('background status refresh never replaces an unsaved connection draft', async () => {
  let calls = 0;
  const h = harness(() => {
    calls++;
    return response({ ok: true, config: { remote: '', branch: 'main', autoRepo: true } });
  }, 'ConnectionSettings');
  h.render({ remote: '' }); await h.effects();
  all(h.render({ remote: '' })).find(n => n.type === 'input').props.onChange({ target: { value: 'https://github.com/alice/draft.git' } });
  h.render({ remote: 'https://github.com/alice/auto-created.git' }); await h.effects();
  const tree = h.render({ remote: 'https://github.com/alice/auto-created.git' });
  assert.equal(all(tree).find(n => n.type === 'input').props.value, 'https://github.com/alice/draft.git');
  assert.equal(calls, 1);
});

test('failed config loading offers a working retry', async () => {
  let calls = 0;
  const h = harness(() => ++calls === 1 ? Promise.reject(new Error('连接失败')) : response({ ok: true, config: initial }));
  h.render(); await h.effects();
  let tree = h.render();
  assert.match(text(tree), /连接失败/);
  all(tree).find((n) => n.type === 'button').props.onClick();
  h.render(); await h.effects();
  tree = h.render();
  assert.ok(all(tree).some((n) => n.type === 'select'));
  assert.equal(calls, 2);
});

test('a malformed success response is a recoverable load error', async () => {
  const h = harness(() => response({ ok: true }));
  h.render(); await h.effects();
  assert.match(text(h.render()), /无法读取同步偏好/);
});

test('save failure preserves the selected values without claiming success', async () => {
  const h = harness((_url, options) => response(options ? { ok: false, error: '磁盘只读' } : { ok: true, config: initial }));
  h.render(); await h.effects();
  let tree = h.render();
  all(tree).find((n) => n.type === 'select').props.onChange({ target: { value: 'auto' } });
  tree = h.render();
  await tree.props.onSubmit({ preventDefault() {} });
  tree = h.render();
  assert.equal(all(tree).find((n) => n.type === 'select').props.value, 'auto');
  assert.match(text(tree), /磁盘只读/);
  assert.doesNotMatch(text(tree), /已保存/);
});

test('syncing blocks config submission and disabled scheduling is visible', async () => {
  let posts = 0;
  const h = harness((_url, options) => {
    if (options) posts++;
    return response({ ok: true, config: { ...initial, enabled: false } });
  });
  h.render(); await h.effects();
  const tree = h.render({ busy: true });
  assert.equal(all(tree).find((n) => n.type === 'fieldset').props.disabled, true);
  await tree.props.onSubmit({ preventDefault() {} });
  assert.equal(posts, 0);
  /* 关闭自动同步时界面必须说明「现在只手动同步」,并给出打开开关的位置 */
  assert.match(text(tree), /当前自动同步已关闭/);
  assert.match(text(tree), /允许自动同步/);
});

test('pending saves disable controls and cannot be submitted again', async () => {
  let finish, posts = 0;
  const h = harness((_url, options) => {
    if (!options) return response({ ok: true, config: initial });
    posts++;
    return new Promise((resolve) => { finish = () => resolve({ json: async () => ({ ok: true }) }); });
  });
  h.render(); await h.effects();
  const saving = h.render().props.onSubmit({ preventDefault() {} });
  const tree = h.render();
  assert.equal(all(tree).find((n) => n.type === 'fieldset').props.disabled, true);
  await tree.props.onSubmit({ preventDefault() {} });
  assert.equal(posts, 1);
  finish(); await saving;
  assert.equal(all(h.render()).find((n) => n.type === 'fieldset').props.disabled, false);
});

/* 遗留冲突副本区:分层合并引擎上线后同步不再生成冲突拷贝,服务端也没有
   /dsh-sync/api/conflict/resolve 路由,因此这三个裁决按钮必须消失,只留只读预览。 */
test('legacy conflict copies are read-only and never call a resolution endpoint', async () => {
  const calls = [];
  const status = { ok: true, remote: 'https://github.com/u/dsh-sync.git', branch: 'main', mode: 'manual', lastOk: true, lastDetail: null };
  const h = harness((url, options) => {
    calls.push(url);
    if (url === '/dsh-sync/api/status') return response(status);
    if (url === '/dsh-sync/api/conflicts') return response({ ok: true, conflicts: [{ path: 'storages/workspace.json.dsh-conflict-20260101T000000Z', copy: null }] });
    if (url === '/dsh-sync/api/config') return response({ ok: true, config: initial });
    throw new Error('unexpected request: ' + url);
  }, 'Section', { timers: false });
  h.render(); await h.effects(); await h.effects();
  const tree = h.render();
  const buttons = all(tree).filter((n) => n.type === 'button').map((n) => text(n));
  assert.equal(buttons.includes('保留本机'), false);
  assert.equal(buttons.includes('采用远端'), false);
  assert.equal(buttons.includes('两侧都留'), false);
  assert.equal(calls.includes('/dsh-sync/api/conflict/resolve'), false);
  assert.match(text(tree), /遗留冲突副本（只读）/);
  assert.match(text(tree), /不提供取舍或删除操作/);
  assert.match(text(tree), /分叉时保留一侧/);
  assert.doesNotMatch(text(tree), /会话按事件合并/);
});

/* 补丁状态不再占用同步状态行,桌面端也不再返回一句与同步无关的限制说明。 */
test('patch status stays out of the sync status line', async () => {
  const status = { ok: true, remote: 'https://github.com/u/dsh-sync.git', branch: 'main', mode: 'manual', lastOk: true, lastDetail: null, patches: 'web-fetch: 已应用' };
  const h = harness((url) => {
    if (url === '/dsh-sync/api/status') return response(status);
    if (url === '/dsh-sync/api/conflicts') return response({ ok: true, conflicts: [] });
    if (url === '/dsh-sync/api/config') return response({ ok: true, config: initial });
    throw new Error('unexpected request: ' + url);
  }, 'Section', { timers: false });
  h.render(); await h.effects(); await h.effects();
  const tree = h.render();
  assert.equal(all(tree).some((n) => typeof n === 'string' && n.startsWith('补丁:')), false);
  assert.match(text(tree), /本机补丁状态/);
});

test('onboarding orders connection, scope, transfer and verification, with navigable steps', async () => {
  const h = harness(url => response(url.endsWith('/status')
    ? { ok: true, remote: '', autoRepo: true }
    : url.endsWith('/conflicts') ? { ok: true, conflicts: [] } : { ok: true, config: initial }), 'Section', { timers: false });
  h.render(); await h.effects();
  let tree = h.render();
  const sections = tree.children.filter(n => n && (n.type?.name === 'ConnectionSettings' || n.type?.name === 'SyncPreferences' || n.props?.id === 'dss-run' || n.props?.id === 'dss-result'));
  assert.deepEqual(sections.map(n => n.type?.name || n.props.id), ['ConnectionSettings', 'SyncPreferences', 'dss-run', 'dss-result']);
  const nav = all(tree).find(n => n.props?.['aria-label'] === '同步设置步骤');
  const steps = all(nav).filter(n => n.type === 'button');
  assert.equal(steps.length, 4);
  assert.ok(all(tree).some(n => n.props?.role === 'status' && n.props?.['aria-label'] === '下一步引导'));
  assert.ok(all(tree).some(n => n.props?.role === 'status' && n.props?.['aria-label'] === '当前同步状态'));
  assert.equal(steps[0].props['aria-current'], 'step');
  steps[3].props.onClick();
  tree = h.render();
  assert.doesNotMatch(text(tree), /本机同步已完成/);
  assert.match(text(tree), /还没有本次运行的同步结果/);
});

test('verification distinguishes local snapshots, failures and one-device success', async () => {
  for (const [status, expected] of [
    [{ remote: '', lastOk: true, lastSyncAt: 1 }, /已保存本地快照，尚未上传云端/],
    [{ remote: 'https://github.com/u/data.git', lastOk: false, lastSyncAt: 1 }, /本次同步未完成/],
    [{ remote: 'https://github.com/u/data.git', lastOk: true, lastSyncAt: 1 }, /还需在另一台电脑完成下面的验证/],
  ]) {
    const h = harness(url => response(url.endsWith('/status') ? { ok: true, ...status }
      : url.endsWith('/conflicts') ? { ok: true, conflicts: [] } : { ok: true, config: initial }), 'Section', { timers: false });
    h.render(); await h.effects();
    const result = all(h.render()).find(n => n.props?.id === 'dss-result');
    assert.match(text(result), expected);
    assert.doesNotMatch(text(result), /双向同步已完成/);
  }
});
