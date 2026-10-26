export const sessionId = 'session-44444444-4444-4444-4444-444444444444';
export const logPath = `sessions/issue4/${sessionId}/session.v4.jsonl.zstd`;
export const header = {
  type: 'session',
  version: 4,
  id: sessionId,
  createdAt: 1700000000000,
  cwd: process.platform === 'win32' ? 'C:/issue4-synthetic' : '/issue4-synthetic',
  isSeeded: false,
  delegationDepth: 0,
};
export function event(seq, source, seed = 0) {
  return {
    seq,
    time: 1700000000000 + seq,
    type: 'session/title',
    data: { title: `${source}:${seed}:${seq}:` + 'x'.repeat(256), messageSeqs: [], source: { kind: 'user' } },
  };
}
export const jsonl = rows => Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
