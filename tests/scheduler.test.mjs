import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncScheduler } from '../lib/scheduler.js';
import { DEFAULT_CONFIG } from '../lib/sync.js';
const settle = () => new Promise(resolve => setImmediate(resolve));
test('failed startup retries with bounded backoff, while success, cancellation and privacy stop retries', async () => {
  const timers = new Map(),
    delays = [];
  let key = 0,
    count = 0;
  const clock = {
    setTimeout(fn, ms) {
      delays.push(ms);
      timers.set(++key, fn);
      return key;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  const scheduler = createSyncScheduler({
    clock,
    loadConfig: () => ({ enabled: true, autoPullOnStart: true }),
    sync: async () => (++count < 4 ? { error: 'offline' } : {}),
  });
  scheduler.refresh({ startup: true });
  await settle();
  for (let i = 0; i < 3; i++) {
    const [id, run] = timers.entries().next().value;
    timers.delete(id);
    run();
    await settle();
  }
  assert.deepEqual(delays, [15000, 30000, 60000]);
  assert.equal(count, 4);
  assert.equal(timers.size, 0);
  scheduler.stop();
  for (const result of [{ cancelled: true }, { error: 'sensitive', privacy: {} }]) {
    const h = createSyncScheduler({ clock, loadConfig: () => ({ enabled: true }), sync: async () => result });
    h.refresh({ startup: true });
    await settle();
    assert.equal(timers.size, 0);
    h.stop();
  }
});
function setup(initial = {}) {
  const config = { ...DEFAULT_CONFIG, enabled: true, ...initial },
    calls = [];
  let timers = 0;
  const clock = {
    setInterval() {
      timers++;
    },
    setTimeout() {
      timers++;
    },
  };
  const scheduler = createSyncScheduler({
    loadConfig: () => config,
    clock,
    sync: async reason => {
      calls.push(reason);
      return {};
    },
  });
  return { config, calls, scheduler, timerCount: () => timers };
}
test('new connections enable automation while startup and exit options remain selectable', () => {
  assert.equal(DEFAULT_CONFIG.enabled, true);
  assert.equal(DEFAULT_CONFIG.autoPullOnStart, true);
  assert.equal(DEFAULT_CONFIG.autoPushOnExit, true);
});
test('both legacy modes and old intervals create no editing or periodic work', async () => {
  for (const mode of ['manual', 'auto']) {
    const h = setup({ mode, intervalSeconds: 30, eventDebounceSeconds: 5 });
    h.scheduler.refresh();
    for (let i = 0; i < 100; i++) {
      h.scheduler.onActivity();
      h.scheduler.refresh();
    }
    await settle();
    assert.deepEqual(h.calls, []);
    assert.equal(h.timerCount(), 0);
    h.scheduler.stop();
  }
});
test('startup is executed once independently of legacy manual mode', async () => {
  const h = setup();
  h.scheduler.refresh({ startup: true });
  await settle();
  h.scheduler.refresh({ startup: true });
  h.scheduler.onActivity();
  await settle();
  assert.deepEqual(h.calls, ['startup']);
  assert.equal(h.timerCount(), 0);
  h.scheduler.stop();
});
test('explicit startup or master disable is respected', async () => {
  for (const preference of [{ enabled: false }, { autoPullOnStart: false }]) {
    const h = setup(preference);
    h.scheduler.refresh({ startup: true });
    await settle();
    assert.deepEqual(h.calls, []);
    h.scheduler.stop();
  }
});
test('disposal cancels a queued startup without scheduling retries', async () => {
  const h = setup();
  h.scheduler.refresh({ startup: true });
  h.scheduler.stop();
  await settle();
  assert.deepEqual(h.calls, []);
  assert.equal(h.scheduler.active, false);
});
test('failed startup does not silently retry while the person edits', async () => {
  const config = { ...DEFAULT_CONFIG, enabled: true };
  let calls = 0;
  const scheduler = createSyncScheduler({
    loadConfig: () => config,
    sync: async () => {
      calls++;
      throw Error('offline');
    },
  });
  scheduler.refresh({ startup: true });
  await settle();
  for (let i = 0; i < 10; i++) {
    scheduler.onActivity();
    scheduler.refresh();
  }
  await settle();
  assert.equal(calls, 1);
  scheduler.stop();
});
