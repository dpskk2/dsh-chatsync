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
function harness(fetchImpl, componentName = 'SyncPreferences', { timers = true, confirm = () => false } = {}) {
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
  vm.runInNewContext(source.replace('module.exports = {', 'module.exports = { testComponents: { SyncPreferences, ConnectionSettings, HandoffCard, RecoveryCenter, LocalPreview, RecoveryItem, TransferReview, StartupSyncOverlay, CancelSyncButton, FootSyncButton },'), {
    window: { confirm, __ModuleLoader__: { load(def) { bundle = def.factory((name) => { assert.equal(name, 'react'); return react; }); } } },
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
  const Preferences = componentName === 'Section' ? root : bundle.testComponents[componentName];
  hooks = []; cursor = 0; effects = [];
  return {
    render(props = {}) { cursor = 0; return Preferences({ busy: false, ...props }); },
    async effects() { const pending = effects; effects = []; pending.forEach((fn) => fn()); await tick(); },
  };
}
const response = (data) => Promise.resolve({ json: async () => data });
const initial = { mode: 'manual', workspaceSync: true, enabled: true, intervalSeconds: 300 };

test('settings and sidebar cancellation stays disabled until the server confirms stopping and targets the observed run', async () => {
  for (const component of ['Section', 'FootSyncButton']) {
    let finishRun, finishCancel, cancelled = false;
    const calls = [];
    const h = harness((url, options) => {
      if (url.endsWith('/run')) return new Promise(resolve => { finishRun = resolve; });
      if (url.endsWith('/cancel')) { calls.push(JSON.parse(options.body)); return new Promise(resolve => { finishCancel = resolve; }); }
      if (url.endsWith('/progress')) return response({ running: !cancelled, runId: cancelled ? null : 'observed-run', canCancel: !cancelled });
      return response(url.endsWith('/status') ? { ok: true, remote: 'https://github.com/u/data' } : { ok: true, config: initial, conflicts: [] });
    }, component, { timers: false });
    h.render(); await h.effects();
    const runButton = all(h.render()).find(n => n.type === 'button' && (text(n).includes('立即同步') || n.props['aria-label'] === '同步 DSH 会话数据'));
    const running = runButton.props.onClick({ currentTarget: null }); await tick(); await tick();
    const card = all(h.render()).find(n => n.type.name === 'CancelSyncButton'); assert.ok(card);
    const view = harness(() => response({}), 'CancelSyncButton', { timers: false });
    const button = view.render(card.props); assert.equal(button.props.disabled, false); assert.match(text(button), /取消同步/);
    const stopping = button.props.onClick({ currentTarget: null });
    await button.props.onClick({ currentTarget: null }); assert.deepEqual(calls, [{ runId: 'observed-run' }]);
    const pending = view.render(all(h.render()).find(n => n.type.name === 'CancelSyncButton').props);
    assert.equal(pending.props.disabled, true); assert.match(text(pending), /正在停止/);
    cancelled = true;
    finishRun({ json: async () => ({ ok: false, summary: '已取消', detail: { cancelled: true } }) });
    finishCancel({ json: async () => ({ ok: true, message: '已停止' }) });
    await stopping; await running; await tick(); await tick();
    assert.ok(!all(h.render()).find(n => n.type.name === 'CancelSyncButton'));
  }
});

test('content changes save immediately, failed saves return to the confirmed selection', async () => {
  let fail = true, saved, current = { ...initial };
  const h = harness((_url, options) => {
    if (!options) return response({ ok: true, config: current });
    saved = JSON.parse(options.body);
    if (fail) return response({ ok: false, error: 'fixture save failed' });
    current = { ...current, ...saved };
    return response({ ok: true, config: current });
  });
  h.render(); await h.effects();
  await all(h.render()).find(n => n.props['aria-label'] === '聊天附件').props.onChange({ target: { checked: false } });
  assert.equal(saved.contentScope.attachments, false);
  assert.match(text(h.render()), /fixture save failed/);
  assert.equal(all(h.render()).find(n => n.props['aria-label'] === '聊天附件').props.checked, true);
  fail = false;
  await all(h.render()).find(n => n.props['aria-label'] === '聊天附件').props.onChange({ target: { checked: false } });
  assert.equal(all(h.render()).find(n => n.props['aria-label'] === '聊天附件').props.checked, false);
  assert.match(text(h.render()), /已保存/);
});

test('manual transfer requires explicit preview confirmation and sends only its current ID', async () => {
    const requests = []; let detail = null;
    const h = harness((url, options) => {
      if (url.endsWith('/run')) {
        requests.push(JSON.parse(options.body));
        detail = requests.length === 1 ? { needsReview: true, review: { id: 'current-preview', summary: '本次删除较多' } } : {};
        return response({ ok: requests.length > 1, detail });
      }
      return response(url.endsWith('/status') ? { ok: true, remote: 'https://github.com/u/data', lastDetail: detail } : { ok: true, config: initial, conflicts: [] });
    }, 'Section', { timers: false, confirm: () => { throw Error('must show inline preview'); } });
    h.render(); await h.effects();
    const button = all(h.render()).find(n => n.type === 'button' && text(n).includes('立即同步'));
    await button.props.onClick({ currentTarget: null }); await tick(); await tick();
    assert.equal(requests.length, 1);
    const card = all(h.render()).find(n => n.type.name === 'TransferReview');
    assert.equal(card.props.review.summary, '本次删除较多');
    const view = harness(() => response({}), 'TransferReview', { timers: false });
    const tree = view.render(card.props); assert.match(text(tree), /本次删除较多/);
    await all(tree).find(n => n.type === 'button').props.onClick(); await tick(); await tick();
    assert.equal(requests.length, 2); assert.equal(requests[1].approval, 'current-preview');
    assert.equal(all(h.render()).find(n => n.type.name === 'TransferReview').props.review, null);
});

test('startup review is visible with confirm and offline actions and no browser prompt', async () => {
  const requests = [];
  const startup = { required: true, phase: 'review', message: '等待确认', review: { id: 'exact-id', summary: '准备上传配置' } };
  const h = harness((url, options) => {
    if (url.endsWith('/startup')) { requests.push(JSON.parse(options.body)); startup.phase = 'ready'; return response({ ok: true }); }
    return response({ ok: true, startup });
  }, 'StartupSyncOverlay', { timers: false, confirm: () => { throw Error('hidden prompt'); } });
  h.render(); await h.effects();
  const tree = h.render(), card = all(tree).find(n => n.type.name === 'TransferReview');
  assert.equal(card.props.review.summary, '准备上传配置');
  assert.ok(all(tree).find(n => n.type === 'button' && text(n) === '本次离线使用'));
  assert.ok(!all(tree).find(n => n.type === 'button' && text(n) === '重试同步'));
  await card.props.onConfirm();
  assert.deepEqual(requests, [{ action: 'confirm', approval: 'exact-id' }]); assert.equal(h.render(), null);
});

test('handoff card only claims peer receipt when evidence exists and distinguishes merged versions', () => {
  const h = harness(() => response({}), 'HandoffCard');
  const base = { deviceName: '设备 A', uploaded: { scope: { main: 'a'.repeat(40) } }, peers: [] };
  assert.match(text(h.render({ handoff: base })), /尚未收到另一台/);
  const tree = h.render({ handoff: { ...base, peers: [{ deviceId: 'b', deviceName: '设备 B', appliedAt: 1, exactMain: false, workspaceComplete: false }] } });
  assert.match(text(tree), /并入自己的版本/);
  assert.match(text(tree), /项目文件尚未全部确认/);
});

test('local preview handles errors without claiming remote coverage', async () => {
  let fail = true;
  const h = harness(() => response(fail ? { ok: false, error: 'preview failed' } : { ok: true, hint: '本地状态', scopes: [{ kind:'main', added:2, modified:1, deleted:3 }] }), 'LocalPreview');
  await all(h.render()).find(n => n.type === 'button').props.onClick();
  assert.match(text(h.render()), /preview failed/);
  fail = false; await all(h.render()).find(n => n.type === 'button').props.onClick();
  assert.match(text(h.render()), /新增 2，修改 1，删除 3/);
  assert.match(text(h.render()), /未连接远端/);
  assert.doesNotMatch(text(h.render()), /preview failed/);
});

test('switches save only their changed fields without a save button or setup navigation', async () => {
  const requests = []; let current = { ...initial }, refreshed = 0, continued = 0;
  const h = harness((_url, options) => {
    if (!options) return response({ ok: true, config: current });
    const patch = JSON.parse(options.body); requests.push(patch);
    current = { ...current, ...patch }; return response({ ok: true, config: current });
  });
  const props = { onChanged: () => refreshed++, onSaved: () => continued++ };
  h.render(props); await h.effects();
  await all(h.render(props)).find(n => n.props['aria-label'] === '自动同步').props.onClick();
  await all(h.render(props)).find(n => n.props['aria-label'] === '项目文件').props.onChange({ target: { checked: false } });
  assert.deepEqual(requests, [{ automatic: false }, { workspaceSync: false }]);
  assert.equal(refreshed, 2); assert.equal(continued, 0);
  const tree = h.render(props);
  assert.equal(tree.type, 'div');
  assert.ok(!all(tree).some(n => n.props.type === 'submit'));
  assert.match(text(tree), /已保存/);
  assert.match(text(tree), /上传或附加到对话的图片、文件/);
  assert.match(text(tree), /项目文件夹中的文件，含生成到此处的 Word、Excel/);
  assert.doesNotMatch(text(tree), /修改后需保存|当前自动同步已关闭|始终使用已保存/);
});

test('legacy auto mode never exposes periodic or idle upload controls', async () => {
  const h=harness(()=>response({ok:true,config:{...initial,mode:'auto',intervalSeconds:30}}));
  h.render();await h.effects();const tree=h.render();
  assert.equal(all(tree).filter(n=>n.props.type==='number').length,0);
  assert.doesNotMatch(text(tree),/后台检查|空闲后|每.*分钟/);
  assert.ok(all(tree).find(n=>n.props['aria-label']==='启动时先同步').props.checked);
  assert.ok(all(tree).find(n=>n.props['aria-label']==='退出时保存上传').props.checked);
});

test('one immediate master switch respects explicit pauses regardless of legacy mode',async()=>{
  for(const mode of ['manual','auto'])for(const enabled of [false,true]){
    const requests=[];let current={...initial,mode,enabled};
    const h=harness((_url,options)=>{if(options){const patch=JSON.parse(options.body);requests.push(patch);current={...current,...patch};}return response({ok:true,config:current});});
    h.render();await h.effects();const tree=h.render();
    assert.equal(all(tree).filter(n=>n.props.role==='switch').length,1);
    assert.equal(all(tree).find(n=>n.props.role==='switch').props['aria-checked'],enabled);
    assert.equal(all(tree).filter(n=>n.props.type==='checkbox').length,6);
    assert.deepEqual(requests,[]);
    await all(tree).find(n=>n.props.role==='switch').props.onClick();
    assert.deepEqual(requests,[{automatic:!enabled}]);
  }
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
  assert.match(text(h.render()), /连接已保存/);
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
  assert.ok(all(tree).some(n => n.props.role === 'switch'));
  assert.equal(calls, 2);
});

test('a malformed success response is a recoverable load error', async () => {
  const h = harness(() => response({ ok: true }));
  h.render(); await h.effects();
  assert.match(text(h.render()), /无法读取同步偏好/);
});

test('failed immediate toggles show the actual persisted value and the error', async () => {
  const h = harness((_url, options) => response(options ? { ok: false, error: '磁盘只读' } : { ok: true, config: initial }));
  h.render(); await h.effects();
  await all(h.render()).find(n => n.props['aria-label'] === '自动同步').props.onClick();
  const tree = h.render();
  assert.equal(all(tree).find(n => n.props['aria-label'] === '自动同步').props['aria-checked'], true);
  assert.match(text(tree), /磁盘只读/);
  assert.doesNotMatch(text(tree), /已保存/);
});

test('syncing blocks immediate settings writes', async () => {
  let posts = 0;
  const h = harness((_url, options) => {
    if (options) posts++;
    return response({ ok: true, config: { ...initial, enabled: false } });
  });
  h.render(); await h.effects();
  const tree = h.render({ busy: true });
  assert.equal(all(tree).find(n => n.type === 'fieldset').props.disabled, true);
  await all(tree).find(n => n.props.role === 'switch').props.onClick();
  assert.equal(posts, 0);
  assert.equal(all(tree).find(n => n.props.role === 'switch').props['aria-checked'], false);
});

test('pending immediate saves prevent same-tick duplicate writes and report their pending state', async () => {
  let finish, posts = 0; const pending = [];
  const h = harness((_url, options) => {
    if (!options) return response({ ok: true, config: initial });
    posts++;
    return new Promise(resolve => { finish = () => resolve({ json: async () => ({ ok: true, config: { ...initial, automatic: true } }) }); });
  });
  const props = { onSavingChange: value => pending.push(value) };
  h.render(props); await h.effects();
  const button = all(h.render(props)).find(n => n.props.role === 'switch');
  const saving = button.props.onClick();
  await button.props.onClick();
  assert.equal(posts, 1);
  assert.equal(all(h.render(props)).find(n => n.type === 'fieldset').props.disabled, true);
  assert.deepEqual(pending, [true]);
  finish(); await saving;
  assert.deepEqual(pending, [true, false]);
  assert.equal(all(h.render(props)).find(n => n.type === 'fieldset').props.disabled, false);
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
  all(h.render()).find(n => n.props['data-sync-recovery']).props.onToggle({ currentTarget: { open: true } });
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

test('unsupported old repository is shown without silently converting it', async () => {
  const h=harness(()=>response({ok:true, config:{remote:'https://gitee.com/alice/data.git',branch:'main',autoRepo:false}}),'ConnectionSettings');
  h.render(); await h.effects();
  assert.match(text(h.render()), /本版仅连接 GitHub；原配置保留/);
  assert.equal(all(h.render()).find(n=>n.type==='input').props.value,'https://gitee.com/alice/data.git');
  assert.equal(all(h.render()).some(n=>n.props.type==='password'),false);
});

test('first setup shows only the current step and saving advances', async () => {
  const h=harness(url=>response(url.endsWith('/status') ? {ok:true,remote:''} : {ok:true,config:initial,conflicts:[]}), 'Section',{timers:false});
  h.render(); await h.effects();
  let tree=h.render();
  assert.ok(all(tree).some(n=>n.type?.name==='ConnectionSettings'));
  assert.ok(!all(tree).some(n=>n.type?.name==='SyncPreferences'));
  const nav=all(tree).find(n=>n.props['aria-label']==='同步设置步骤');
  assert.equal(all(nav).filter(n=>n.type==='button').length,3);
  all(tree).find(n=>n.type?.name==='ConnectionSettings').props.onSaved();
  tree=h.render();
  assert.ok(!all(tree).some(n=>n.type?.name==='ConnectionSettings'));
  all(tree).find(n=>n.type?.name==='SyncPreferences').props.onSaved();
  tree=h.render();
  assert.ok(all(tree).some(n=>n.props.id==='dss-run'));
  assert.ok(!all(tree).some(n=>n.props.id==='dss-result'));
});

test('daily sync is the default for configured users after restart, success or failure', async () => {
  for(const lastOk of [null,true,false]) {
    const h=harness(url=>response(url.endsWith('/status') ? {ok:true,remote:'https://github.com/u/data',lastOk,lastSyncAt:1} : {ok:true,config:initial,conflicts:[]}), 'Section',{timers:false});
    h.render(); await h.effects();
    let tree=h.render();
    assert.ok(all(tree).some(n=>n.props.id==='dss-run'));
    assert.ok(!all(tree).some(n=>n.type?.name==='ConnectionSettings'));
    assert.ok(!all(tree).some(n=>n.props['aria-label']==='同步设置步骤'));
    assert.ok(!all(tree).some(n=>n.type?.name==='RecoveryCenter'));
    assert.ok(!all(tree).some(n=>n.type?.name==='LocalPreview'));
    all(tree).find(n=>n.props['data-sync-settings']).props.onToggle({currentTarget:{open:true}});
    tree=h.render();
    assert.ok(all(tree).some(n=>n.type?.name==='ConnectionSettings'));
    assert.ok(all(tree).some(n=>n.type?.name==='SyncPreferences'));
    assert.ok(!all(tree).some(n=>n.type?.name==='ContentScopeSettings'));
    assert.ok(all(tree).some(n=>n.props.id==='dss-run'), 'settings disclosure never replaces daily sync');
  }
});

test('handoff disclosure never equates one-device success with two-device completion', async () => {
  for(const [status,expected] of [
    [{remote:'https://github.com/u/data',lastOk:false,lastSyncAt:1},/本次同步未完成/],
    [{remote:'https://github.com/u/data',lastOk:true,lastSyncAt:1},/仍需在另一台电脑打开会话和附件核对/]
  ]){
    const h=harness(url=>response(url.endsWith('/status') ? {ok:true,...status} : {ok:true,config:initial,conflicts:[]}), 'Section',{timers:false});
    h.render(); await h.effects();
    all(h.render()).find(n=>n.props['data-sync-handoff']).props.onToggle({currentTarget:{open:true}});
    const result=all(h.render()).find(n=>n.props['data-sync-handoff']);
    assert.match(text(result),expected);
    assert.doesNotMatch(text(result),/双向同步已完成/);
  }
});

test('startup and exit choices save independently without an interval setting',async()=>{
  const requests=[];let current={...initial,automatic:true,autoPullOnStart:true,autoPushOnExit:true};
  const h=harness((_url,options)=>{if(options){const p=JSON.parse(options.body);requests.push(p);current={...current,...p};}return response({ok:true,config:current});});
  h.render();await h.effects();
  await all(h.render()).find(n=>n.props['aria-label']==='启动时先同步').props.onChange({target:{checked:false}});
  await all(h.render()).find(n=>n.props['aria-label']==='退出时保存上传').props.onChange({target:{checked:false}});
  assert.deepEqual(requests,[{autoPullOnStart:false},{autoPushOnExit:false}]);
  assert.equal(all(h.render()).filter(n=>n.props.type==='number').length,0);
});

test('lost save response is reconciled with the committed configuration', async () => {
  let current = { ...initial };
  const h = harness((_url, options) => {
    if (!options) return response({ ok: true, config: current });
    current = { ...current, ...JSON.parse(options.body) };
    return Promise.reject(new Error('response lost'));
  });
  h.render(); await h.effects();
  await all(h.render()).find(n => n.props.role === 'switch').props.onClick();
  assert.equal(all(h.render()).find(n => n.props.role === 'switch').props['aria-checked'], false);
  assert.match(text(h.render()), /response lost/);
  assert.doesNotMatch(text(h.render()), /已保存/);
});

test('unconfirmed save disables controls until a successful reread', async () => {
  let reads = 0, offline = true;
  const h = harness((_url, options) => {
    if (options) return Promise.reject(new Error('offline'));
    if (++reads > 1 && offline) return Promise.reject(new Error('offline'));
    return response({ ok: true, config: initial });
  });
  h.render(); await h.effects();
  await all(h.render()).find(n => n.props.role === 'switch').props.onClick();
  assert.match(text(h.render()), /保存状态未知/);
  assert.equal(all(h.render()).find(n => n.type === 'fieldset').props.disabled, true);
  offline = false;
  all(h.render()).find(n => n.type === 'button' && text(n) === '重新读取').props.onClick();
  h.render(); await h.effects();
  assert.equal(all(h.render()).find(n => n.type === 'fieldset').props.disabled, false);
});

test('host overrides are displayed without claiming the requested switch is enabled', async () => {
  const h = harness((_url, options) => response({ ok: true, config: { ...initial, automatic: false } }));
  h.render(); await h.effects();
  await all(h.render()).find(n => n.props.role === 'switch').props.onClick();
  assert.equal(all(h.render()).find(n => n.props.role === 'switch').props['aria-checked'], false);
  assert.match(text(h.render()), /受宿主配置限制/);
});

test('setup choices save in place and Continue advances without an interval write', async () => {
  let current = { ...initial, automatic: true }, advanced = 0; const requests = [];
  const h = harness((_url, options) => {
    if (!options) return response({ ok: true, config: current });
    const patch = JSON.parse(options.body); requests.push(patch);
    current = { ...current, ...patch }; return response({ ok: true, config: current });
  });
  const props = { setup: true, onSaved: () => advanced++ };
  h.render(props); await h.effects();
  await all(h.render(props)).find(n => n.props['aria-label'] === '项目文件').props.onChange({ target: { checked: false } });
  assert.equal(advanced, 0);
  await all(h.render(props)).find(n => n.type === 'button' && text(n) === '继续').props.onClick();
  assert.equal(advanced, 1);
  assert.deepEqual(requests, [{ workspaceSync: false }]);
});

test('pending preferences prevent connection writes and starting a transfer', async () => {
  const requests = [];
  const h = harness((url, options) => {
    if (options) requests.push(url);
    return response(url.endsWith('/status') ? { ok: true, remote: 'https://github.com/u/data' } : { ok: true, config: initial, conflicts: [] });
  }, 'Section', { timers: false });
  h.render(); await h.effects();
  all(h.render()).find(n => n.props['data-sync-settings']).props.onToggle({currentTarget:{open:true}});
  all(h.render()).find(n => n.type?.name === 'SyncPreferences').props.onSavingChange(true);
  const tree = h.render();
  assert.equal(all(tree).find(n => n.type === 'button' && text(n).includes('立即同步')).props.disabled,true);
  assert.equal(all(tree).find(n => n.type?.name === 'ConnectionSettings').props.busy, true);
  assert.deepEqual(requests, []);
});

test('legacy manual mode can enable lifecycle automation through the master switch',async()=>{
  const requests=[];let current={...initial,enabled:false,automatic:false};
  const h=harness((_url,options)=>{if(options){const p=JSON.parse(options.body);requests.push(p);current={...current,...p};}return response({ok:true,config:current});});
  h.render();await h.effects();await all(h.render()).find(n=>n.props.role==='switch').props.onClick();
  assert.deepEqual(requests,[{automatic:true}]);assert.equal(current.mode,'manual');
  assert.equal(all(h.render()).find(n=>n.props.role==='switch').props['aria-checked'],true);
  assert.doesNotMatch(text(h.render()),/自动操作已暂停/);
});
