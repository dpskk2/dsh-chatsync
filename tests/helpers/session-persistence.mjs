// Deliberately limited in-memory/API simulation over fixture files. Native lease
// and vocabulary validation are covered separately by the real-host script.
import fs from 'node:fs';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { parseSessionLog, ZSTD_MAGIC } from '../../lib/merge.js';
import { sessionIdOfLogPath } from '../../lib/session-path.js';

export const fixtureCatalog = {
  createRestore(header) {
    const events = [];
    return {
      decodeRow(row) {
        events.push(row);
      },
      finish() {
        return { header, events, inheritedEventCount: 0 };
      },
    };
  },
};

export function fixtureSessionPersistence(engine) {
  const locations = new Map(),
    held = new Set();
  function locate(id, home = engine.home) {
    const scan = (root, prefix = '') => {
      if (!fs.existsSync(root)) return;
      for (const item of fs.readdirSync(root, { withFileTypes: true })) {
        const file = prefix ? prefix + '/' + item.name : item.name;
        if (item.isDirectory()) scan(path.join(root, item.name), file);
        else if (sessionIdOfLogPath('sessions/' + file) === id) locations.set(id, 'sessions/' + file);
      }
    };
    scan(path.join(home, 'sessions'));
    return locations.get(id);
  }
  function read(id) {
    const file = locate(id);
    const bytes =
      file && fs.existsSync(path.join(engine.home, file)) ? fs.readFileSync(path.join(engine.home, file)) : null;
    return bytes ? { file, bytes, rows: parseSessionLog(bytes) } : null;
  }
  function handle(id, header) {
    if (held.has(id)) {
      const error = new Error('fixture writer held');
      error.name = 'SessionAlreadyOwnedError';
      throw error;
    }
    held.add(id);
    return {
      header,
      inheritedEventCount: 0,
      async read() {
        return { events: read(id)?.rows.slice(1) || [] };
      },
      async append(events) {
        const current = read(id),
          rows = current?.rows || [header];
        if (events[0]?.seq !== rows.length - 1) throw new Error('stale append');
        const encoded = Buffer.from([...rows, ...events].map(JSON.stringify).join('\n') + '\n');
        const file = path.join(engine.home, locate(id));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, current?.bytes.subarray(0, 4).equals(ZSTD_MAGIC) ? zstdCompressSync(encoded) : encoded);
      },
      async flush() {
        if (!read(id)) {
          const file = path.join(engine.home, locate(id));
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, JSON.stringify(header) + '\n');
        }
      },
      async close() {
        held.delete(id);
      },
    };
  }
  return {
    held,
    locations,
    async stat(id) {
      const data = read(id);
      return data ? { header: data.rows[0] } : undefined;
    },
    async open(id) {
      const data = read(id);
      if (!data) throw new Error('missing fixture');
      return handle(id, data.rows[0]);
    },
    async create(header) {
      if (!locate(header.id) && !locate(header.id, engine._transport.home)) throw new Error('fixture path not set');
      return handle(header.id, header);
    },
  };
}

export function attachFixturePersistence(engine) {
  const persistence = fixtureSessionPersistence(engine);
  engine.setHostContext({ sessionPersistence: persistence });
  engine.setActiveSessionProbe(() => ({ available: true, activeCount: 0, activeIds: [], source: 'isolated-fixture' }));
  engine.loadTransferCatalog = async () => fixtureCatalog;
  return engine;
}
