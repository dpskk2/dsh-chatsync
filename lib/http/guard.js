// HTTP layer of the plugin entry (lib/index.js): request guard and JSON helpers.
// The plugin API is reached by the host's own pages through relative URLs.
// Reject requests a browser marks as coming from another site, and any POST
// that is not JSON, so an unrelated web page cannot drive sync or settings.
// Callers without browser headers (host internals, CLI checks) are unaffected.
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
export function requestRejection(req) {
  const headers = req?.headers;
  if (!headers || typeof headers !== 'object') return null;
  const site = String(headers['sec-fetch-site'] || '').toLowerCase();
  if (site === 'cross-site') return 'cross-site';
  const origin = headers.origin;
  if (origin === 'null') return 'opaque-origin';
  if (origin) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      return 'invalid-origin';
    }
    const host = String(headers.host || '').toLowerCase();
    if (/^https?:$/.test(parsed.protocol) && host && parsed.host.toLowerCase() !== host) return 'cross-origin';
  }
  if (req.method && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const length = Number(headers['content-length'] || 0);
    const hasBody = length > 0 || Boolean(headers['transfer-encoding']);
    if (length > MAX_REQUEST_BYTES) return 'too-large';
    if (hasBody && !/^application\/json\s*(?:;|$)/i.test(String(headers['content-type'] || ''))) return 'content-type';
  }
  return null;
}

function guardHandler(handler) {
  return async (req, res) => {
    const reason = requestRejection(req);
    if (reason) {
      res.writeHead(reason === 'too-large' ? 413 : reason === 'content-type' ? 415 : 403, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(
        JSON.stringify({
          ok: false,
          error: '请求来源或格式不被接受，已拒绝（' + reason + '）。请从 DSH 的同步页面操作。',
        }),
      );
      return;
    }
    return handler(req, res);
  };
}

// Every route passes the same origin and format guard before its handler runs.
export function registerRoutes(webServer, routes, disposers) {
  for (const route of routes) disposers.push(webServer.register({ ...route, handler: guardHandler(route.handler) }));
}

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
export const json = (res, code, payload) => {
  res.writeHead(code, jsonHeaders);
  res.end(JSON.stringify(payload));
};
// Decode once after all chunks arrive: a multi-byte character can span chunks.
export const readBody = req =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', d => {
      if (failed) return;
      const chunk = Buffer.isBuffer(d) ? d : Buffer.from(String(d));
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        failed = true;
        reject(new Error('请求内容过大，已拒绝'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
