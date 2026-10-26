import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { apply, requestRejection, MAX_REQUEST_BYTES } from '../lib/index.js';
import { replaceBytes, REPLACE_TEMP_SUFFIX } from '../lib/recovery.js';
import { readSettledSession, transportable } from '../lib/scope.js';

const tempDir = (t, prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

function host(t) {
  const home = tempDir(t, 'dsh-request-guard-');
  const routes = new Map(),
    cleanup = [];
  t.after(() => cleanup.reverse().forEach(fn => fn()));
  fs.writeFileSync(
    path.join(home, 'dsh-sync.json'),
    JSON.stringify({ mode: 'manual', autoRepo: false, autoPullOnStart: false, autoPushOnExit: false, enabled: true }),
  );
  apply(
    {
      webServer: {
        register(route) {
          routes.set(route.path, route.handler);
          return () => routes.delete(route.path);
        },
      },
      on() {
        return () => {};
      },
      effect(fn) {
        cleanup.push(fn());
      },
      logger: { info() {}, warn() {}, debug() {} },
    },
    { home, patches: false },
  );
  return async (endpoint, { method = 'POST', headers, chunks = [] } = {}) => {
    const req = new EventEmitter();
    req.method = method;
    if (headers) req.headers = headers;
    let status = 200;
    const result = new Promise(resolve => {
      routes.get('/dsh-sync/api/' + endpoint)(req, {
        writeHead(code) {
          status = code;
        },
        end(value) {
          resolve(JSON.parse(value));
        },
      });
    });
    await new Promise(resolve => setImmediate(resolve));
    for (const chunk of chunks) req.emit('data', chunk);
    req.emit('end');
    return { status, body: await result };
  };
}

test('requests marked by the browser as another site are rejected before any handler runs', () => {
  const same = {
    host: '127.0.0.1:7788',
    origin: 'http://127.0.0.1:7788',
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
    'content-length': '2',
  };
  assert.equal(requestRejection({ method: 'POST', headers: same }), null);
  assert.equal(
    requestRejection({ method: 'POST' }),
    null,
    'host-internal callers without browser headers keep working',
  );
  assert.equal(requestRejection({ method: 'GET', headers: { host: 'localhost:1', 'sec-fetch-site': 'none' } }), null);
  assert.equal(
    requestRejection({ method: 'POST', headers: { ...same, 'sec-fetch-site': 'cross-site' } }),
    'cross-site',
  );
  assert.equal(
    requestRejection({ method: 'POST', headers: { ...same, origin: 'https://evil.example' } }),
    'cross-origin',
  );
  assert.equal(
    requestRejection({ method: 'POST', headers: { ...same, origin: 'http://localhost:9999' } }),
    'cross-origin',
  );
  assert.equal(requestRejection({ method: 'POST', headers: { ...same, origin: 'null' } }), 'opaque-origin');
  assert.equal(
    requestRejection({ method: 'POST', headers: { ...same, 'content-type': 'text/plain' } }),
    'content-type',
  );
  assert.equal(
    requestRejection({ method: 'POST', headers: { ...same, 'content-length': String(MAX_REQUEST_BYTES + 1) } }),
    'too-large',
  );
  // Desktop pages served through an app scheme are not HTTP origins and are left to the host.
  assert.equal(
    requestRejection({ method: 'POST', headers: { ...same, origin: 'app://dsh', 'sec-fetch-site': 'same-origin' } }),
    null,
  );
});

test('a cross-site settings change is refused and leaves the configuration file untouched', async t => {
  const request = host(t);
  const body = Buffer.from(JSON.stringify({ proxy: 'http://attacker.example:8080' }));
  const refused = await request('config', {
    headers: {
      host: '127.0.0.1:7788',
      origin: 'https://attacker.example',
      'sec-fetch-site': 'cross-site',
      'content-type': 'text/plain',
      'content-length': String(body.length),
    },
    chunks: [body],
  });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.ok, false);
  const config = await request('config', { method: 'GET' });
  assert.equal(config.body.config.proxy, '');
});

test('request bodies are decoded after all chunks, so split Chinese characters survive', async t => {
  const request = host(t);
  const target = path.join(tempDir(t, 'dsh-request-utf8-'), '项目文件夹');
  const bytes = Buffer.from(JSON.stringify({ workspaceId: 'ws-utf8', path: target }));
  const split = bytes.indexOf(Buffer.from('项')) + 1; // inside the three-byte character
  const saved = await request('workspace/path', { chunks: [bytes.subarray(0, split), bytes.subarray(split)] });
  assert.equal(saved.body.ok, true, JSON.stringify(saved.body));
  assert.equal(saved.body.path, target);
  assert.ok(fs.existsSync(target));
});

test('oversized request bodies are rejected without being buffered completely', async t => {
  const request = host(t);
  const chunk = Buffer.alloc(1024 * 1024, 0x20);
  const result = await request('workspace/path', { chunks: Array.from({ length: 5 }, () => chunk) });
  assert.equal(result.body.ok, false);
  assert.match(result.body.error, /过大/);
});

test('imported files are replaced atomically and keep permissions', t => {
  const dir = tempDir(t, 'dsh-replace-bytes-');
  const file = path.join(dir, 'settings.yaml');
  fs.writeFileSync(file, 'old: 1\n');
  fs.chmodSync(file, 0o640);
  // Windows only keeps the read-only bit, so compare with what chmod actually produced.
  const mode = process.platform === 'win32' ? fs.statSync(file).mode & 0o777 : 0o640;
  replaceBytes(file, Buffer.from('new: 2\n'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'new: 2\n');
  assert.equal(fs.statSync(file).mode & 0o777, mode);
  assert.deepEqual(fs.readdirSync(dir), ['settings.yaml'], 'no temporary file is left behind');
  replaceBytes(path.join(dir, 'nested', 'new.json'), Buffer.from('{}'));
  assert.equal(fs.readFileSync(path.join(dir, 'nested', 'new.json'), 'utf8'), '{}');
});

test('imported files write through symbolic links instead of replacing them', t => {
  const dir = tempDir(t, 'dsh-replace-link-');
  const real = path.join(dir, 'dotfiles-settings.yaml'),
    link = path.join(dir, 'linked.yaml');
  fs.writeFileSync(real, 'a: 1\n');
  try {
    fs.symlinkSync(real, link);
  } catch (error) {
    // Windows without Developer Mode cannot create file symlinks; drive the same
    // branch by reporting the existing file as a link and check where bytes land.
    if (error.code !== 'EPERM') throw error;
    fs.writeFileSync(link, 'a: 1\n');
    const lstat = fs.lstatSync;
    t.mock.method(fs, 'lstatSync', (target, ...rest) => {
      const stat = lstat(target, ...rest);
      if (target === link) stat.isSymbolicLink = () => true;
      return stat;
    });
    const rename = t.mock.method(fs, 'renameSync');
    replaceBytes(link, Buffer.from('a: 2\n'));
    assert.equal(rename.mock.callCount(), 0, 'a link is never replaced by rename');
    assert.equal(fs.readFileSync(link, 'utf8'), 'a: 2\n');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['dotfiles-settings.yaml', 'linked.yaml']);
    return;
  }
  replaceBytes(link, Buffer.from('a: 2\n'));
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(fs.readFileSync(real, 'utf8'), 'a: 2\n');
});

test('a failed replacement reports its own error even when the temporary file cannot be removed', t => {
  const dir = tempDir(t, 'dsh-replace-fail-');
  const file = path.join(dir, 'settings.yaml');
  fs.writeFileSync(file, 'old: 1\n');
  t.mock.method(fs, 'renameSync', () => {
    throw Object.assign(new Error('rename refused'), { code: 'EPERM' });
  });
  t.mock.method(fs, 'unlinkSync', () => {
    throw Object.assign(new Error('temporary file busy'), { code: 'EBUSY' });
  });
  assert.throws(
    () => replaceBytes(file, Buffer.from('new: 2\n')),
    error => error.code === 'EPERM',
  );
  assert.equal(fs.readFileSync(file, 'utf8'), 'old: 1\n');
});

test('a temporary file left by an interrupted import is never transported', () => {
  assert.equal(transportable('settings.yaml' + '.' + 'abc' + REPLACE_TEMP_SUFFIX), false);
  assert.equal(transportable('profiles/web/package.json'), true);
});

test('a session caught mid-append is re-read, reported as busy while growing, and still refused when stable', async t => {
  const dir = tempDir(t, 'dsh-settled-session-');
  const file = path.join(dir, 'session.jsonl');
  const header = JSON.stringify({ type: 'session', id: 's', version: 4 }) + '\n';
  const row = seq => JSON.stringify({ type: 'event', seq }) + '\n';
  const complete = header + row(0) + row(1);
  // 1. The host finishes its line shortly after the first read.
  fs.writeFileSync(file, header + row(0) + '{"type":"ev');
  const first = fs.readFileSync(file);
  setTimeout(() => fs.writeFileSync(file, complete), 20);
  const finished = await readSettledSession(file, first, { attempts: 4, delayMs: 50 });
  assert.equal(finished.changing, undefined);
  assert.equal(finished.bytes.toString(), complete);
  // 2. The file keeps changing for the whole wait.
  let n = 0;
  fs.writeFileSync(file, header + '{"partial":' + n);
  const timer = setInterval(() => fs.writeFileSync(file, header + '{"partial":' + ++n), 10);
  t.after(() => clearInterval(timer));
  const busy = await readSettledSession(file, fs.readFileSync(file), { attempts: 3, delayMs: 40 });
  clearInterval(timer);
  assert.equal(busy.changing, true);
  // 3. A stable damaged file is returned unchanged for the caller to refuse.
  fs.writeFileSync(file, header + row(0) + row(5));
  const stable = await readSettledSession(file, fs.readFileSync(file), { attempts: 3, delayMs: 10 });
  assert.equal(stable.changing, undefined);
  assert.equal(stable.bytes.toString(), header + row(0) + row(5));
});
