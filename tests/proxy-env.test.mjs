import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWindowsProxy, readWindowsProxy, resolveProxyEnvironment } from '../lib/proxy-env.js';

const registry = (server, enabled = 1) => `\n ProxyEnable REG_DWORD 0x${enabled}\n ProxyServer REG_SZ ${server}\n`;

test('automatic mode follows port changes and removes a disabled system proxy without caching', () => {
  let text = registry('127.0.0.1:7892');
  const read = () => parseWindowsProxy(text);
  assert.equal(resolveProxyEnvironment('', {}, read).HTTPS_PROXY, 'http://127.0.0.1:7892');
  text = registry('127.0.0.1:7897');
  const next = resolveProxyEnvironment('auto', {}, read);
  assert.equal(next.HTTPS_PROXY, 'http://127.0.0.1:7897');
  assert.equal(next.https_proxy, next.HTTPS_PROXY);
  assert.equal(next.HTTP_PROXY, next.HTTPS_PROXY);
  assert.match(next.NO_PROXY, /127\.0\.0\.1/);
  text = registry('127.0.0.1:7897', 0);
  assert.deepEqual(resolveProxyEnvironment('', {}, read), {});
});

test('explicit plugin and environment proxies retain priority; bypass entries are preserved', () => {
  const inherited = { HTTPS_PROXY: 'http://environment:8080', no_proxy: 'internal.example', PATH: 'unchanged' };
  const read = () => assert.fail('system proxy must not override an explicit route');
  const automatic = resolveProxyEnvironment('', inherited, read);
  assert.equal(automatic.HTTPS_PROXY, inherited.HTTPS_PROXY);
  assert.equal(automatic.no_proxy, automatic.NO_PROXY);
  assert.match(automatic.NO_PROXY, /internal\.example/);
  const manual = resolveProxyEnvironment('socks5://127.0.0.1:7892', inherited, read);
  assert.equal(manual.HTTPS_PROXY, 'socks5://127.0.0.1:7892');
  assert.equal(manual.ALL_PROXY, manual.HTTPS_PROXY);
  assert.equal(inherited.no_proxy, 'internal.example');
});

test('Windows protocol-specific HTTP, HTTPS and SOCKS settings are interpreted without assuming a port', () => {
  assert.deepEqual(parseWindowsProxy(registry('http=localhost:8080;https=localhost:8443')), { http: 'http://localhost:8080', https: 'http://localhost:8443' });
  assert.deepEqual(parseWindowsProxy(registry('socks=localhost:1080')), { http: 'socks5://localhost:1080', https: 'socks5://localhost:1080' });
  assert.deepEqual(parseWindowsProxy(registry('[::1]:7897')), { http: 'http://[::1]:7897', https: 'http://[::1]:7897' });
  assert.deepEqual(parseWindowsProxy(registry('http://user:password@localhost:7897')), { http: '', https: '' });
  assert.deepEqual(parseWindowsProxy(' AutoConfigURL REG_SZ http://example.invalid/proxy.pac'), {});
});

test('registry reads are bounded, hidden and Windows-only; failures do not break direct mode', () => {
  let calls = 0;
  const run = (exe, args, options) => {
    calls++;
    assert.match(exe, /System32[\\/]reg\.exe$/);
    assert.equal(args[0], 'query');
    assert.equal(options.windowsHide, true);
    assert.equal(options.timeout, 2000);
    return { status: 0, stdout: registry('localhost:8888') };
  };
  assert.deepEqual(readWindowsProxy({ platform: 'linux', run }), {});
  assert.equal(calls, 0);
  assert.equal(readWindowsProxy({ platform: 'win32', run }).https, 'http://localhost:8888');
  assert.deepEqual(readWindowsProxy({ platform: 'win32', run: () => ({ status: 1 }) }), {});
  assert.deepEqual(readWindowsProxy({ platform: 'win32', run: () => { throw new Error('unavailable'); } }), {});
});
