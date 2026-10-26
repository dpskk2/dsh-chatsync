import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Run through the Desktop's Electron, a GUI program's stderr may never reach the
// PowerShell window, so the script also reports failures on stdout. These cases
// stop before reading the profile or installing anything.
const script = fileURLToPath(new URL('../scripts/install-local-desktop.mjs', import.meta.url));
const run = args =>
  spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000 });

test('install-local-desktop reports a usage error on stdout and exits 1', () => {
  const result = run([]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /安装失败：用法：node scripts\/install-local-desktop\.mjs/);
});

test('install-local-desktop reports a refused package location on stdout and exits 1', () => {
  const result = run(['not-under-outputs.tgz', 'outputs/never-created-install-record']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /安装失败：本地安装包必须先保存在维护目录的 outputs 中。/);
});
