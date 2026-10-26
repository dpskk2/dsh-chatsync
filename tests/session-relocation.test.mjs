import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SyncEngine } from '../lib/sync.js';
import { digest } from '../lib/recovery.js';
import { importRelocatedSession } from '../lib/session-relocation.js';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-relocation-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const engine = new SyncEngine(home, { autoRepo: false });
  const sid = 'session-11111111-1111-1111-1111-111111111111';
  const file = `sessions/old/${sid}/session.v4.jsonl`,
    bytes = Buffer.from('original');
  fs.mkdirSync(path.dirname(path.join(home, file)), { recursive: true });
  fs.writeFileSync(path.join(home, file), bytes);
  const r = engine.recovery.save(
    { kind: 'main', path: file, status: 'merged', reason: 'local-project-unavailable' },
    { local: bytes, remote: bytes },
  );
  const registry = {
    archivedSessionIds: [],
    async archiveSession(id) {
      this.archivedSessionIds.push(id);
    },
  };
  engine.sessionActivity = () => ({ available: true, activeCount: 0, activeIds: [] });
  return {
    engine,
    home,
    registry,
    sid,
    file,
    bytes,
    body: { recoveryId: r.id, expectedHash: digest(bytes), workspaceId: 'target', archiveSource: true },
  };
}

test('relocation archives only after verified import and retains original bytes and import state', async t => {
  const f = fixture(t);
  let imports = 0;
  const importer = async () => {
    imports++;
    assert.deepEqual(f.registry.archivedSessionIds, []);
    f.engine.recovery.finish(f.body.recoveryId, { imports: { local: { status: 'verified', sessionId: 'new' } } });
    return { ok: true, sessionId: 'new' };
  };
  const result = await importRelocatedSession(f.engine, { workspaceRegistry: f.registry }, f.body, importer);
  assert.equal(imports, 1);
  assert.equal(result.archivedSource, true);
  assert.deepEqual(f.registry.archivedSessionIds, [f.sid]);
  assert.deepEqual(fs.readFileSync(path.join(f.home, f.file)), f.bytes);
  const record = f.engine.recovery.read(f.body.recoveryId);
  assert.equal(record.imports.local.status, 'verified');
  assert.equal(record.relocation.sessionId, 'new');
  assert.equal(record.reviewState, 'archived');
});

test('active or changed originals and failed imports never archive the source', async t => {
  const f = fixture(t);
  let calls = 0;
  const importer = async () => {
    calls++;
    throw new Error('import failed');
  };
  f.engine.sessionActivity = () => ({ available: true, activeCount: 1, activeIds: [f.sid] });
  await assert.rejects(
    importRelocatedSession(f.engine, { workspaceRegistry: f.registry }, f.body, importer),
    /正在使用/,
  );
  f.engine.sessionActivity = () => ({ available: true, activeCount: 0, activeIds: [] });
  await assert.rejects(
    importRelocatedSession(f.engine, { workspaceRegistry: f.registry }, { ...f.body, expectedHash: 'stale' }, importer),
    /变化/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    importRelocatedSession(f.engine, { workspaceRegistry: f.registry }, f.body, importer),
    /import failed/,
  );
  assert.deepEqual(f.registry.archivedSessionIds, []);
  const racing = async () => {
    fs.writeFileSync(path.join(f.home, f.file), 'changed');
    return { ok: true, sessionId: 'new' };
  };
  await assert.rejects(importRelocatedSession(f.engine, { workspaceRegistry: f.registry }, f.body, racing), /变化/);
  assert.deepEqual(f.registry.archivedSessionIds, []);
});
