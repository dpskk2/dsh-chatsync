import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const catalog = JSON.parse(fs.readFileSync(new URL('./dsh-file-catalog.json', import.meta.url), 'utf8'));

export function detectDshVersion(argv = process.argv) {
  const candidates = [];
  try { candidates.push(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')); } catch {}
  for (const arg of argv.slice(0, 4)) {
    if (typeof arg !== 'string' || !path.isAbsolute(arg)) continue;
    let dir = path.dirname(arg);
    for (let i = 0; i < 6; i++, dir = path.dirname(dir)) candidates.push(path.join(dir, 'node_modules/@deepseek-ai/dsh/package.json'));
  }
  for (const file of candidates) {
    try { const p = JSON.parse(fs.readFileSync(file, 'utf8')); if (p.name === '@deepseek-ai/dsh' && typeof p.version === 'string') return p.version; } catch {}
  }
  return null;
}

export function recoveryGuide(record, hostVersion) {
  const p = String(record.path || '').replace(/\\/g, '/');
  const layout = catalog.versions.find(v => v.version === hostVersion);
  const evidence = layout ? `用途已按本机 DSH ${hostVersion} 的官方发布包核对。历史记录创建时及另一台电脑的 DSH 版本未记录，不能据此确认当时结构相同。`
    : '尚未核对本机 DSH 版本；以下只解释已知路径的通常用途，不确认此版本的实际结构。';
  const guide = (title, meaning, nextStep, decision = 'check') => ({ title, meaning, nextStep, decision, evidence, hostVersion });
  if (record.kind === 'ws' || record.kind === 'restore-backup') return guide('项目文件', '项目中的文件。', '内容缺失或有误时，可比较两个版本并恢复；当前文件会先备份。');
  if (/^storages\/sync-meta\/.+\.vmap\.json$/.test(p)) return guide('同步内部账本', '记录设置的修改顺序，供 ChatSync 合并改动。关联文件：' + p.slice('storages/sync-meta/'.length, -'.vmap.json'.length), '由 ChatSync 自动管理。', 'none');
  const profile = /^profiles\/([^/]+)\/(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|cordis\.patch\.yml|cordis\.yml)$/.exec(p);
  if (profile) {
    const scope = profile[1] === 'web' ? '网页版' : profile[1] === 'desktop' ? '桌面版' : '「' + profile[1] + '」运行环境';
    if (profile[2] === 'package.json') return guide(scope + '插件清单', '记录要安装的插件及版本。插件程序由 DSH 插件管理安装。', '插件缺失或加载异常时，请到 DSH 插件管理中检查安装。');
    if (profile[2] === 'pnpm-lock.yaml') return guide(scope + '插件安装版本表', '记录插件及依赖的安装版本，由安装工具自动更新。', '插件安装或加载失败时，请到 DSH 插件管理中检查安装。');
    if (profile[2] === 'pnpm-workspace.yaml') return guide(scope + '插件安装规则', '安装工具使用的依赖和安装脚本规则。', '插件安装报错时，可对照报错查看这份记录。');
    if (profile[2] === 'cordis.patch.yml') return guide(scope + '功能与设置配置', '记录启用的插件、功能及其配置。' + (layout?.settings === 'profile-patch' ? '此版本也在这里保存界面设置。' : ''), '设置或插件异常时，请到 DSH 对应设置页调整。');
    return guide(scope + '历史运行配置', '旧版 DSH 的运行配置备份。', '启动异常时，可用来对照排查。');
  }
  if (p === 'settings.yaml' || p === 'settings.yaml.imported') return guide('DSH ' + (layout?.settings === 'profile-patch' ? '旧版设置迁移文件' : '设置文件'), layout?.settings === 'profile-patch'
    ? '本机此版本会把旧 settings.yaml 导入当前运行环境的配置，并将原文件改名为 settings.yaml.imported。它不一定代表现在界面中生效的设置。'
    : '旧版 DSH 的模型、界面和插件设置。', '设置缺失时，请到 DSH 设置页检查；这份备份可用于对照。');
  if (p === 'storages/workspace.json') return guide('项目与会话登记表', '记录项目分组和会话所属的项目。', '会话未分组或归属不对时，请打开「修复会话问题」。');
  if (/^sessions\//.test(p)) return guide('会话原始记录', '保存对话和工具调用。', '发现消息缺失时，可将备份另存为独立会话。');
  if (/^attachments\//.test(p)) return guide('聊天附件', '聊天中上传或生成的附件。', '附件缺失或打不开时，可查看备份。');
  return guide('其他文件', '这份备份的文件用途尚未识别。', '可对照文件位置和内容查看。', 'unknown');
}
