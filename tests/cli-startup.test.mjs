import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SyncEngine } from '../lib/sync.js';

test('CLI approval preserves offline import mode, lock waiting and saved outcome', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-cli-approval-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(path.join(home, 'dsh-sync.json'), JSON.stringify({ autoRepo: false, patches: false }));
  const shim = path.join(home, 'fixture.mjs');
  fs.writeFileSync(
    shim,
    `import fs from 'node:fs';
import { SyncEngine } from ${JSON.stringify(new URL('../lib/sync.js', import.meta.url).href)};
let calls=[];
SyncEngine.prototype.syncOnce=async function(reason,options){calls.push({reason,options});
fs.writeFileSync(${JSON.stringify(path.join(home, 'calls.json'))},JSON.stringify(calls));
return calls.length===1?{needsReview:true,error:'等待确认',review:{id:'fixture-preview',summary:'合成预览'}}:{};};`,
  );
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(shim).href,
      fileURLToPath(new URL('../lib/cli.mjs', import.meta.url)),
      '--approve',
      'fixture-preview',
      '--startup-offline',
    ],
    {
      env: { ...process.env, DSH_HOME: home, DSH_SYNC_OVERRIDES_FILE: '' },
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const calls = JSON.parse(fs.readFileSync(path.join(home, 'calls.json')));
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.reason, 'startup-offline');
    assert.equal(call.options.offlineApply, true);
    assert.equal(call.options.waitForLock, true);
  }
  assert.equal(calls[1].options.approval, 'fixture-preview');
  const saved = JSON.parse(fs.readFileSync(path.join(home, '.dsh-sync-status.json')));
  assert.equal(saved.source, 'startup-offline');
  assert.equal(saved.result.error, undefined);
});

test('early review and connection failure retain timing and distinct terminal progress', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-review-timing-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const engine = new SyncEngine(home, { autoRepo: false, workspaceSync: false });
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  engine._syncOnce = async function () {
    this.step('fetch', '取回合成数据');
    clock += 25;
    this._reviewRequired = { id: 'fixture', summary: '需要确认' };
    return {};
  };
  const result = await engine.syncOnce('startup');
  assert.equal(result.needsReview, true);
  assert.equal(result.durationMs, 25);
  assert.equal(result.stages[0].stage, 'fetch');
  assert.equal(result.stages[0].ms, 25);
  assert.equal(engine.progress.stage, 'review');
  assert.ok(engine.progress.startedAt > 0);
  assert.doesNotMatch(engine.progress.label, /失败/);
  engine._syncOnce = async () => {
    clock += 5;
    return { error: 'connection failed' };
  };
  const failure = await engine.syncOnce('startup');
  assert.equal(engine.progress.stage, 'error');
  assert.equal(failure.needsReview, undefined);
  assert.equal(failure.durationMs, 5);
});
