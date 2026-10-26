import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SyncEngine } from '../lib/sync.js';
import { scheduleOfflineSync } from '../lib/host-sync.js';

// Simulate only command transport: no test creates or runs a Windows task.
const desktop = [
  'DeepSeek Harness.exe',
  'C:\\Programs\\DSH\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js',
  'C:\\Programs\\DSH',
  'C:\\Users\\example\\.dsh\\profiles\\desktop',
];
function simulate(failure, repair = false) {
  const original = process.argv;
  process.argv = desktop;
  let xml, configFile, xmlFile;
  const calls = [];
  const engine = new SyncEngine(path.join(os.tmpdir(), 'long & 中文 home'), {
    workspaceSync: false,
    branch: 'custom',
    patches: true,
  });
  try {
    const result = scheduleOfflineSync(engine, {
      repair,
      runCommand(command, args) {
        calls.push([command, args]);
        if (command === 'whoami') return { status: 0, stdout: '"account","S-1-5-21-123-1001"' };
        if (args[0] === '/create') {
          xmlFile = args[args.indexOf('/xml') + 1];
          const bytes = fs.readFileSync(xmlFile);
          assert.equal(bytes.subarray(0, 2).toString('hex'), 'fffe');
          xml = bytes.toString('utf16le');
          assert.match(xml, /encoding="UTF-16"/);
          configFile = /-SyncConfig &quot;([^<]+?)&quot;/.exec(xml)[1];
          assert.deepEqual(JSON.parse(fs.readFileSync(configFile, 'utf8')), {
            workspaceSync: false,
            branch: 'custom',
            patches: false,
          });
        }
        return args[0] === failure ? { status: 1, stderr: 'test failure' } : { status: 0 };
      },
    });
    return { result, calls, xml, xmlFile, configFile };
  } finally {
    process.argv = original;
    if (configFile) {
      try {
        fs.unlinkSync(configFile);
      } catch {}
    }
  }
}
test(
  'offline task uses escaped long paths, current-user identity and preserved host overrides',
  { skip: process.platform !== 'win32' },
  () => {
    const h = simulate();
    assert.equal(h.result.scheduled, true);
    assert.match(h.xml, /long &amp; 中文 home/);
    assert.match(h.xml, /<UserId>S-1-5-21-123-1001<\/UserId>/);
    assert.match(h.xml, /LeastPrivilege/);
    assert.match(h.xml, /-SyncHome &quot;/);
    assert.match(h.xml, /-SyncHostEntry &quot;/);
    assert.ok(h.xml.includes(desktop[1]));
    assert.doesNotMatch(h.xml, /<Triggers>|HighestAvailable/);
    assert.equal(fs.existsSync(h.xmlFile), false);
    assert.equal(
      h.calls.some(([, args]) => args.includes('/tr')),
      false,
    );
  },
);
test(
  'task creation failure cleans temporary state and never launches a close',
  { skip: process.platform !== 'win32' },
  () => {
    const h = simulate('/create');
    assert.equal(h.result.scheduled, false);
    assert.equal(
      h.calls.some(([, args]) => args[0] === '/run'),
      false,
    );
    assert.equal(fs.existsSync(h.xmlFile), false);
    assert.equal(fs.existsSync(h.configFile), false);
  },
);
test('task start failure removes the unused task and reports failure', { skip: process.platform !== 'win32' }, () => {
  const h = simulate('/run');
  assert.equal(h.result.scheduled, false);
  assert.equal(
    h.calls.some(([, args]) => args[0] === '/delete'),
    true,
  );
  assert.equal(fs.existsSync(h.configFile), false);
});
test('unsupported hosts never schedule shutdown operations', () => {
  let called = false;
  const result = scheduleOfflineSync(new SyncEngine('unused'), {
    runCommand() {
      called = true;
    },
  });
  assert.equal(result.scheduled, false);
  assert.equal(called, false);
});

test(
  'confirmed repair restarts wait for the repair worker, without running ordinary network sync',
  { skip: process.platform !== 'win32' },
  () => {
    const h = simulate(undefined, true);
    assert.equal(h.result.scheduled, true);
    assert.match(h.xml, /data-repair-worker\.mjs/);
    assert.doesNotMatch(h.xml, /[\\/]cli\.mjs/);
  },
);
