import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
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
function harness(
  fetchImpl,
  componentName = 'SyncPreferences',
  { timers = true, confirm = () => false, interval } = {},
) {
  let hooks = [],
    cursor = 0,
    effects = [],
    bundle;
  const navigationCalls = [];
  const slots = new Map();
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [
        hooks[i],
        next => {
          hooks[i] = typeof next === 'function' ? next(hooks[i]) : next;
        },
      ];
    },
    useRef(initial) {
      const [ref] = react.useState({ current: initial });
      return ref;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!hooks[i] || !deps || deps.some((d, n) => d !== hooks[i][n])) effects.push(fn);
      hooks[i] = deps;
    },
    useMemo: fn => fn(),
    useCallback: fn => fn,
  };
  vm.runInNewContext(
    source.replace(
      'module.exports = {',
      'module.exports = { testComponents: { LocalStorage, RemoteCleanup, WorkspaceHistoryRepair, WorkspaceLocations, SidebarVisibilityProvider, SidebarVisibilityToggle, RepairPage, openRepairPage, GroupingRepairOverlay, installSendProtection, showSendBlock, DataHealth, recoveryRows, RecoveryDialog, RecoveryComparison, SyncPreferences, ConnectionSettings, RecoveryCenter, RecoveryItem, TransferReview, StartupSyncOverlay, StartupProgress, SyncIssues, TransferLine, STYLE },',
    ),
    {
      window: {
        confirm,
        __ModuleLoader__: {
          load(def) {
            bundle = def.factory(name => {
              assert.equal(name, 'react');
              return react;
            });
          },
        },
      },
      fetch: fetchImpl,
      AbortSignal,
      setTimeout,
      clearTimeout,
      /* 设置分节内的状态轮询是 3s setInterval:测试里不真起定时器,避免进程被挂住 */
      setInterval: interval || (timers ? setInterval : () => 0),
      clearInterval: timers ? clearInterval : () => {},
    },
  );
  bundle.apply({
    inject: (names, callback) => {
      if (names.includes('layout'))
        callback({ layout: { selectPanel: id => navigationCalls.push(id) }, effect: () => {} });
    },
    slots: {
      inject: (_name, cb) => cb(),
      register: (meta, component) => {
        slots.set(meta.id, component);
        return () => slots.delete(meta.id);
      },
    },
  });
  /* 设置分节本身就是一个组件(Section),直接用槽位注册到的组件;
     子组件(SyncPreferences / ConnectionSettings)仍按名字从分节树里取。 */
  const root = slots.get('dsh-sync-manage');
  const Preferences = componentName === 'Section' ? root : bundle.testComponents[componentName];
  hooks = [];
  cursor = 0;
  effects = [];
  return {
    functions: bundle.testComponents,
    slots,
    navigationCalls,
    render(props = {}) {
      cursor = 0;
      return Preferences({ busy: false, ...props });
    },
    async effects() {
      const pending = effects;
      effects = [];
      pending.forEach(fn => fn());
      await tick();
    },
  };
}
const response = data => Promise.resolve({ ok: true, json: async () => data });
const initial = { mode: 'manual', workspaceSync: true, enabled: true, intervalSeconds: 300 };

test('project locations load on expansion and save only the chosen local path', async () => {
  const calls = [];
  const h = harness((url, options) => {
    calls.push({ url, body: options?.body && JSON.parse(options.body) });
    return response(
      url.endsWith('/scan')
        ? { ok: true, workspaces: [{ id: 'project-a', title: '项目 A', localPath: 'C:/projects/a' }] }
        : { ok: true, hint: '已保存本机位置。' },
    );
  }, 'WorkspaceLocations');
  let tree = h.render();
  await h.effects();
  assert.equal(calls.length, 0);
  all(tree)
    .find(n => n.type === 'details')
    .props.onToggle({ currentTarget: { open: true } });
  await tick();
  tree = h.render();
  assert.match(text(tree), /同步到这台电脑/);
  all(tree)
    .find(n => n.type === 'input')
    .props.onChange({ target: { value: 'D:/project-a' } });
  tree = h.render();
  const save = () => all(h.render()).find(n => n.type === 'button' && text(n) === '保存本机位置');
  assert.equal(save().props.disabled, false);
  await save().props.onClick();
  assert.deepEqual(
    calls.map(c => c.url),
    ['/dsh-sync/api/data-health/scan', '/dsh-sync/api/data-health/workspace-path'],
  );
  assert.deepEqual(calls[1].body, { workspaceId: 'project-a', localPath: 'D:/project-a' });
  assert.match(text(h.render()), /已保存本机位置/);
  assert.equal(all(h.render({ busy: true })).find(n => n.type === 'input').props.disabled, true);
});

test('data health scans only on demand and queues only the exact confirmed repair preview', async () => {
  const requests = [];
  const h = harness(
    (url, options) => {
      requests.push({ url, body: options?.body ? JSON.parse(options.body) : null });
      if (url.endsWith('/scan'))
        return response({
          ok: true,
          checkedLogs: 1,
          issues: [
            { key: 'damaged-log', kind: 'log', file: 'session.jsonl', message: '残缺日志', action: '预览可恢复内容' },
          ],
          workspaces: [],
        });
      const body = options?.body ? JSON.parse(options.body) : {};
      if (url.endsWith('/preview'))
        return response(
          body.candidateHash
            ? { ok: true, planId: 'exact-plan', warning: '保留原件，退出后修复', files: [{ file: 'session.jsonl' }] }
            : {
                ok: true,
                issue: { key: 'damaged-log' },
                warning: '请选择可靠来源',
                candidates: [{ hash: 'candidate-hash', source: '完整备份' }],
              },
        );
      return response({ ok: true, queued: true, hint: '已安排' });
    },
    'DataHealth',
    { timers: false, confirm: () => true },
  );
  h.render();
  assert.equal(requests.length, 0);
  const button = label => all(h.render()).find(n => n.type === 'button' && text(n) === label);
  await button('检查本机数据').props.onClick();
  await button('预览可恢复内容').props.onClick();
  await button('完整备份').props.onClick();
  assert.equal(
    requests.some(r => r.url.endsWith('/queue')),
    false,
  );
  await button('确认预览，安排修复').props.onClick();
  assert.deepEqual(requests.find(r => r.url.endsWith('/queue')).body, { planId: 'exact-plan' });
  assert.ok(button('取消修复安排'));
});

test('repair blockers open a dedicated repair page without acknowledging or starting sync', async () => {
  for (const [state, label] of [
    [
      { dataVerificationPending: true, lastOk: false, lastDetail: { error: 'old saved repair message' } },
      '前往核对修复结果',
    ],
    [{ queuedRepairs: 1, lastOk: false }, '前往处理修复安排'],
  ]) {
    const calls = [];
    const h = harness(
      url => {
        calls.push(url);
        return response(
          url.endsWith('/status')
            ? { ok: true, remote: 'https://github.com/fixture/data', ...state }
            : { ok: true, config: initial },
        );
      },
      'Section',
      { timers: false },
    );
    let closed = 0;
    const sectionProps = { close: () => closed++ };
    h.render(sectionProps);
    await h.effects();
    let tree = h.render(sectionProps);
    assert.match(text(tree), /同步已暂停/);
    const jump = all(tree).find(n => n.type === 'button' && text(n) === label);
    assert.equal(jump.props['aria-controls'], 'dss-repair-page');
    jump.props.onClick();
    tree = h.render(sectionProps);
    assert.deepEqual(h.navigationCalls, ['dsh-sync-repair']);
    assert.equal(closed, 1, 'leaving the native Settings modal uses its owner-provided close action');
    assert.equal(
      all(tree).some(n => n.type?.name === 'DataHealth'),
      false,
    );
    assert.equal(
      calls.some(url => /\/verify$|\/run$|\/scan$/.test(url)),
      false,
    );
  }
});

test('repair verification stays visible and clears only after successful explicit acknowledgment', async () => {
  let succeeds = false,
    changed = 0;
  const calls = [];
  const props = { expanded: true, onVerified: () => changed++ };
  const h = harness(
    url => {
      calls.push(url);
      return response(
        url.endsWith('/scan')
          ? { ok: true, checkedLogs: 0, issues: [], verificationPending: true }
          : succeeds
            ? { ok: true, hint: '已记录，可以手动同步' }
            : { ok: false, error: '保存失败' },
      );
    },
    'DataHealth',
    { timers: false },
  );
  h.render(props);
  await h.effects();
  let tree = h.render(props);
  assert.match(text(tree), /左侧项目和会话列表.*最近几条消息.*立即同步/);
  assert.equal(calls.filter(url => url.endsWith('/scan')).length, 1);
  assert.equal(
    calls.some(url => url.endsWith('/verify')),
    false,
  );
  assert.equal(tree.type, 'section');
  assert.equal(tree.props.onToggle, undefined);
  const confirm = () => all(h.render(props)).find(n => n.type === 'button' && text(n) === '已检查修复结果，允许同步');
  await confirm().props.onClick();
  assert.ok(confirm());
  assert.equal(changed, 0);
  assert.match(text(h.render(props)), /保存失败/);
  succeeds = true;
  await confirm().props.onClick();
  assert.equal(confirm(), undefined);
  assert.equal(changed, 1);
  assert.equal(
    calls.some(url => url.endsWith('/run')),
    false,
  );
});

test('daily summary shows effective automation and actionable state without connection metadata or manual restart', async () => {
  for (const [state, expected] of [
    [{ lastOk: true }, '同步正常'],
    [{ lastOk: false }, '同步异常'],
    [{ lastOk: false, dataVerificationPending: true }, '修复完成，待你核对'],
    [{ lastOk: false, dataVerificationPending: true, lastDetail: { cancelled: true } }, '修复完成，待你核对'],
    [{ lastOk: true, lastDetail: { downloadPending: true } }, '有内容待取回'],
    [{ lastOk: false, lastDetail: { needsReview: true } }, '等待确认'],
    [{ lastOk: false, lastDetail: { cancelled: true } }, '已取消'],
    [{ queuedRepairs: 1 }, '有修复待应用'],
    [{}, '尚未同步'],
  ]) {
    const h = harness(
      url =>
        response(
          url.endsWith('/status')
            ? {
                ok: true,
                remote: 'https://github.com/fixture/hidden.git',
                branch: 'hidden-branch',
                workspaceCount: 3,
                auto: true,
                ...state,
              }
            : { ok: true, config: initial },
        ),
      'Section',
      { timers: false },
    );
    h.render();
    await h.effects();
    const tree = h.render();
    const summary = all(tree).find(n => n.props.id === 'dss-run');
    assert.match(text(summary), new RegExp('自动同步已开启 · ' + expected));
    assert.doesNotMatch(text(tree), /hidden.git|hidden-branch|3 个工作区|立即重启|手动重启|交接与换机检查/);
    assert.ok(!all(summary).some(n => n.props['aria-label'] === '同步后分组检查'));
    const settings = all(tree).find(n => n.props['data-sync-settings']);
    assert.equal(settings.type, 'div');
    assert.ok(
      all(h.render())
        .find(n => n.props['data-sync-settings'])
        .children.flatMap(all)
        .some(n => n.props['aria-label'] === '同步后分组检查'),
    );
  }
  assert.doesNotMatch(source, /API\.restart|dsh-sync-restart-guide|取消会保留已完成/);
});

test('ungrouped notice survives failed startup, deduplicates dismissal and rearms after unarchive', async () => {
  let poll,
    snapshot = { ok: true, enabled: true, count: 0, signature: '', busy: false };
  const requests = [];
  const h = harness(
    url => {
      requests.push(url);
      return response(snapshot);
    },
    'GroupingRepairOverlay',
    {
      timers: false,
      interval: fn => {
        poll = fn;
        return 0;
      },
    },
  );
  h.render();
  await h.effects();
  assert.equal(h.render(), null);
  snapshot = { ...snapshot, count: 1, signature: 'old', issueKey: 'membership:old' };
  await poll();
  assert.equal(h.render(), null);
  await poll();
  let tree = h.render();
  assert.match(text(tree), /发现 1 个未分组会话/);
  assert.ok(
    requests.every(url => url.endsWith('/grouping')),
    'no dependency on startup success or network sync',
  );
  all(tree)
    .find(n => n.type === 'button' && text(n) === '稍后处理')
    .props.onClick();
  await poll();
  await poll();
  assert.equal(h.render(), null);
  snapshot = { ...snapshot, count: 0, signature: '' };
  await poll(); // archived
  snapshot = { ...snapshot, count: 1, signature: 'old' };
  await poll();
  await poll(); // unarchived
  tree = h.render();
  assert.match(text(tree), /发现 1 个未分组会话/);
  assert.equal(
    all(tree).some(n => n.type === 'details' || n.type?.name === 'DataHealth'),
    false,
  );
  assert.doesNotMatch(text(tree), /登记|完全退出|检查与修复|原件/);
  assert.deepEqual(
    all(tree)
      .filter(n => n.type === 'button')
      .map(text),
    ['去处理', '稍后处理'],
  );
  all(tree)
    .find(n => n.type === 'button' && text(n) === '去处理')
    .props.onClick();
  assert.deepEqual(h.navigationCalls, ['dsh-sync-repair']);
  assert.equal(h.render(), null);
});

test('grouping automation respects busy and disabled state', async () => {
  let poll,
    snapshot = { ok: true, enabled: false, count: 1, signature: 'a', busy: false };
  const h = harness(() => response(snapshot), 'GroupingRepairOverlay', {
    timers: false,
    interval: fn => {
      poll = fn;
      return 0;
    },
  });
  h.render();
  await h.effects();
  await poll();
  assert.equal(h.render(), null);
  snapshot.enabled = true;
  snapshot.busy = true;
  await poll();
  assert.equal(h.render(), null);
  snapshot.busy = false;
  await poll();
  assert.match(text(h.render()), /发现/);
  all(h.render())
    .find(n => text(n) === '稍后处理')
    .props.onClick();
});

test('the processing page shows grouped tasks directly, with no folded repair area or automatic write', async () => {
  const calls = [];
  const h = harness(
    (url, options) => {
      calls.push({ url, body: options?.body && JSON.parse(options.body) });
      return response(
        url.endsWith('/scan')
          ? {
              ok: true,
              checkedLogs: 1,
              issues: [],
              ungroupedSessions: [
                {
                  key: 'grouping:one',
                  kind: 'grouping',
                  sessionId: 'one',
                  file: 'sessions/encoded/log',
                  cwd: 'C:/old',
                  title: '我的旧聊天',
                },
              ],
            }
          : {
              ok: true,
              relocation: true,
              recoveryId: 'r',
              expectedHash: 'hash',
              workspaces: [{ id: 'w', title: '本机项目' }],
              warning: '原件保留',
            },
      );
    },
    'DataHealth',
    { timers: false },
  );
  const props = { expanded: true, grouping: true };
  h.render(props);
  await h.effects();
  let tree = h.render(props);
  assert.equal(tree.type, 'section');
  assert.match(text(tree), /1 个未分组会话.*我的旧聊天.*查看处理方案/);
  assert.doesNotMatch(text(tree), /保存位置|修复备份|尚未正确登记/);
  assert.equal(calls.length, 1);
  await all(tree)
    .find(n => n.type === 'button' && text(n) === '查看处理方案')
    .props.onClick();
  tree = h.render(props);
  assert.match(text(tree), /处理方案.*将此会话放入哪个本机项目/);
  assert.deepEqual(calls[1].body, { key: 'grouping:one', relocate: true });
  assert.equal(all(tree).find(n => n.type === 'button' && text(n) === '确认项目并恢复会话').props.disabled, true);
  assert.equal(
    calls.some(c => /\/import$|\/queue$/.test(c.url)),
    false,
  );
});

test('the dedicated repair page receives grouping navigation and always renders its task area', () => {
  const h = harness(() => response({ ok: true }), 'RepairPage', { timers: false });
  h.functions.openRepairPage({ mode: 'grouping' });
  const tree = h.render();
  assert.equal(tree.props['aria-label'], '处理未分组会话');
  const health = all(tree).find(n => n.type?.name === 'DataHealth');
  assert.equal(health.props.grouping, true);
  assert.equal(health.props.expanded, true);
  all(tree)
    .find(n => n.type === 'button' && text(n) === '返回同步')
    .props.onClick();
  assert.deepEqual(h.navigationCalls, ['dsh-sync-repair', 'dsh-sync']);
});

test('opening grouping repair previews the current issue and preserves an already queued plan', async () => {
  for (const queued of [0, 1]) {
    const requests = [];
    const h = harness(
      (url, options) => {
        requests.push({ url, body: options?.body && JSON.parse(options.body) });
        return response(
          url.endsWith('/scan')
            ? { ok: true, checkedLogs: 1, issues: [{ key: 'membership:a' }], queued }
            : { ok: true, planId: 'new-plan', warning: '原件保留' },
        );
      },
      'DataHealth',
      { timers: false },
    );
    h.render({ expanded: true, initialIssueKey: 'membership:a' });
    await h.effects();
    const tree = h.render({ expanded: true, initialIssueKey: 'membership:a' });
    assert.equal(
      requests.some(r => r.url.endsWith('/preview')),
      !queued,
    );
    assert.equal(
      requests.some(r => r.url.endsWith('/queue')),
      false,
    );
    assert.match(text(tree), queued ? /已有已确认的修复安排/ : /确认预览，安排修复/);
  }
});

test('startup errors stay nonmodal until an old-session send is attempted', async () => {
  const h = harness(
    () => response({ ok: true, allowed: false, startup: { required: true, phase: 'error', message: 'offline' } }),
    'StartupSyncOverlay',
    { timers: false },
  );
  h.render();
  await h.effects();
  assert.equal(h.render().type.name, 'UpdateNotice');
  assert.equal(
    all(h.render()).some(n => n.type === 'dialog'),
    false,
  );
  h.functions.showSendBlock({ sessionId: 'old', message: '消息未发送，输入内容已保留' });
  const tree = h.render();
  assert.match(text(tree), /还不能发送.*消息未发送.*输入内容已保留/);
  assert.ok(all(tree).some(n => n.type === 'button' && text(n) === '返回编辑'));
});

test('settings expose progress without a cancellation action', async () => {
  for (const component of ['Section']) {
    let finish;
    const calls = [];
    const h = harness(
      (url, options) => {
        calls.push(url);
        if (url.endsWith('/run'))
          return new Promise(resolve => {
            finish = resolve;
          });
        if (url.endsWith('/progress')) return response({ running: true, stage: 'fetch', label: '获取远端状态…' });
        return response(
          url.endsWith('/status')
            ? { ok: true, remote: 'https://github.com/u/data' }
            : { ok: true, config: initial, conflicts: [] },
        );
      },
      component,
      { timers: false },
    );
    h.render();
    await h.effects();
    const button = all(h.render()).find(n => n.type === 'button' && text(n).includes('立即同步'));
    const running = button.props.onClick({ currentTarget: null });
    await tick();
    await tick();
    const tree = h.render();
    assert.doesNotMatch(text(tree), /取消同步|正在停止/);
    assert.equal(
      calls.some(url => url.endsWith('/cancel')),
      false,
    );
    finish({ json: async () => ({ ok: true, summary: '同步完成', detail: {} }) });
    await running;
  }
});

test('content changes save immediately, failed saves return to the confirmed selection', async () => {
  let fail = true,
    saved,
    current = { ...initial };
  const h = harness((_url, options) => {
    if (!options) return response({ ok: true, config: current });
    saved = JSON.parse(options.body);
    if (fail) return response({ ok: false, error: 'fixture save failed' });
    current = { ...current, ...saved };
    return response({ ok: true, config: current });
  });
  h.render();
  await h.effects();
  await all(h.render())
    .find(n => n.props['aria-label'] === '聊天附件')
    .props.onChange({ target: { checked: false } });
  assert.equal(saved.contentScope.attachments, false);
  assert.match(text(h.render()), /fixture save failed/);
  assert.equal(all(h.render()).find(n => n.props['aria-label'] === '聊天附件').props.checked, true);
  fail = false;
  await all(h.render())
    .find(n => n.props['aria-label'] === '聊天附件')
    .props.onChange({ target: { checked: false } });
  assert.equal(all(h.render()).find(n => n.props['aria-label'] === '聊天附件').props.checked, false);
  assert.match(text(h.render()), /已保存/);
});

test('manual transfer requires explicit preview confirmation and sends only its current ID', async () => {
  const requests = [];
  let detail = null;
  const h = harness(
    (url, options) => {
      if (url.endsWith('/run')) {
        requests.push(JSON.parse(options.body));
        detail =
          requests.length === 1
            ? { needsReview: true, review: { id: 'current-preview', summary: '本次删除较多' } }
            : {};
        return response({ ok: requests.length > 1, detail });
      }
      return response(
        url.endsWith('/status')
          ? { ok: true, remote: 'https://github.com/u/data', lastDetail: detail }
          : { ok: true, config: initial, conflicts: [] },
      );
    },
    'Section',
    {
      timers: false,
      confirm: () => {
        throw Error('must show inline preview');
      },
    },
  );
  h.render();
  await h.effects();
  const button = all(h.render()).find(n => n.type === 'button' && text(n).includes('立即同步'));
  await button.props.onClick({ currentTarget: null });
  await tick();
  await tick();
  assert.equal(requests.length, 1);
  const card = all(h.render()).find(n => n.type.name === 'TransferReview');
  assert.equal(card.props.review.summary, '本次删除较多');
  const view = harness(() => response({}), 'TransferReview', { timers: false });
  const tree = view.render(card.props);
  assert.match(text(tree), /本次删除较多/);
  await all(tree)
    .find(n => n.type === 'button')
    .props.onClick();
  await tick();
  await tick();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].approval, 'current-preview');
  assert.equal(all(h.render()).find(n => n.type.name === 'TransferReview').props.review, null);
});

test('a missing-files preview offers deleting and restoring as separate answers', async () => {
  const answers = [];
  const view = harness(() => response({}), 'TransferReview', { timers: false });
  const tree = view.render({
    review: {
      id: 'delete-id',
      summary: '这台电脑上缺少 12 个之前已同步的文件',
      confirmLabel: '确认删除',
      alternatives: [{ id: 'restore-id', action: 'restore', label: '从远端取回' }],
    },
    busy: false,
    onConfirm: id => answers.push(id),
  });
  const buttons = all(tree).filter(n => n.type === 'button');
  assert.deepEqual(buttons.map(text), ['确认删除', '从远端取回']);
  buttons[1].props.onClick();
  buttons[0].props.onClick();
  assert.deepEqual(answers, ['restore-id', 'delete-id']);
});

test('startup running, offline and old review snapshots never open a dialog by themselves', async () => {
  for (const phase of ['running', 'review', 'error', 'pending', 'offline']) {
    const h = harness(
      () => response({ ok: true, startup: { required: true, phase, review: { summary: 'stale' } } }),
      'StartupSyncOverlay',
      { timers: false },
    );
    h.render();
    await h.effects();
    assert.equal(
      all(h.render()).some(n => n.type === 'dialog'),
      false,
      phase,
    );
    assert.equal(h.render().type.name, 'UpdateNotice');
  }
});

test('composer preflight rejects queue, steer and attachment sends before transport, and never resends automatically', async () => {
  let allowed = false,
    calls = 0;
  const h = harness(() => response({ ok: true, allowed, message: '消息未发送' }), 'StartupSyncOverlay', {
    timers: false,
  });
  h.render();
  await h.effects();
  const service = {
    async sendSession() {
      calls++;
      return { kind: 'success' };
    },
  };
  const restore = h.functions.installSendProtection(service),
    attachmentIds = ['keep-file'];
  for (const mode of ['queue', 'steer']) {
    assert.equal((await service.sendSession({ sessionId: 'old' }, 'keep draft', attachmentIds, mode)).kind, 'error');
    assert.equal(calls, 0);
    assert.deepEqual(attachmentIds, ['keep-file']);
  }
  assert.match(text(h.render()), /还不能发送/);
  allowed = true;
  await tick();
  assert.equal(calls, 0);
  assert.equal((await service.sendSession({ sessionId: 'old' }, 'keep draft', attachmentIds, 'queue')).kind, 'success');
  assert.equal(calls, 1);
  restore();
});

test('startup distinguishes actual transfer percentage and unknown progress', () => {
  const transfer = harness(() => response({}), 'TransferLine', { timers: false });
  const t = transfer.render({ t: { op: 'fetch', pct: 72, done: 72, total: 100, size: 1048576, speed: 524288 } });
  assert.equal(all(t).find(n => n.props.role === 'progressbar').props['aria-valuenow'], 72);
  assert.match(text(t), /72%/);
  assert.match(text(t), /72 \/ 100/);
  const p = harness(() => response({}), 'StartupProgress', { timers: false });
  const waiting = p.render({
    progress: { stage: 'wait-lock', label: '等待', startedAt: Date.now() },
    phase: 'running',
  });
  assert.match(text(waiting), /另一端正在同步/);
  assert.equal(all(waiting).find(n => n.props.role === 'progressbar').props['aria-valuenow'], undefined);
});

test('switches save only their changed fields without a save button or setup navigation', async () => {
  const requests = [];
  let current = { ...initial },
    refreshed = 0,
    continued = 0;
  const h = harness((_url, options) => {
    if (!options) return response({ ok: true, config: current });
    const patch = JSON.parse(options.body);
    requests.push(patch);
    current = { ...current, ...patch };
    return response({ ok: true, config: current });
  });
  const props = { onChanged: () => refreshed++, onSaved: () => continued++ };
  h.render(props);
  await h.effects();
  await all(h.render(props))
    .find(n => n.props['aria-label'] === '自动同步')
    .props.onClick();
  await all(h.render(props))
    .find(n => n.props['aria-label'] === '项目文件')
    .props.onChange({ target: { checked: false } });
  assert.deepEqual(requests, [{ automatic: false }, { workspaceSync: false }]);
  assert.equal(refreshed, 2);
  assert.equal(continued, 0);
  const tree = h.render(props);
  assert.equal(tree.type, 'div');
  assert.ok(!all(tree).some(n => n.props.type === 'submit'));
  assert.match(text(tree), /已保存/);
  assert.match(text(tree), /上传或附加到对话的图片、文件/);
  assert.match(text(tree), /项目文件夹中的文件/);
  assert.doesNotMatch(text(tree), /修改后需保存|当前自动同步已关闭|始终使用已保存/);
});

test('legacy auto mode never exposes periodic or idle upload controls', async () => {
  const h = harness(() => response({ ok: true, config: { ...initial, mode: 'auto', intervalSeconds: 30 } }));
  h.render();
  await h.effects();
  const tree = h.render();
  assert.equal(all(tree).filter(n => n.props.type === 'number').length, 0);
  assert.doesNotMatch(text(tree), /后台检查|空闲后|每.*分钟/);
  assert.ok(all(tree).find(n => n.props['aria-label'] === '启动时自动同步').props.checked);
  assert.ok(all(tree).find(n => n.props['aria-label'] === '退出时自动同步').props.checked);
});

test('one immediate master switch respects explicit pauses regardless of legacy mode', async () => {
  for (const mode of ['manual', 'auto'])
    for (const enabled of [false, true]) {
      const requests = [];
      let current = { ...initial, mode, enabled };
      const h = harness((_url, options) => {
        if (options) {
          const patch = JSON.parse(options.body);
          requests.push(patch);
          current = { ...current, ...patch };
        }
        return response({ ok: true, config: current });
      });
      h.render();
      await h.effects();
      const tree = h.render();
      assert.equal(all(tree).filter(n => n.props.role === 'switch').length, 1);
      assert.equal(all(tree).find(n => n.props.role === 'switch').props['aria-checked'], enabled);
      assert.equal(all(tree).filter(n => n.props.type === 'checkbox').length, 7);
      assert.deepEqual(requests, []);
      await all(tree)
        .find(n => n.props.role === 'switch')
        .props.onClick();
      assert.deepEqual(requests, [{ automatic: !enabled }]);
    }
});

test('default backup needs no address or checkbox and saves automatic repository creation', async () => {
  const calls = [];
  const h = harness((url, options) => {
    if (options) calls.push({ url, body: JSON.parse(options.body) });
    return response({ ok: true, config: { remote: '', autoRepo: true } });
  }, 'ConnectionSettings');
  h.render();
  await h.effects();
  const tree = h.render();
  assert.equal(
    all(tree).some(n => n.type === 'input'),
    false,
  );
  assert.match(text(tree), /使用默认备份/);
  await tree.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(calls, [{ url: '/dsh-sync/api/connection', body: { remote: '', expectedRemote: '' } }]);
  assert.match(text(h.render()), /首次同步/);
});

test('configured backup hides its address until an explicit edit and cancel discards the draft without saving', async () => {
  let posts = 0;
  const remote = 'git@github.com:alice/dsh-sync2.git';
  const h = harness((_url, options) => {
    if (options) posts++;
    return response({ ok: true, config: { remote, autoRepo: false } });
  }, 'ConnectionSettings');
  h.render();
  await h.effects();
  let tree = h.render();
  assert.equal(
    all(tree).some(n => n.type === 'input'),
    false,
  );
  assert.ok(all(tree).some(n => n.props.href === 'https://github.com/alice/dsh-sync2'));
  all(tree)
    .find(n => n.type === 'button' && text(n) === '更换备份仓库')
    .props.onClick();
  tree = h.render();
  all(tree)
    .find(n => n.type === 'input')
    .props.onChange({ target: { value: 'https://github.com/alice/draft.git' } });
  tree = h.render();
  all(tree)
    .find(n => n.type === 'button' && text(n) === '取消')
    .props.onClick();
  h.render();
  await h.effects();
  assert.equal(
    all(h.render()).some(n => n.type === 'input'),
    false,
  );
  assert.equal(posts, 0);
  all(h.render())
    .find(n => n.type === 'button' && text(n) === '更换备份仓库')
    .props.onClick();
  assert.equal(all(h.render()).find(n => n.type === 'input').props.value, remote);
});

test('connection form submits a custom repository for server verification', async () => {
  let saved;
  const config = { remote: '', branch: 'my-existing-backup', autoRepo: true };
  const h = harness((_url, options) => {
    if (!options) return response({ ok: true, config });
    assert.equal(_url, '/dsh-sync/api/connection');
    saved = JSON.parse(options.body);
    return response({ ok: true, config: { ...config, remote: saved.remote, autoRepo: false } });
  }, 'ConnectionSettings');
  h.render();
  await h.effects();
  all(h.render())
    .find(n => n.type === 'button' && text(n) === '使用其他仓库')
    .props.onClick();
  let tree = h.render();
  all(tree)
    .find(n => n.type === 'input' && n.props.type === 'text')
    .props.onChange({ target: { value: ' https://github.com/alice/existing.git ' } });
  tree = h.render();
  await tree.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(saved, { remote: 'https://github.com/alice/existing.git', expectedRemote: '' });
  assert.match(text(h.render()), /已验证并保存备份仓库/);
  assert.equal(
    all(h.render()).some(n => n.type === 'input'),
    false,
  );
  assert.doesNotMatch(text(tree), /同步分支|新建私有仓库/);
  assert.ok(
    all(tree)
      .filter(n => n.type === 'a')
      .every(n => n.props.href.startsWith('https://') && n.props.rel.includes('noopener')),
  );
});

test('connection form preserves user input on failure and blocks writes while syncing', async () => {
  let posts = 0;
  const h = harness((_url, options) => {
    if (!options)
      return response({
        ok: true,
        config: { remote: 'https://github.com/alice/data.git', branch: 'main', autoRepo: false },
      });
    posts++;
    return response({ ok: false, error: '请完成同步后重试' });
  }, 'ConnectionSettings');
  h.render();
  await h.effects();
  await h.render({ busy: true }).props.onSubmit({ preventDefault() {} });
  assert.equal(posts, 0);
  all(h.render())
    .find(n => n.type === 'button' && text(n) === '更换备份仓库')
    .props.onClick();
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
  h.render({ remote: '' });
  await h.effects();
  all(h.render())
    .find(n => n.type === 'button' && text(n) === '使用其他仓库')
    .props.onClick();
  all(h.render({ remote: '' }))
    .find(n => n.type === 'input')
    .props.onChange({ target: { value: 'https://github.com/alice/draft.git' } });
  h.render({ remote: 'https://github.com/alice/auto-created.git' });
  await h.effects();
  const tree = h.render({ remote: 'https://github.com/alice/auto-created.git' });
  assert.equal(all(tree).find(n => n.type === 'input').props.value, 'https://github.com/alice/draft.git');
  assert.equal(calls, 1);
});

test('failed config loading offers a working retry', async () => {
  let calls = 0;
  const h = harness(() =>
    ++calls === 1 ? Promise.reject(new Error('连接失败')) : response({ ok: true, config: initial }),
  );
  h.render();
  await h.effects();
  let tree = h.render();
  assert.match(text(tree), /连接失败/);
  all(tree)
    .find(n => n.type === 'button')
    .props.onClick();
  h.render();
  await h.effects();
  tree = h.render();
  assert.ok(all(tree).some(n => n.props.role === 'switch'));
  assert.equal(calls, 2);
});

test('a malformed success response is a recoverable load error', async () => {
  const h = harness(() => response({ ok: true }));
  h.render();
  await h.effects();
  assert.match(text(h.render()), /无法读取同步偏好/);
});

test('failed immediate toggles show the actual persisted value and the error', async () => {
  const h = harness((_url, options) =>
    response(options ? { ok: false, error: '磁盘只读' } : { ok: true, config: initial }),
  );
  h.render();
  await h.effects();
  await all(h.render())
    .find(n => n.props['aria-label'] === '自动同步')
    .props.onClick();
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
  h.render();
  await h.effects();
  const tree = h.render({ busy: true });
  assert.equal(all(tree).find(n => n.type === 'fieldset').props.disabled, true);
  await all(tree)
    .find(n => n.props.role === 'switch')
    .props.onClick();
  assert.equal(posts, 0);
  assert.equal(all(tree).find(n => n.props.role === 'switch').props['aria-checked'], false);
});

test('pending immediate saves prevent same-tick duplicate writes and report their pending state', async () => {
  let finish,
    posts = 0;
  const pending = [];
  const h = harness((_url, options) => {
    if (!options) return response({ ok: true, config: initial });
    posts++;
    return new Promise(resolve => {
      finish = () => resolve({ json: async () => ({ ok: true, config: { ...initial, automatic: true } }) });
    });
  });
  const props = { onSavingChange: value => pending.push(value) };
  h.render(props);
  await h.effects();
  const button = all(h.render(props)).find(n => n.props.role === 'switch');
  const saving = button.props.onClick();
  await button.props.onClick();
  assert.equal(posts, 1);
  assert.equal(all(h.render(props)).find(n => n.type === 'fieldset').props.disabled, true);
  assert.deepEqual(pending, [true]);
  finish();
  await saving;
  assert.deepEqual(pending, [true, false]);
  assert.equal(all(h.render(props)).find(n => n.type === 'fieldset').props.disabled, false);
});

test('unsupported old repository is shown without silently converting it', async () => {
  const h = harness(
    () =>
      response({ ok: true, config: { remote: 'https://gitee.com/alice/data.git', branch: 'main', autoRepo: false } }),
    'ConnectionSettings',
  );
  h.render();
  await h.effects();
  assert.match(text(h.render()), /现有地址不受支持/);
  assert.equal(
    all(h.render()).some(n => n.type === 'input'),
    false,
  );
  all(h.render())
    .find(n => n.type === 'button' && text(n) === '更换备份仓库')
    .props.onClick();
  assert.equal(all(h.render()).find(n => n.type === 'input').props.value, 'https://gitee.com/alice/data.git');
  assert.equal(
    all(h.render()).some(n => n.props.type === 'password'),
    false,
  );
});

test('first setup shows only the current step and saving advances', async () => {
  const h = harness(
    url => response(url.endsWith('/status') ? { ok: true, remote: '' } : { ok: true, config: initial, conflicts: [] }),
    'Section',
    { timers: false },
  );
  h.render();
  await h.effects();
  let tree = h.render();
  assert.ok(all(tree).some(n => n.type?.name === 'ConnectionSettings'));
  assert.ok(!all(tree).some(n => n.type?.name === 'SyncPreferences'));
  const nav = all(tree).find(n => n.props['aria-label'] === '同步设置步骤');
  assert.equal(all(nav).filter(n => n.type === 'button').length, 3);
  all(tree)
    .find(n => n.type?.name === 'ConnectionSettings')
    .props.onSaved();
  tree = h.render();
  assert.ok(!all(tree).some(n => n.type?.name === 'ConnectionSettings'));
  all(tree)
    .find(n => n.type?.name === 'SyncPreferences')
    .props.onSaved();
  tree = h.render();
  assert.ok(all(tree).some(n => n.props.id === 'dss-run'));
  assert.ok(!all(tree).some(n => n.props.id === 'dss-result'));
});

test('daily sync is the default for configured users after restart, success or failure', async () => {
  for (const lastOk of [null, true, false]) {
    const h = harness(
      url =>
        response(
          url.endsWith('/status')
            ? { ok: true, remote: 'https://github.com/u/data', lastOk, lastSyncAt: 1 }
            : { ok: true, config: initial, conflicts: [] },
        ),
      'Section',
      { timers: false },
    );
    h.render();
    await h.effects();
    let tree = h.render();
    assert.ok(all(tree).some(n => n.props.id === 'dss-run'));
    assert.ok(all(tree).some(n => n.type?.name === 'ConnectionSettings'));
    assert.ok(!all(tree).some(n => n.props['aria-label'] === '同步设置步骤'));
    assert.ok(!all(tree).some(n => n.type?.name === 'RecoveryCenter'));
    assert.equal(all(tree).find(n => n.props['data-sync-settings']).type, 'div');
    assert.ok(all(tree).some(n => n.type?.name === 'ConnectionSettings'));
    assert.ok(all(tree).some(n => n.type?.name === 'SyncPreferences'));
    assert.ok(!all(tree).some(n => n.type?.name === 'ContentScopeSettings'));
    assert.ok(
      all(tree).some(n => n.props.id === 'dss-run'),
      'settings disclosure never replaces daily sync',
    );
  }
});

test('startup and exit choices save independently without an interval setting', async () => {
  const requests = [];
  let current = { ...initial, automatic: true, autoPullOnStart: true, autoPushOnExit: true };
  const h = harness((_url, options) => {
    if (options) {
      const p = JSON.parse(options.body);
      requests.push(p);
      current = { ...current, ...p };
    }
    return response({ ok: true, config: current });
  });
  h.render();
  await h.effects();
  await all(h.render())
    .find(n => n.props['aria-label'] === '启动时自动同步')
    .props.onChange({ target: { checked: false } });
  await all(h.render())
    .find(n => n.props['aria-label'] === '退出时自动同步')
    .props.onChange({ target: { checked: false } });
  assert.deepEqual(requests, [{ autoPullOnStart: false }, { autoPushOnExit: false }]);
  assert.equal(all(h.render()).filter(n => n.props.type === 'number').length, 0);
});

test('lost save response is reconciled with the committed configuration', async () => {
  let current = { ...initial };
  const h = harness((_url, options) => {
    if (!options) return response({ ok: true, config: current });
    current = { ...current, ...JSON.parse(options.body) };
    return Promise.reject(new Error('response lost'));
  });
  h.render();
  await h.effects();
  await all(h.render())
    .find(n => n.props.role === 'switch')
    .props.onClick();
  assert.equal(all(h.render()).find(n => n.props.role === 'switch').props['aria-checked'], false);
  assert.match(text(h.render()), /response lost/);
  assert.doesNotMatch(text(h.render()), /已保存/);
});

test('unconfirmed save disables controls until a successful reread', async () => {
  let reads = 0,
    offline = true;
  const h = harness((_url, options) => {
    if (options) return Promise.reject(new Error('offline'));
    if (++reads > 1 && offline) return Promise.reject(new Error('offline'));
    return response({ ok: true, config: initial });
  });
  h.render();
  await h.effects();
  await all(h.render())
    .find(n => n.props.role === 'switch')
    .props.onClick();
  assert.match(text(h.render()), /保存状态未知/);
  assert.equal(all(h.render()).find(n => n.type === 'fieldset').props.disabled, true);
  offline = false;
  all(h.render())
    .find(n => n.type === 'button' && text(n) === '重新读取')
    .props.onClick();
  h.render();
  await h.effects();
  assert.equal(all(h.render()).find(n => n.type === 'fieldset').props.disabled, false);
});

test('host overrides are displayed without claiming the requested switch is enabled', async () => {
  const h = harness((_url, options) => response({ ok: true, config: { ...initial, automatic: false } }));
  h.render();
  await h.effects();
  await all(h.render())
    .find(n => n.props.role === 'switch')
    .props.onClick();
  assert.equal(all(h.render()).find(n => n.props.role === 'switch').props['aria-checked'], false);
  assert.match(text(h.render()), /受宿主配置限制/);
});

test('setup choices save in place and Continue advances without an interval write', async () => {
  let current = { ...initial, automatic: true },
    advanced = 0;
  const requests = [];
  const h = harness((_url, options) => {
    if (!options) return response({ ok: true, config: current });
    const patch = JSON.parse(options.body);
    requests.push(patch);
    current = { ...current, ...patch };
    return response({ ok: true, config: current });
  });
  const props = { setup: true, onSaved: () => advanced++ };
  h.render(props);
  await h.effects();
  await all(h.render(props))
    .find(n => n.props['aria-label'] === '项目文件')
    .props.onChange({ target: { checked: false } });
  assert.equal(advanced, 0);
  await all(h.render(props))
    .find(n => n.type === 'button' && text(n) === '继续')
    .props.onClick();
  assert.equal(advanced, 1);
  assert.deepEqual(requests, [{ workspaceSync: false }]);
});

test('pending preferences prevent connection writes and starting a transfer', async () => {
  const requests = [];
  const h = harness(
    (url, options) => {
      if (options) requests.push(url);
      return response(
        url.endsWith('/status')
          ? { ok: true, remote: 'https://github.com/u/data' }
          : { ok: true, config: initial, conflicts: [] },
      );
    },
    'Section',
    { timers: false },
  );
  h.render();
  await h.effects();
  all(h.render())
    .find(n => n.type?.name === 'SyncPreferences')
    .props.onSavingChange(true);
  const tree = h.render();
  assert.equal(all(tree).find(n => n.type === 'button' && text(n).includes('立即同步')).props.disabled, true);
  assert.equal(all(tree).find(n => n.type?.name === 'ConnectionSettings').props.busy, true);
  assert.deepEqual(requests, []);
});

test('legacy manual mode can enable lifecycle automation through the master switch', async () => {
  const requests = [];
  let current = { ...initial, enabled: false, automatic: false };
  const h = harness((_url, options) => {
    if (options) {
      const p = JSON.parse(options.body);
      requests.push(p);
      current = { ...current, ...p };
    }
    return response({ ok: true, config: current });
  });
  h.render();
  await h.effects();
  await all(h.render())
    .find(n => n.props.role === 'switch')
    .props.onClick();
  assert.deepEqual(requests, [{ automatic: true }]);
  assert.equal(current.mode, 'manual');
  assert.equal(all(h.render()).find(n => n.props.role === 'switch').props['aria-checked'], true);
  assert.doesNotMatch(text(h.render()), /自动操作已暂停/);
});

test('recovery preview opens a dedicated dialog, closes while busy and can reopen', async () => {
  let reads = 0;
  const record = {
    id: 'fixture',
    kind: 'main',
    path: 'storages/sync-meta/profiles/web/package.json.vmap.json',
    status: 'merged',
    versions: {},
    createdAt: 1,
  };
  const h = harness(() => {
    reads++;
    return response({
      ok: true,
      currentHash: 'a',
      local: { text: 'a\nb', sha256: 'a' },
      remote: { text: 'a\nc', sha256: 'b' },
    });
  }, 'RecoveryItem');
  const button = () => all(h.render({ record })).find(n => n.type === 'button' && /查看内容|关闭内容/.test(text(n)));
  assert.match(text(h.render({ record })), /package.json.vmap.json/);
  await button().props.onClick();
  assert.equal(button().props['aria-expanded'], true);
  const dialog = all(h.render({ record })).find(n => n.type?.name === 'RecoveryDialog');
  assert.ok(dialog);
  assert.equal(
    all(h.render({ record, busy: true })).find(n => n.type === 'button' && /关闭内容/.test(text(n))).props.disabled,
    false,
  );
  dialog.props.onClose();
  assert.equal(button().props['aria-expanded'], false);
  assert.ok(!all(h.render({ record })).some(n => n.type?.name === 'RecoveryComparison'));
  await button().props.onClick();
  assert.equal(reads, 2);
});

test('comparison aligns insertions, marks changed rows and links both scroll axes', () => {
  const h = harness(() => response({}), 'RecoveryComparison');
  const tree = h.render({
    preview: { local: { text: 'one\ntwo' }, remote: { text: 'zero\none\ntwo', truncated: true } },
  });
  const rows = all(tree).filter(n => n.props.className?.startsWith('dss-diff-line '));
  assert.equal(all(tree).filter(n => n.props['aria-label'] === '双方原件同步滚动比较').length, 1);
  assert.match(text(tree), /预览已截断/);
  assert.equal(rows.length, 1);
  assert.match(text(rows[0]), /zero/);
  const panes = all(tree).filter(n => n.props.className === 'dss-diff-pane');
  const left = { scrollTop: 0, scrollLeft: 0 },
    right = { scrollTop: 0, scrollLeft: 0 };
  panes[0].props.ref(left);
  panes[1].props.ref(right);
  left.scrollTop = 216;
  left.scrollLeft = 75;
  panes[0].props.onScroll({ currentTarget: left });
  assert.deepEqual(right, left);
  right.scrollTop = 72;
  right.scrollLeft = 12;
  panes[1].props.onScroll({ currentTarget: right });
  assert.deepEqual(left, right);
});

test('binary previews do not manufacture text differences, and large text is explicitly limited', () => {
  const h = harness(() => response({}), 'RecoveryComparison');
  const binary = h.render({ preview: { local: { binary: true }, remote: { missing: true } } });
  assert.match(text(binary), /不能进行文本差异比较/);
  assert.ok(!all(binary).some(n => /dss-diff-(add|remove)/.test(n.props.className || '')));
  const large = h.render({
    preview: { local: { text: 'line\n'.repeat(4000) }, remote: { text: 'line\n'.repeat(4000) } },
  });
  assert.match(text(large), /未计算差异.*预览已截断/);
});

test('recovery list omits file essays and keeps data repair outside conflict browsing', async () => {
  const record = {
    id: 'file',
    kind: 'ws',
    path: 'project/notes.md',
    status: 'merged',
    kept: 'local',
    createdAt: 1,
    guide: { meaning: 'long meaning', nextStep: 'long next step', evidence: 'long evidence' },
  };
  const item = harness(() => response({}), 'RecoveryItem').render({ record });
  assert.match(text(item), /notes.md.*已保留本机版本.*查看内容/);
  assert.doesNotMatch(text(item), /long meaning|long next step|long evidence|你需要做什么|文件用途说明依据/);
  const h = harness(() => response({ ok: true, records: [record] }), 'RecoveryCenter');
  assert.match(text(h.render()), /正在读取/);
  await h.effects();
  assert.ok(!all(h.render()).some(n => n.type?.name === 'DataHealth'));
  assert.equal(all(h.render()).filter(n => n.type?.name === 'RecoveryItem').length, 1);
});

test('historical originals stay collapsed and do not count as pending conflicts', async () => {
  const h = harness(() => response({ ok: true, records: [{ id: 'archived', category: 'history' }] }), 'RecoveryCenter');
  h.render();
  await h.effects();
  assert.match(text(h.render()), /没有待处理的冲突.*已处理记录与备份（1）/);
  assert.equal(all(h.render()).filter(n => n.type?.name === 'RecoveryItem').length, 0);
  const history = all(h.render()).find(n => n.type === 'details');
  history.props.onToggle({ currentTarget: { open: true } });
  assert.equal(all(h.render()).filter(n => n.type?.name === 'RecoveryItem').length, 1);
});

test('remote cleanup waits for every computer, and only retired ones can be confirmed past', async () => {
  const calls = [];
  const preview = {
    ok: true,
    files: ['ext-bridge-token', 'profiles/desktop/package.json'],
    minVersion: '0.21.0',
    previewId: 'p1',
    blockers: [{ deviceId: 'd1', deviceName: '设备 d1', reason: '仍是 0.20.3', appliedAt: 1 }],
  };
  const h = harness((url, options) => {
    calls.push({ url, body: options?.body && JSON.parse(options.body) });
    return response(options?.method === 'POST' ? { ok: true, removed: 2 } : preview);
  }, 'RemoteCleanup');
  h.render();
  await all(h.render())
    .find(n => n.type === 'button' && text(n) === '检查')
    .props.onClick();
  let tree = h.render();
  assert.match(text(tree), /远端有 2 个文件不再同步/);
  assert.match(text(tree), /还没有确认升级到 0\.21\.0/);
  const clean = () => all(h.render()).find(n => n.type === 'button' && text(n) === '清理远端文件');
  assert.equal(clean().props.disabled, true, 'a computer still on an older version blocks the cleanup');
  all(tree)
    .find(n => n.props['aria-label'] === '设备 d1 已不再使用')
    .props.onChange({ target: { checked: true } });
  assert.equal(clean().props.disabled, true, 'the removal itself still needs confirmation');
  all(h.render())
    .find(n => n.props['aria-label'] === '确认清理远端文件')
    .props.onChange({ target: { checked: true } });
  assert.equal(clean().props.disabled, false);
  await clean().props.onClick();
  assert.deepEqual(calls.at(-1), {
    url: '/dsh-sync/api/remote-cleanup',
    body: { previewId: 'p1', retiredDevices: ['d1'] },
  });
  assert.match(text(h.render()), /已从同步仓库的最新版本移除 2 个文件/);
});

test('handled records say how many are automatic backups and how many were conflicts', async () => {
  const records = [
    { id: 'b1', kind: 'scope-backup', category: 'history' },
    { id: 'b2', kind: 'scope-backup', category: 'history' },
    { id: 'b3', kind: 'restore-backup', category: 'history' },
    { id: 'c1', kind: 'main', status: 'merged', reviewState: 'archived', category: 'history' },
    { id: 'open', kind: 'main', status: 'merged', category: 'attention' },
  ];
  const h = harness(() => response({ ok: true, records }), 'RecoveryCenter');
  h.render();
  await h.effects();
  const shown = text(h.render());
  assert.match(shown, /有 1 条记录待核对/);
  assert.match(shown, /已处理记录与备份（4）/);
  assert.match(shown, /同步前自动备份 3 条/);
  assert.match(shown, /已处理的冲突 1 条/);
});

test('project restore sends the selected side and the preview hash, then refreshes records', async () => {
  const calls = [];
  let refreshed = 0;
  const record = { id: 'project', kind: 'ws', path: 'notes.md', createdAt: 1 };
  const h = harness(
    (url, options) => {
      if (url.endsWith('/preview'))
        return response({
          ok: true,
          canRestore: true,
          currentHash: 'current-hash',
          local: { text: 'old', sha256: 'local-hash' },
          remote: { text: 'new', sha256: 'remote-hash' },
        });
      calls.push(JSON.parse(options.body));
      return response({ ok: true });
    },
    'RecoveryItem',
    { confirm: () => true },
  );
  const props = { record, onRestored: () => refreshed++ };
  await all(h.render(props))
    .find(n => n.type === 'button')
    .props.onClick();
  await all(h.render(props))
    .find(n => n.type === 'button' && text(n) === '恢复远端原件')
    .props.onClick();
  assert.deepEqual(calls, [{ id: 'project', side: 'remote', expectedHash: 'current-hash' }]);
  assert.equal(refreshed, 1);
  assert.ok(!all(h.render(props)).some(n => n.type?.name === 'RecoveryDialog'));
});

test('global sidebar provider applies default visibility and retains main and settings entries when hidden', async () => {
  for (const showSidebarSync of [undefined, false]) {
    const h = harness(
      () => response({ ok: true, config: { ...initial, showSidebarSync } }),
      'SidebarVisibilityProvider',
      { timers: false },
    );
    assert.equal(h.slots.get('dsh-sync-sidebar-preference'), h.functions.SidebarVisibilityProvider);
    h.render();
    await h.effects();
    assert.equal(h.slots.has('dsh-sync'), showSidebarSync !== false);
    for (const key of ['dsh-sync-panel', 'dsh-sync-repair-panel', 'dsh-sync-manage']) assert.ok(h.slots.has(key));
  }
});

test('sidebar header switch immediately removes and restores only the sidebar entry, even while syncing', async () => {
  let current = { ...initial, showSidebarSync: true };
  const calls = [];
  const h = harness(
    (url, options) => {
      if (options) {
        const patch = JSON.parse(options.body);
        calls.push(patch);
        current = { ...current, ...patch };
      }
      return response({ ok: true, config: current });
    },
    'SidebarVisibilityToggle',
    { timers: false },
  );
  h.render({ busy: true });
  await h.effects();
  h.render({ busy: true });
  const toggle = () => all(h.render({ busy: true })).find(n => n.props.role === 'switch');
  assert.equal(toggle().props['aria-checked'], true);
  assert.equal(toggle().props.disabled, false);
  await toggle().props.onClick();
  assert.equal(h.slots.has('dsh-sync'), false);
  assert.equal(toggle().props['aria-checked'], false);
  assert.ok(h.slots.has('dsh-sync-panel'));
  await toggle().props.onClick();
  assert.equal(h.slots.has('dsh-sync'), true);
  assert.deepEqual(calls, [{ showSidebarSync: false }, { showSidebarSync: true }]);
});

test('sidebar preference reconciles a lost save response and rejects duplicate pending saves', async () => {
  let current = { ...initial, showSidebarSync: true },
    finish,
    posts = 0;
  const h = harness(
    (_url, options) => {
      if (!options) return response({ ok: true, config: current });
      posts++;
      current = { ...current, ...JSON.parse(options.body) };
      return new Promise((_resolve, reject) => {
        finish = () => reject(Error('响应丢失'));
      });
    },
    'SidebarVisibilityToggle',
    { timers: false },
  );
  h.render();
  await h.effects();
  const button = all(h.render()).find(n => n.props.role === 'switch');
  const pending = button.props.onClick();
  await button.props.onClick();
  assert.equal(posts, 1);
  finish();
  await pending;
  assert.equal(all(h.render()).find(n => n.props.role === 'switch').props['aria-checked'], false);
  assert.equal(h.slots.has('dsh-sync'), false);
  assert.match(text(h.render()), /响应丢失/);
});

test('daily and first setup headers always offer the sidebar visibility switch', async () => {
  for (const remote of ['', 'https://github.com/alice/data.git']) {
    const h = harness(
      url => response(url.endsWith('/status') ? { ok: true, remote } : { ok: true, config: initial }),
      'Section',
      { timers: false },
    );
    h.render();
    await h.effects();
    assert.equal(all(h.render()).filter(n => n.type?.name === 'SidebarVisibilityToggle').length, 1);
  }
});

test('old project history offers a bound preview before any confirmed rebuild', async () => {
  const calls = [];
  const h = harness((url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return response(
      url.endsWith('/preview')
        ? { ok: true, previewId: 'bound-preview', message: '旧提交保留，项目和远端不变' }
        : { ok: true, message: '请再次点击立即同步' },
    );
  }, 'WorkspaceHistoryRepair');
  const props = { workspaceId: 'project-a' };
  let tree = h.render(props);
  assert.equal(calls.length, 0);
  await all(tree)
    .find(n => n.type === 'button')
    .props.onClick();
  tree = h.render(props);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { workspaceId: 'project-a' });
  assert.match(text(tree), /保留备份并重建待上传历史/);
  await all(tree)
    .find(n => n.type === 'button')
    .props.onClick();
  tree = h.render(props);
  assert.deepEqual(calls[1].body, { previewId: 'bound-preview' });
  assert.match(text(tree), /再次点击立即同步/);
});

test('local storage UI waits for inspection, previews selected items and requires confirmation before deletion', async () => {
  const calls = [];
  const item = {
    id: 'backup-a',
    name: '旧备份',
    path: 'C:/fixture/backup-a',
    bytes: 1024,
    category: 'config',
    protected: false,
  };
  const scan = {
    ok: true,
    totalBytes: 1024,
    policy: { retentionDays: 30 },
    categories: [{ id: 'config', title: '配置历史', bytes: 1024, purpose: '恢复旧配置' }],
    items: [item],
    warnings: [],
    note: '逻辑大小',
  };
  const h = harness((url, options) => {
    const body = options?.body && JSON.parse(options.body);
    calls.push({ url, body });
    if (url.endsWith('/preview'))
      return response({
        ok: true,
        token: 'preview-token',
        items: [item],
        warning: '永久移除',
        separateConfirmation: true,
      });
    if (url.endsWith('/apply')) return response({ ok: true, removedBytes: 1024, results: [{ id: item.id, ok: true }] });
    return response(scan);
  }, 'LocalStorage');
  let tree = h.render();
  await h.effects();
  assert.equal(calls.length, 0);
  await all(tree)
    .find(n => n.type === 'button' && text(n) === '查看占用并清理')
    .props.onClick();
  tree = h.render();
  all(tree)
    .find(n => n.type === 'input')
    .props.onChange({ target: { checked: true } });
  tree = h.render();
  await all(tree)
    .find(n => n.type === 'button' && text(n).startsWith('预览清理'))
    .props.onClick();
  const applyButton = () => all(h.render()).find(n => n.type === 'button' && text(n) === '永久清理所选本地备份');
  assert.equal(applyButton().props.disabled, true);
  assert.equal(
    calls.some(c => c.url.endsWith('/apply')),
    false,
  );
  tree = h.render();
  const confirmations = all(tree)
    .filter(n => n.type === 'input')
    .slice(-2);
  confirmations[0].props.onChange({ target: { checked: true } });
  assert.equal(applyButton().props.disabled, true);
  confirmations[1].props.onChange({ target: { checked: true } });
  assert.equal(applyButton().props.disabled, false);
  await applyButton().props.onClick();
  assert.deepEqual(calls.find(c => c.url.endsWith('/apply')).body, {
    token: 'preview-token',
    confirm: true,
    confirmSeparate: true,
  });
  assert.match(text(h.render()), /已移除/);
  assert.ok(
    all(h.render({ busy: true }))
      .filter(n => n.type === 'button')
      .every(n => n.props.disabled),
  );
});
