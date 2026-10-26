import fs from 'node:fs';
import { zstdCompressSync } from 'node:zlib';
import { event, jsonl } from './issue4-data.mjs';
const [file, first, seedText] = process.argv.slice(2);
const seed = Number(seedText),
  start = Number(first);
const fd = fs.openSync(file, 'a');
let count = 0,
  stopped = false,
  timer;
function append() {
  if (stopped) return;
  fs.writeSync(fd, zstdCompressSync(jsonl([event(start + count, 'writer', seed)])));
  count++;
  if (count === 1) process.send({ type: 'started', count });
  timer = setTimeout(append, 1 + ((seed + count) % 3));
}
process.on('message', msg => {
  if (msg === 'start') append();
  if (msg === 'stop') {
    stopped = true;
    clearTimeout(timer);
    fs.closeSync(fd);
    process.send({ type: 'done', count });
    process.disconnect();
  }
});
process.send({ type: 'ready' });
