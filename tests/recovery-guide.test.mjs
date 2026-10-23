import assert from 'node:assert/strict';
import test from 'node:test';
import { recoveryGuide, detectDshVersion } from '../lib/recovery-guide.js';

const record = path => ({ kind: 'main', path, status: 'merged' });
test('the screenshot path is a ChatSync ledger, not the profile manifest', () => {
  const r = recoveryGuide(record('storages/sync-meta/profiles/web/package.json.vmap.json'), '0.2.1-rc.2');
  assert.equal(r.decision, 'none'); assert.match(r.title, /账本/);
  assert.match(r.meaning, /关联文件：profiles\/web\/package.json/);
  assert.match(r.nextStep, /自动管理/);
});
test('profile manifest, lockfile and project manifest have different purposes and decisions', () => {
  const manifest = recoveryGuide(record('profiles/desktop/package.json'), '0.2.1-rc.2');
  const lock = recoveryGuide(record('profiles/web/pnpm-lock.yaml'), '0.2.1-rc.2');
  const project = recoveryGuide({ kind: 'ws', path: 'profiles/web/package.json' }, '0.2.1-rc.2');
  assert.match(manifest.title, /桌面版插件清单/); assert.match(manifest.meaning, /DSH 插件管理安装/);
  assert.match(lock.title, /网页版插件安装版本表/); assert.match(lock.nextStep, /插件管理中检查安装/);
  assert.equal(project.title, '项目文件');
  assert.equal(recoveryGuide(record('future/package.json'), '0.2.1-rc.2').decision, 'unknown');
});
test('version-specific settings migration and unverified host versions are explicit', () => {
  const current = recoveryGuide(record('settings.yaml'), '0.2.1-rc.2');
  assert.match(current.meaning, /settings.yaml.imported.*不一定代表现在/);
  assert.match(current.evidence, /历史记录创建时.*未记录/);
  const future = recoveryGuide(record('settings.yaml'), '9.9.9');
  assert.match(future.evidence, /尚未核对/);
  assert.doesNotMatch(future.meaning, /本机此版本会/);
  assert.equal(detectDshVersion([]), null);
});
