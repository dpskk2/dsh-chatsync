import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const HOUR = 60 * 60 * 1000;

// Load the shipped bundle with a minimal React; only the progress/status/run transport is faked.
function harness(fetchImpl) {
  let hooks = [], cursor = 0, bundle, effects = [];
  const intervals = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks[i], next => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; }];
    },
    useRef(initial) { const [ref] = react.useState({ current: initial }); return ref; },
    // Mount effects run once, like the first commit in the host.
    useEffect(fn) { const i = cursor++; if (!(i in hooks)) { hooks[i] = true; effects.push(fn); } },
    useMemo: fn => fn(),
    useCallback: fn => fn,
  };
  vm.runInNewContext(source.replace('module.exports = {', 'module.exports = { testHooks: { useSync },'), {
    window: { __ModuleLoader__: { load(def) { bundle = def.factory(() => react); } } },
    fetch: fetchImpl, AbortSignal, setTimeout, clearTimeout,
    setInterval: fn => { intervals.push(fn); return intervals.length; },
    clearInterval: () => {},
  });
  return {
    render() {
      cursor = 0;
      const result = bundle.testHooks.useSync();
      const pending = effects; effects = []; pending.forEach(fn => fn());
      return result;
    },
    async poll() { await Promise.all(intervals.map(fn => fn())); await tick(); },
  };
}
const json = data => Promise.resolve({ ok: true, json: async () => data });

test('a new sync never shows the previous run as still in progress', async () => {
  const finishedAt = Date.now() - 3 * HOUR;
  let serverProgress = { running: false, stage: 'done', label: '同步完成', startedAt: finishedAt - 30_000, endedAt: finishedAt };
  const h = harness(url => {
    if (url.endsWith('/progress')) return json(serverProgress);
    if (url.endsWith('/status')) return json({ ok: true, remote: 'https://github.com/alice/dsh-sync.git' });
    if (url.endsWith('/run')) return new Promise(() => {}); // the server is still starting this run
    throw new Error('unexpected request ' + url);
  });
  const clickedAt = Date.now();
  h.render().run(null);
  await tick();
  // The finished record from three hours ago answered first.
  let sync = h.render();
  assert.equal(sync.busy, true);
  assert.ok(sync.progress, 'a starting run still shows progress');
  assert.ok(sync.progress.startedAt >= clickedAt, `elapsed must start at the click, not ${new Date(sync.progress.startedAt).toISOString()}`);
  assert.notEqual(sync.progress.label, '同步完成');
  // Once the server reports this run, its own start time is shown.
  const serverStart = Date.now();
  serverProgress = { running: true, stage: 'fetch', label: '获取远端…', startedAt: serverStart };
  await h.poll();
  sync = h.render();
  assert.equal(sync.progress.startedAt, serverStart);
  assert.equal(sync.progress.label, '获取远端…');
});

test('an idle page keeps the finished record and does not report a running sync', async () => {
  const finished = { running: false, stage: 'done', label: '同步完成', startedAt: Date.now() - HOUR, endedAt: Date.now() - HOUR + 5_000 };
  const h = harness(url => url.endsWith('/progress') ? json(finished) : json({ ok: true, remote: '' }));
  h.render();
  await h.poll();
  const sync = h.render();
  assert.equal(sync.busy, false);
  assert.equal(sync.progress.running, false);
  assert.equal(sync.progress.startedAt, finished.startedAt);
});
