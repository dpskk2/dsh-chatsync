import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apply } from '../lib/index.js';
import { SyncEngine } from '../lib/sync.js';
import { digest } from '../lib/recovery.js';

test('host registers three read-only tools, without transmitting content or changing data', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-tools-'));
  const cleanup = [], tools = new Map();
  t.after(() => { cleanup.reverse().forEach(fn => fn()); fs.rmSync(home, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(home, 'dsh-sync.json'), JSON.stringify({ mode: 'manual', autoRepo: false, autoPullOnStart: false, autoPushOnExit: false }));
  fs.writeFileSync(path.join(home, '.credentials.yaml'), 'secret: test-only-do-not-expose');
  const before = fs.readdirSync(home);
  apply({ webServer: { register() { return () => {}; } }, tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
    on() { return () => {}; }, effect(fn) { cleanup.push(fn()); }, logger: { info() {}, warn() {}, debug() {} } }, { home, patches: false });
  // Model providers validate every advertised tool, even when the chat never calls one.
  assert.equal(tools.size, 3);
  assert.equal(tools.has('sync_patches'), false);
  for (const name of ['sync_status', 'sync_preview', 'sync_doctor']) {
    const parameters = JSON.parse(JSON.stringify(tools.get(name).parameters));
    assert.equal(parameters.type, 'object', `${name} must advertise an object-root schema`);
    assert.deepEqual(parameters.properties, {}, `${name} takes no named arguments`);
    assert.deepEqual(parameters.required, []);
    assert.equal(parameters.additionalProperties, false);
  }
  for (const name of ['sync_status', 'sync_preview', 'sync_doctor']) {
    assert.equal(tools.has(name), true);
    const output = await tools.get(name).execute();
    assert.doesNotMatch(output, /test-only-do-not-expose|\.credentials|chatsync-tools-/);
    JSON.parse(output);
  }
  assert.deepEqual(fs.readdirSync(home).filter(name => name !== '.dsh-sync-hosts'), before);
  assert.deepEqual(fs.readdirSync(path.join(home, '.dsh-sync-hosts')), [process.pid + '.json']);
});

test('a host without the web server keeps the plugin and its read-only tools running', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-noweb-'));
  const cleanup = [], tools = new Map(), warnings = [];
  t.after(() => { cleanup.reverse().forEach(fn => fn()); fs.rmSync(home, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(home, 'dsh-sync.json'), JSON.stringify({ mode: 'manual', autoRepo: false, autoPullOnStart: false, autoPushOnExit: false }));
  assert.doesNotThrow(() => apply({ tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
    on() { return () => {}; }, effect(fn) { cleanup.push(fn()); },
    logger: { info() {}, warn(line) { warnings.push(line); }, debug() {} } }, { home, patches: false }));
  assert.equal(tools.size, 3);
  assert.ok(warnings.some(line => line.includes('webServer 不可用')));
});

test('standalone diagnostic flags do not sync even with automatic repository defaults', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-cli-doctor-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL('../lib/cli.mjs', import.meta.url));
  for (const flag of ['--status', '--preview', '--doctor']) {
    const output = execFileSync(process.execPath, [cli, flag], { env: { ...process.env, DSH_HOME: home }, encoding: 'utf8', timeout: 10000 });
    assert.equal(typeof JSON.parse(output), 'object');
    assert.deepEqual(fs.readdirSync(home), []);
  }
});

test('device evidence expires and never carries across a different remote or branch', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-handoff-state-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const engine = new SyncEngine(home, { remote: 'https://github.com/example/private.git', branch: 'main' });
  fs.mkdirSync(path.join(home, '.chatsync-local'));
  fs.writeFileSync(path.join(home, '.chatsync-local', 'handoff.json'), JSON.stringify({
    connectionKey: digest(Buffer.from(JSON.stringify([engine.loadConfig().remote, 'main']))),
    peers: [{ deviceId: 'expired', appliedAt: Date.now() - 31 * 86400000 }, { deviceId: 'current', appliedAt: Date.now() }] }));
  assert.deepEqual(engine.handoffStatus().peers.map(p => p.deviceId), ['current']);
  engine.overrides.branch = 'another';
  assert.equal(engine.handoffStatus(), null);
  engine.overrides.branch = 'main'; engine.overrides.remote = 'https://github.com/example/other.git';
  assert.equal(engine.handoffStatus(), null);
});
