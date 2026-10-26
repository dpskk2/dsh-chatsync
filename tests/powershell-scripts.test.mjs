import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Windows ships Windows PowerShell 5.1, which reads a BOM-less script in the ANSI
// code page and has no .NET Core APIs. Every .ps1 in the repository must work there.
const root = fileURLToPath(new URL('..', import.meta.url));
const scripts = fs
  .readdirSync(path.join(root, 'scripts'))
  .filter(name => name.toLowerCase().endsWith('.ps1'))
  .map(name => path.join(root, 'scripts', name));

test('PowerShell scripts are limited to the shipped restart script', () => {
  assert.deepEqual(
    scripts.map(file => path.basename(file)),
    ['restart-dsh-desktop.ps1'],
  );
});

test('PowerShell scripts with non-ASCII text start with a UTF-8 BOM', () => {
  for (const file of scripts) {
    const bytes = fs.readFileSync(file);
    const bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
    const text = bytes.subarray(bom ? 3 : 0).toString('utf8');
    if ([...text].some(char => char.charCodeAt(0) > 0x7f))
      assert.ok(bom, `${path.basename(file)} 含非 ASCII 字符，必须保存为带 BOM 的 UTF-8`);
  }
});

test(
  'PowerShell scripts parse without errors in Windows PowerShell 5.1',
  { skip: process.platform !== 'win32' && 'Windows PowerShell 5.1 is Windows only' },
  () => {
    const powershell = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const probe = [
      "if ($PSVersionTable.PSVersion.Major -ne 5) { 'not Windows PowerShell 5.x'; exit 2 }",
      '$errors = $null',
      '[void][System.Management.Automation.Language.Parser]::ParseFile($env:CHATSYNC_PS1, [ref]$null, [ref]$errors)',
      'if ($errors.Count) { $errors | ForEach-Object { $_.Message }; exit 1 }',
    ].join('; ');
    for (const file of scripts) {
      const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', probe], {
        env: { ...process.env, CHATSYNC_PS1: file },
        encoding: 'utf8',
        windowsHide: true,
        timeout: 60000,
      });
      assert.equal(result.status, 0, `${path.basename(file)}: ${result.stdout}${result.stderr}`);
    }
  },
);
