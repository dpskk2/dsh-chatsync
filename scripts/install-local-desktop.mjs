// Installs a local candidate package into the desktop profile with the desktop's
// own dsh CLI, keeping rollback material and the install log under outputs/.
// Usage: node scripts/install-local-desktop.mjs <outputs 中的 .tgz> <outputs 下的新记录目录>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outputs = path.join(root, 'outputs');
const inside = target => target.toLowerCase().startsWith(outputs.toLowerCase() + path.sep);

// Read package/package.json from the tarball without an external tar program.
function packedManifest(file) {
  const tar = gunzipSync(fs.readFileSync(file));
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, length) =>
      header
        .subarray(start, start + length)
        .toString('utf8')
        .replace(/\0.*$/s, '');
    const name = (field(345, 155) ? field(345, 155) + '/' : '') + field(0, 100);
    const size = parseInt(field(124, 12).trim() || '0', 8);
    if (name === 'package/package.json')
      return JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString('utf8'));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('无法读取本地安装包信息。');
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2)
    throw new Error('用法：node scripts/install-local-desktop.mjs <outputs 中的 .tgz> <outputs 下的新记录目录>');
  const packageFile = path.resolve(args[0]);
  const outputRoot = path.resolve(args[1]);
  if (!inside(packageFile) || !fs.statSync(packageFile, { throwIfNoEntry: false })?.isFile())
    throw new Error('本地安装包必须先保存在维护目录的 outputs 中。');
  if (!inside(outputRoot)) throw new Error('安装记录必须保存在维护目录的 outputs 中。');

  const source = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packed = packedManifest(packageFile);
  if (
    !['chatsync', '@dpskk2/dsh-chatsync'].includes(packed.name) ||
    packed.version !== source.version ||
    packed.chatsyncBuild !== source.chatsyncBuild
  )
    throw new Error('安装包的名称、版本或构建与维护源码不符。');
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const cli = path.join(localAppData, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd');
  if (!fs.existsSync(cli)) throw new Error('未找到桌面端内置 DSH 安装命令。');
  const profileRoot = path.join(os.homedir(), '.dsh', 'profiles', 'desktop');
  const profilePackage = JSON.parse(fs.readFileSync(path.join(profileRoot, 'package.json'), 'utf8'));
  const otherName = packed.name === 'chatsync' ? '@dpskk2/dsh-chatsync' : 'chatsync';
  if (profilePackage.dependencies && Object.hasOwn(profilePackage.dependencies, otherName))
    throw new Error('当前使用另一个包名，请按现有包名打包，避免同时加载两份插件。');

  const backupRoot = path.join(outputRoot, 'profile-before-install');
  if (fs.existsSync(backupRoot)) throw new Error('安装备份已存在，请使用新的输出目录，避免覆盖回滚材料。');
  fs.mkdirSync(backupRoot, { recursive: true });
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.yml', 'cordis.patch.yml']) {
    const file = path.join(profileRoot, name);
    if (fs.statSync(file, { throwIfNoEntry: false })?.isFile()) fs.copyFileSync(file, path.join(backupRoot, name));
  }
  const installedRoot = path.join(profileRoot, 'node_modules', packed.name);
  if (fs.statSync(installedRoot, { throwIfNoEntry: false })?.isDirectory())
    fs.cpSync(installedRoot, path.join(outputRoot, 'previous-plugin'), { recursive: true, dereference: false });

  // A .cmd file runs through cmd.exe; refuse paths it would reinterpret.
  const spec = 'file:' + packageFile.replaceAll('\\', '/');
  if (/["%^&|<>]/.test(cli + spec)) throw new Error('安装包或 DSH 路径含 cmd 特殊字符，请换一个目录。');
  const install = spawnSync(`"${cli}" plugin --profile desktop add "${spec}" --ignore-scripts`, {
    shell: true,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  const log = (install.stdout || '') + (install.stderr || '');
  fs.writeFileSync(path.join(outputRoot, 'install.log'), log);
  process.stdout.write(log);
  if (install.error) throw install.error;
  if (install.status !== 0) throw new Error(`桌面插件安装失败，退出码 ${install.status}；回滚材料已保留。`);

  const installed = JSON.parse(fs.readFileSync(path.join(installedRoot, 'package.json'), 'utf8'));
  if (installed.version !== source.version || installed.chatsyncBuild !== source.chatsyncBuild)
    throw new Error(`安装版本或构建不符：${installed.version}。`);
  const record = {
    at: new Date().toISOString(),
    version: installed.version,
    name: installed.name,
    build: installed.chatsyncBuild,
    packagePath: packageFile,
    packageSha256: crypto.createHash('sha256').update(fs.readFileSync(packageFile)).digest('hex'),
    profile: profileRoot,
  };
  fs.writeFileSync(path.join(outputRoot, 'installation.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(`桌面端已安装 ${installed.version}，请重新打开 DSH 后验收。`);
}

try {
  main();
} catch (error) {
  // Run through the Desktop's Electron, a GUI program's stderr may never reach the
  // PowerShell window, so failures are reported on stdout as well.
  console.log('安装失败：' + error.message);
  process.exitCode = 1;
}
