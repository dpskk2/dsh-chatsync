// Optional test-only preload: --import ./scripts/profile-test-spawns.mjs.
// Records durations/exit codes, never arguments, stdin, stdout or stderr.
import fs from 'node:fs';
import { SyncEngine } from '../lib/sync.js';

if (!process.env.CHATSYNC_TEST_SPAWN_TRACE) throw new Error('Set an explicit synthetic test trace file');
const spawn = SyncEngine.prototype._spawn;
const operations = new Set([
  'add',
  'commit',
  'status',
  'fetch',
  'push',
  'rev-parse',
  'show',
  'ls-files',
  'ls-tree',
  'cat-file',
  'diff',
  'merge',
  'config',
  'check-ignore',
  'update-ref',
  'for-each-ref',
  'branch',
  'init',
  'checkout',
  'reset',
]);
SyncEngine.prototype._spawn = async function (command, args, ...rest) {
  const start = Date.now();
  const result = await spawn.call(this, command, args, ...rest);
  fs.appendFileSync(
    process.env.CHATSYNC_TEST_SPAWN_TRACE,
    JSON.stringify({
      executable: command,
      operation: args.find(arg => operations.has(arg)) || 'other',
      elapsedMs: Date.now() - start,
      code: result.code,
      timedOut: result.timedOut,
    }) + '\n',
  );
  return result;
};
