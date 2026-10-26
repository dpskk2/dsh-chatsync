import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SyncEngine } from '../lib/sync.js';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-process-control-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const engine = new SyncEngine(home, { autoRepo: false, workspaceSync: false });
  return engine;
}

test('oversized subprocess output is stopped and never used as a successful API response', async t => {
  const engine = fixture(t);
  const result = await engine._spawn(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000));'], 5000, {
    maxOutputBytes: 100,
  });
  assert.equal(result.outputLimit, true);
  assert.ok(result.out.length <= 100);
});

test(
  'network timeout stops the owned subprocess tree and partial stdout never counts as success',
  { timeout: 10000 },
  async t => {
    const engine = fixture(t);
    const descendantFile = path.join(engine.home, 'descendant.pid');
    const childCode = 'process.stdout.write("partial HEAD\\n");setInterval(() => {}, 1000);';
    const code =
      'const {spawn}=require("node:child_process");const fs=require("node:fs");' +
      'const child=spawn(process.execPath,["-e",' +
      JSON.stringify(childCode) +
      '],{stdio:["ignore",process.stdout,process.stderr],windowsHide:true});' +
      'fs.writeFileSync(' +
      JSON.stringify(descendantFile) +
      ',String(child.pid));setInterval(()=>{},1000);';
    const start = Date.now();
    const result = await engine._spawn(process.execPath, ['-e', code], 1000);
    assert.equal(result.timedOut, true);
    assert.equal(engine.ok(result), false);
    assert.ok(Date.now() - start < 7000);
    assert.equal(engine.ok({ code: 0, timedOut: true, out: 'partial result' }), false);
    const pid = Number(fs.readFileSync(descendantFile, 'utf8'));
    // The process tree is known to be owned by this fixture. Give OS reaping a moment.
    let alive = true;
    for (let i = 0; i < 20; i++) {
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
        break;
      }
      if (process.platform === 'linux') {
        try {
          if (/\) Z /.test(fs.readFileSync('/proc/' + pid + '/stat', 'utf8'))) {
            alive = false;
            break;
          }
        } catch {
          alive = false;
          break;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(alive, false, 'The child network helper must not remain running after timeout');
  },
);
