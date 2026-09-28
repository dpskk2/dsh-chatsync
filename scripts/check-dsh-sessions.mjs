// Read-only validation using the installed DSH codecs. Never prints message content.
// Usage: node scripts/check-dsh-sessions.mjs <dsh-package-dir> <dsh-home>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pickSessionLog } from '../lib/sync.js';
import { decodeZstdFrames, mergeSessionLog } from '../lib/merge.js';

const [dshRoot, home] = process.argv.slice(2).map(p => path.resolve(p));
if (!dshRoot || !home) throw new Error('Provide DSH package directory and data home');
const { sessionFormatCatalog: current, historicalSessionFormatCatalog: historical } = await import(pathToFileURL(path.join(dshRoot, 'node_modules/@deepseek-ai/dsh-session-format-catalog/lib/index.js')));
const result = { total: 0, passed: 0, events: 0, formats: {}, failed: 0 };
const directories = dir => fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(dir, d.name));
for (const group of directories(path.join(home, 'sessions'))) {
  for (const dir of directories(group)) {
    if (!path.basename(dir).startsWith('session-')) continue;
    const file = pickSessionLog(dir);
    if (!file) continue;
    result.total++;
    try {
      const buffer = fs.readFileSync(file);
      const text = file.endsWith('.zstd') ? decodeZstdFrames(buffer) : buffer.toString('utf8');
      if (text === null) throw new Error('decode');
      const rows = text.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
      const version = rows[0].version;
      result.formats[version] = (result.formats[version] || 0) + 1;
      // Historical validation does not assert that V3 -> V4 migration is complete;
      // that operation additionally requires parent/child migration evidence.
      const catalog = version === current.currentVersion ? current : historical;
      const restore = catalog.createRestore(rows[0], { recovery: 'strict', validation: 'current' });
      for (const row of rows.slice(1)) restore.decodeRow(row);
      result.events += restore.finish().events.length;
      const chosen = mergeSessionLog(Buffer.from(JSON.stringify(rows[0]) + '\n'), buffer);
      if (!chosen.ok || !chosen.value.equals(buffer)) throw new Error('changed selection');
      result.passed++;
    } catch {
      result.failed++;
    }
  }
}
console.log(JSON.stringify(result));
if (result.failed) process.exitCode = 1;
