import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncScheduler } from '../lib/scheduler.js';
import { DEFAULT_CONFIG } from '../lib/sync.js';
const settle = () => new Promise(resolve => setImmediate(resolve));
function setup(initial = {}) {
  const config = { ...DEFAULT_CONFIG, enabled:true, ...initial }, calls = [];
  let timers = 0;
  const clock = { setInterval() { timers++; }, setTimeout() { timers++; } };
  const scheduler = createSyncScheduler({ loadConfig: () => config, clock,
    sync: async reason => { calls.push(reason); return {}; } });
  return { config, calls, scheduler, timerCount: () => timers };
}
test('new connections stay manual while startup and exit options remain selectable', () => {
  assert.equal(DEFAULT_CONFIG.enabled,false);
  assert.equal(DEFAULT_CONFIG.autoPullOnStart,true);
  assert.equal(DEFAULT_CONFIG.autoPushOnExit,true);
});
test('both legacy modes and old intervals create no editing or periodic work',async()=>{
  for(const mode of ['manual','auto']){
    const h=setup({mode,intervalSeconds:30,eventDebounceSeconds:5});
    h.scheduler.refresh();
    for(let i=0;i<100;i++){h.scheduler.onActivity();h.scheduler.refresh();}
    await settle();assert.deepEqual(h.calls,[]);assert.equal(h.timerCount(),0);
    h.scheduler.stop();
  }
});
test('startup is executed once independently of legacy manual mode',async()=>{
  const h=setup();h.scheduler.refresh({startup:true});await settle();
  h.scheduler.refresh({startup:true});h.scheduler.onActivity();await settle();
  assert.deepEqual(h.calls,['startup']);assert.equal(h.timerCount(),0);h.scheduler.stop();
});
test('explicit startup or master disable is respected',async()=>{
  for(const preference of [{enabled:false},{autoPullOnStart:false}]){
    const h=setup(preference);h.scheduler.refresh({startup:true});await settle();
    assert.deepEqual(h.calls,[]);h.scheduler.stop();
  }
});
test('disposal cancels a queued startup without scheduling retries',async()=>{
  const h=setup();h.scheduler.refresh({startup:true});h.scheduler.stop();await settle();
  assert.deepEqual(h.calls,[]);assert.equal(h.scheduler.active,false);
});
test('failed startup does not silently retry while the person edits',async()=>{
  const config={...DEFAULT_CONFIG,enabled:true};let calls=0;
  const scheduler=createSyncScheduler({loadConfig:()=>config,sync:async()=>{calls++;throw Error('offline');}});
  scheduler.refresh({startup:true});await settle();
  for(let i=0;i<10;i++){scheduler.onActivity();scheduler.refresh();}await settle();
  assert.equal(calls,1);scheduler.stop();
});
