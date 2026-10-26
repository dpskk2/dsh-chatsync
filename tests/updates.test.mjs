import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createUpdateChecker, isNewerVersion, updateCommand } from '../lib/updates.js';

const metadata = version => ({
  name: '@dpskk2/dsh-chatsync',
  version,
  dist: { tarball: 'https://registry.npmjs.org/@dpskk2/dsh-chatsync/-/dsh-chatsync-' + version + '.tgz' },
});

test('update commands pin the advertised version and official registry without disabling supply-chain policies', () => {
  assert.equal(
    updateCommand('web', '0.21.0'),
    'dsh plugin --profile web update @dpskk2/dsh-chatsync@0.21.0 --registry=https://registry.npmjs.org/',
  );
  assert.equal(
    updateCommand('desktop', '0.21.0'),
    '& "$env:LOCALAPPDATA\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd" plugin --profile desktop update @dpskk2/dsh-chatsync@0.21.0 --registry=https://registry.npmjs.org/',
  );
  for (const version of [undefined, '', 'latest', '0.21.0-beta.1', '0.21.0;whoami', '0.21.0\n']) {
    assert.throws(() => updateCommand('desktop', version));
  }
});

test('a newly advertised version is hidden until its own install tarball is available, then retried', async () => {
  let ready = false,
    time = 0,
    heads = 0;
  const check = createUpdateChecker({
    version: '0.20.0',
    now: () => time,
    fetchImpl: async (url, options) => {
      if (url.endsWith('.tgz')) {
        assert.equal(url, metadata('0.21.0').dist.tarball);
        assert.equal(options.method, 'HEAD');
        heads++;
        return { ok: ready };
      }
      return {
        ok: true,
        json: async () => (url.includes('registry.npmjs.org') ? metadata('0.21.0') : { tag_name: 'v0.21.0' }),
      };
    },
  });
  const unavailable = await check('desktop');
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.command, undefined);
  ready = true;
  await check('desktop');
  assert.equal(heads, 1);
  time += 10 * 60 * 1000;
  const available = await check('desktop');
  assert.equal(available.available, true);
  assert.match(available.command, /update @dpskk2\/dsh-chatsync@0\.21\.0 --registry=https:\/\/registry\.npmjs\.org\/$/);
});

test('wrong package identity, missing tarball and foreign tarball URLs never produce an update or external request', async () => {
  for (const value of [
    { version: '0.21.0' },
    { ...metadata('0.21.0'), name: 'another-package' },
    { ...metadata('0.21.0'), dist: { tarball: 'http://127.0.0.1/private' } },
    { ...metadata('0.21.0'), dist: { tarball: metadata('0.20.0').dist.tarball } },
  ]) {
    let calls = 0;
    const check = createUpdateChecker({
      version: '0.20.0',
      fetchImpl: async () => {
        calls++;
        return { ok: true, json: async () => value };
      },
    });
    const result = await check();
    assert.equal(result.available, false);
    assert.equal(result.command, undefined);
    assert.equal(calls, 1);
  }
});

test('stable versions compare numerically, without downgrading local builds', () => {
  for (const [latest, current, expected] of [
    ['0.20.0', '0.20.1-local.1', false],
    ['0.20.1', '0.20.1-local.1', true],
    ['0.20.0', '0.20.0', false],
    ['0.21.0', '0.20.9', true],
    ['1.0.0', '0.99.0', true],
    ['0.9.0', '0.10.0', false],
    ['0.21.0-beta.1', '0.20.0', false],
    ['bad', '0.20.0', false],
  ])
    assert.equal(isNewerVersion(latest, current), expected, `${latest} / ${current}`);
});

test('checks npm latest and matching release, shares requests and caches for six hours', async () => {
  let calls = 0,
    time = 1000;
  const check = createUpdateChecker({
    version: '0.20.0',
    now: () => time,
    fetchImpl: async (url, options) => {
      calls++;
      assert.ok(options.signal);
      return {
        ok: true,
        json: async () =>
          url.includes('registry.npmjs.org')
            ? metadata('0.21.0')
            : { tag_name: 'v0.21.0', body: '更新内容', draft: false, prerelease: false },
      };
    },
  });
  const [web, desktop] = await Promise.all([check('web'), check('desktop')]);
  assert.equal(calls, 3);
  assert.equal(web.available, true);
  assert.equal(web.notes, '更新内容');
  assert.equal(web.command, updateCommand('web', '0.21.0'));
  assert.match(desktop.command, /LOCALAPPDATA.*dsh.cmd.*--profile desktop/);
  assert.equal(web.releaseUrl, 'https://github.com/dpskk2/dsh-chatsync/releases/tag/v0.21.0');
  await check();
  assert.equal(calls, 3);
  time += 6 * 60 * 60 * 1000;
  await check();
  assert.equal(calls, 6);
});

test('unavailable network retries later; missing or mismatched notes never invent release contents', async () => {
  let calls = 0,
    time = 0;
  const failed = createUpdateChecker({
    now: () => time,
    fetchImpl: async () => {
      calls++;
      throw new Error('offline');
    },
  });
  assert.equal((await failed()).ok, false);
  await failed();
  assert.equal(calls, 1);
  time += 10 * 60 * 1000;
  await failed();
  assert.equal(calls, 2);
  for (const release of [
    null,
    { tag_name: 'v0.22.0', body: 'wrong' },
    { tag_name: 'v0.21.0', draft: true, body: 'draft' },
  ]) {
    const check = createUpdateChecker({
      version: '0.20.0',
      fetchImpl: async url => ({
        ok: true,
        json: async () => {
          if (url.includes('registry.npmjs.org')) return metadata('0.21.0');
          if (!release) throw new Error('missing');
          return release;
        },
      }),
    });
    const result = await check();
    assert.equal(result.available, true);
    assert.equal(result.notes, '');
  }
});

function ui(
  data,
  {
    seen = new Map(),
    clipboard = async () => {},
    global = false,
    startupState = { ok: true, startup: { phase: 'ready' }, progress: { running: false } },
  } = {},
) {
  let component,
    hooks = [],
    cursor = 0,
    effects = [],
    calls = 0;
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
      return react.useState({ current: initial })[0];
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!hooks[i] || deps.some((d, n) => d !== hooks[i][n])) effects.push(fn);
      hooks[i] = deps;
    },
    useMemo: fn => fn(),
    useCallback: fn => fn,
  };
  vm.runInNewContext(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: {
      innerWidth: 360,
      innerHeight: 740,
      addEventListener() {},
      removeEventListener() {},
      localStorage: { getItem: k => seen.get(k), setItem: (k, v) => seen.set(k, v) },
      navigator: { clipboard: { writeText: clipboard } },
      __ModuleLoader__: {
        load(def) {
          component = def.factory(() => react);
        },
      },
    },
    fetch: async url => {
      calls++;
      if (url === '/dsh-sync/api/startup') return { ok: true, json: async () => startupState };
      assert.equal(url, '/dsh-sync/api/update');
      return { json: async () => data };
    },
    AbortSignal,
    setInterval: () => 0,
    clearInterval() {},
    setTimeout,
    clearTimeout,
  });
  component.apply({ slots: { inject: (_n, cb) => cb(), register: (meta, fn) => slots.set(meta.id, fn) } });
  const flatten = n => (!n || typeof n !== 'object' ? [] : [n, ...n.children.flatMap(flatten)]);
  const Notice = flatten(slots.get('dsh-sync-manage')({})).find(n => n.type?.name === 'UpdateNotice').type;
  hooks = [];
  effects = [];
  cursor = 0;
  return {
    render(props = {}) {
      cursor = 0;
      return global ? slots.get('dsh-sync-startup')(props) : Notice(props);
    },
    async effects() {
      const pending = effects;
      effects = [];
      pending.forEach(fn => fn());
      await new Promise(resolve => setImmediate(resolve));
    },
    flatten,
    calls: () => calls,
  };
}
const words = n =>
  n == null || n === false ? '' : typeof n === 'object' ? n.children.map(words).join(' ') : String(n);
const available = {
  ok: true,
  available: true,
  latestVersion: '0.21.0',
  hostKind: 'desktop',
  notes: '**新增提醒**',
  command: updateCommand('desktop', '0.21.0'),
  releaseUrl: 'https://github.com/dpskk2/dsh-chatsync/releases/tag/v0.21.0',
};
const startup = { startup: true, anchorRef: { current: { getBoundingClientRect: () => ({ left: 16, top: 680 }) } } };

test('startup reminder appears once per version and remains available in settings after closing', async () => {
  const seen = new Map();
  const h = ui(available, { seen });
  h.render(startup);
  await h.effects();
  h.render(startup);
  await h.effects();
  let tree = h.render(startup);
  assert.match(words(tree), /ChatSync 有新版本.*新增提醒/);
  h.flatten(tree)
    .find(n => n.props['aria-label'] === '关闭更新提醒')
    .props.onClick();
  assert.equal(h.render(startup), null);
  const reopened = ui(available, { seen });
  reopened.render(startup);
  await reopened.effects();
  assert.equal(reopened.render(startup), null);
  const settings = ui(available, { seen });
  settings.render();
  await settings.effects();
  assert.match(words(settings.render()), /查看更新/);
  assert.equal(settings.flatten(settings.render()).find(n => n.type === 'details').props.open, undefined);
  const nextVersion = ui({ ...available, latestVersion: '0.22.0' }, { seen });
  nextVersion.render(startup);
  await nextVersion.effects();
  nextVersion.render(startup);
  await nextVersion.effects();
  assert.match(words(nextVersion.render(startup)), /0\.22\.0/);
});

test('clipboard success guides PowerShell; failure displays selectable command', async () => {
  for (const fail of [false, true]) {
    let copied;
    const h = ui(available, {
      clipboard: async command => {
        if (fail) throw new Error('denied');
        copied = command;
      },
    });
    h.render();
    await h.effects();
    await h
      .flatten(h.render())
      .find(n => n.type === 'button')
      .props.onClick();
    const tree = h.render();
    assert.match(words(tree), /PowerShell.*完全退出桌面应用/);
    if (fail) assert.equal(h.flatten(tree).find(n => n.type === 'pre').children[0], available.command);
    else {
      assert.equal(copied, available.command);
      assert.match(words(tree), /已复制更新代码/);
    }
  }
});

test('quiet when no release or check failed; busy sync defers first display', async () => {
  for (const data of [null, { ok: false }, { ok: true, available: false }]) {
    const h = ui(data);
    h.render(startup);
    await h.effects();
    assert.equal(h.render(startup), null);
  }
  const seen = new Map(),
    h = ui(available, { seen });
  h.render({ ...startup, busy: true });
  await h.effects();
  h.render({ ...startup, busy: true });
  await h.effects();
  assert.equal(seen.size, 0);
  assert.equal(h.render({ ...startup, busy: true }), null);
  h.render(startup);
  await h.effects();
  assert.ok(h.render(startup));
});

test('registered startup overlay mounts the update popup without opening settings or relying on a removed sidebar footer', async () => {
  for (const running of [false, true]) {
    const h = ui(available, {
      global: true,
      startupState: { ok: true, startup: { phase: running ? 'running' : 'ready' }, progress: { running } },
    });
    let node = h.render();
    assert.equal(node.type.name, 'UpdateNotice');
    assert.equal(node.props.startup, true);
    assert.equal(node.props.busy, true);
    await h.effects();
    node = h.render();
    assert.equal(node.type.name, 'UpdateNotice');
    assert.equal(node.props.busy, running);
    assert.equal(node.props.anchorRef, undefined);
    assert.equal(h.calls(), 1);
  }
});

test('global popup positions itself in the viewport when no footer anchor exists', async () => {
  const h = ui(available);
  const props = { startup: true, busy: false };
  h.render(props);
  await h.effects();
  h.render(props);
  await h.effects();
  const tree = h.render(props);
  assert.ok(tree);
  assert.equal(tree.type, 'aside');
  assert.equal(tree.props.style.right, 16);
  assert.equal(tree.props.style.top, 56);
  assert.match(tree.props.className, /dss-update-popup/);
  h.flatten(tree)
    .find(n => n.props['aria-label'] === '关闭更新提醒')
    .props.onClick();
  assert.equal(h.render(props), null);
});
