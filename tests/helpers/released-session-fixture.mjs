// Synthetic released v0/v1 transcript. No user data or model/network calls.
// Optional native acceptance checks this through DSH's historical catalog.
export function releasedPackedSession(version, id, cwd = 'C:/fixture') {
  const row = (type, seq, data) => ({ type, seq, time: seq + 1, data });
  return [
    { type: 'session', version, id, createdAt: 1, delegationDepth: 0, cwd },
    row('turn/start', 0, { turn: 1 }),
    row('step/start', 1, { turn: 1, step: 1 }),
    { type: 'text-chunks', seq0: 2, time0: 3, data: { turn: 1, step: 1, index: 0, dt: [1], texts: ['a', 'b'] } },
    {
      ...row('assistant/message', 4, {
        turn: 1,
        step: 1,
        message: {
          role: 'assistant',
          id: 'fixture-message',
          content: [{ type: 'text', text: 'ab' }],
          source: { kind: 'model', provider: 'fixture', model: 'fixture' },
        },
      }),
      sourceEventSeqs: [2, 3],
      surfaceOp: 'append',
    },
    row('step/end', 5, { turn: 1, step: 1 }),
    row('turn/end', 6, { turn: 1, reason: { kind: 'completed' } }),
  ];
}
