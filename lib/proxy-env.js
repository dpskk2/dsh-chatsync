import { spawnSync } from 'node:child_process';
import path from 'node:path';

const PROXY_NAMES = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'];
const BYPASS_NAMES = ['NO_PROXY', 'no_proxy'];
export const PROXY_ENV_NAMES = [...PROXY_NAMES, ...BYPASS_NAMES];

function proxyURL(value, scheme = 'http') {
  if (!value) return '';
  try {
    const url = new URL(value.includes('://') ? value : `${scheme}://${value}`);
    if (
      !['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname && url.pathname !== '/')
    )
      return '';
    return url.href.replace(/\/$/, '');
  } catch {
    return '';
  }
}

/** Windows' static proxy only; PAC scripts are never executed by the plugin. */
export function parseWindowsProxy(output) {
  if (!/^\s*ProxyEnable\s+REG_DWORD\s+0x0*1\s*$/im.test(output)) return {};
  const server = /^\s*ProxyServer\s+REG_SZ\s+(.+)$/im.exec(output)?.[1].trim();
  if (!server) return {};
  const slots = {};
  for (const part of server.split(';')) {
    const match = /^\s*(http|https|socks)\s*=\s*(.+?)\s*$/i.exec(part);
    if (match)
      slots[match[1].toLowerCase()] = proxyURL(match[2], match[1].toLowerCase() === 'socks' ? 'socks5' : 'http');
    else if (!part.includes('=')) slots.all = proxyURL(part.trim());
  }
  return {
    http: slots.http || slots.all || slots.socks || '',
    https: slots.https || slots.http || slots.all || slots.socks || '',
  };
}

/** Read on demand, so changing a Windows proxy port does not require restarting DSH. */
export function readWindowsProxy({ platform = process.platform, env = process.env, run = spawnSync } = {}) {
  if (platform !== 'win32') return {};
  try {
    const executable = path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    const result = run(executable, ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 2000,
      maxBuffer: 128 * 1024,
    });
    return result.status === 0 && !result.error ? parseWindowsProxy(result.stdout || '') : {};
  } catch {
    return {};
  }
}

/** Explicit plugin proxy > inherited proxy variables > current Windows static proxy > direct. */
export function resolveProxyEnvironment(proxy, inherited = process.env, readSystem = readWindowsProxy) {
  const result = Object.fromEntries(
    PROXY_ENV_NAMES.filter(name => inherited[name] !== undefined).map(name => [name, inherited[name]]),
  );
  const manual = String(proxy || '').trim();
  if (manual && manual.toLowerCase() !== 'auto') {
    for (const name of PROXY_NAMES) result[name] = manual;
  } else if (!PROXY_NAMES.some(name => String(inherited[name] || '').trim())) {
    const system = readSystem();
    if (system.http) result.HTTP_PROXY = result.http_proxy = system.http;
    if (system.https) result.HTTPS_PROXY = result.https_proxy = system.https;
  }
  if (PROXY_NAMES.some(name => result[name])) {
    const bypass = new Set([
      ...BYPASS_NAMES.flatMap(name => String(inherited[name] || '').split(/[,\s]+/)).filter(Boolean),
      '127.0.0.1',
      'localhost',
      '::1',
    ]);
    result.NO_PROXY = result.no_proxy = [...bypass].join(',');
  }
  return result;
}
