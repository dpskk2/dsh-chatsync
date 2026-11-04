import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SyncEngine } from '../lib/sync.js';
import { isLocalAbsolute, mapWorkspacePath } from '../lib/workspace-path.js';
import { retainWorkspaceMembership } from '../lib/workspace-registry.js';

const missing = () => false;
const mac = { home: '/Users/mac', exists: missing, platformPath: path.posix };
const win = { home: 'C:\\Users\\win', exists: missing, platformPath: path.win32 };

test('a project under the home folder keeps its place across Windows and macOS', () => {
  assert.equal(
    mapWorkspacePath('C:\\Users\\win\\Documents\\deepseek-harness\\default-workspace', mac),
    '/Users/mac/Documents/deepseek-harness/default-workspace',
  );
  assert.equal(
    mapWorkspacePath('/Users/mac/Documents/deepseek-harness/default-workspace', win),
    'C:\\Users\\win\\Documents\\deepseek-harness\\default-workspace',
  );
  assert.equal(mapWorkspacePath('C:/Users/other/proj', win), 'C:\\Users\\win\\proj');
  assert.equal(mapWorkspacePath('/home/dev/src/proj', win), 'C:\\Users\\win\\src\\proj');
  // Another account on the same OS maps too, as Windows already did.
  assert.equal(mapWorkspacePath('/Users/other/proj', mac), '/Users/mac/proj');
  assert.equal(mapWorkspacePath('C:\\Users\\fq\\proj', win), 'C:\\Users\\win\\proj');
});

test('an existing local folder and other local paths are used unchanged', () => {
  assert.equal(
    mapWorkspacePath('C:\\Users\\fq\\proj', { ...win, exists: p => p === 'C:\\Users\\fq\\proj' }),
    'C:\\Users\\fq\\proj',
  );
  assert.equal(mapWorkspacePath('D:\\work\\proj', win), 'D:\\work\\proj');
  assert.equal(mapWorkspacePath('D:/work/proj', win), 'D:\\work\\proj');
  assert.equal(mapWorkspacePath('/opt/work/proj', mac), '/opt/work/proj');
});

test('another OS path outside a home folder has no counterpart and is never created', () => {
  assert.equal(mapWorkspacePath('D:\\work\\proj', mac), null);
  assert.equal(mapWorkspacePath('\\\\server\\share\\proj', mac), null);
  assert.equal(mapWorkspacePath('/Volumes/Data/proj', win), null);
  assert.equal(mapWorkspacePath('', win), null);
  assert.equal(isLocalAbsolute('/Users/mac/proj', path.win32), false);
  assert.equal(isLocalAbsolute('\\\\server\\share', path.win32), true);
  assert.equal(isLocalAbsolute('C:\\Users\\win', path.posix), false);
});

test('a project root folder takes the last name of either OS path', () => {
  assert.equal(
    mapWorkspacePath('C:\\Users\\win\\Documents\\proj', { ...mac, base: '/srv/projects' }),
    '/srv/projects/proj',
  );
  assert.equal(mapWorkspacePath('/Users/mac/proj/', { ...win, base: 'E:\\Projects' }), 'E:\\Projects\\proj');
});

function engineFixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-cross-os-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return new SyncEngine(home, { autoRepo: false });
}
const foreignHomePath = process.platform === 'win32' ? '/Users/mac/Documents/proj' : 'C:\\Users\\win\\Documents\\proj';
const foreignOtherPath = process.platform === 'win32' ? '/Volumes/Data/proj' : 'D:\\work\\proj';

test('this computer maps a project recorded by the other OS into its own home folder', t => {
  const engine = engineFixture(t);
  assert.equal(engine.workspacePathOf(foreignHomePath, {}), path.join(os.homedir(), 'Documents', 'proj'));
  assert.equal(engine.workspacePathOf(foreignOtherPath, {}), null);
});

test('an unmapped project stops alone with a hint and creates no folder', async t => {
  const engine = engineFixture(t);
  const ws = { id: 'ws-foreign', title: 'proj', path: foreignOtherPath };
  engine.workspaces = () => [ws];
  const before = fs.readdirSync(process.cwd());
  const result = await engine.syncAllWorkspaces({ workspaceSync: true }, 'test', {});
  assert.equal(result.total, 1);
  assert.equal(result.synced, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /本机没有对应位置.*选择本机保存位置/);
  assert.deepEqual(result.created, []);
  assert.deepEqual(fs.readdirSync(process.cwd()), before);
});

test('registry membership treats both OS paths of one project as the same project', t => {
  const engine = engineFixture(t);
  const data = workspaces => Buffer.from(JSON.stringify({ global: {}, tables: { workspaces } }));
  const windowsPath = 'C:\\Users\\win\\Documents\\proj',
    macPath = '/Users/mac/Documents/proj';
  const before = data({ w1: { path: windowsPath, sessionIds: ['s1'] } });
  const after = data({ w2: { path: macPath, sessionIds: [] } });
  const kept = JSON.parse(retainWorkspaceMembership(engine, before, after, new Set(['s1'])).toString());
  assert.deepEqual(kept.tables.workspaces.w2.sessionIds, ['s1']);
  // Two unmapped projects never collapse into one shared key.
  const other = data({ w3: { path: foreignOtherPath + '-b', sessionIds: [] } });
  const separate = retainWorkspaceMembership(
    engine,
    data({ w1: { path: foreignOtherPath, sessionIds: ['s1'] } }),
    other,
    new Set(['s1']),
  );
  assert.equal(separate, other);
});
