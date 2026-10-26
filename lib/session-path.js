// Native and complementary importers use different prefixes before the UUID.
// Keep one conservative path contract for discovery, merging and recovery.
const source = '[a-z][a-z0-9_-]{0,63}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const sessionIdPattern = new RegExp('^' + source + '$', 'i');
const logPathPattern = new RegExp(
  '^sessions/[^/]+/(' + source + ')/(?:session|log)(?:\\.v\\d+)?\\.jsonl(?:\\.zstd)?$',
  'i',
);
export function sessionIdOfLogPath(file) {
  return logPathPattern.exec(String(file || '').replace(/\\/g, '/'))?.[1] ?? null;
}

// DSH format generations are independent of compression: the original name
// is v0; every successor carries .vN. Use the same rule for sync and activity.
export function sessionLogGeneration(file) {
  const match = /(?:^|\/)(?:session|log)(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/i.exec(String(file || '').replace(/\\/g, '/'));
  if (!match) return null;
  const version = Number(match[1] ?? 0);
  return Number.isSafeInteger(version) ? version : null;
}
