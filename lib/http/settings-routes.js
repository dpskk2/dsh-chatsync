// HTTP layer of the plugin entry (lib/index.js): connection and settings routes.
import fs from 'node:fs';
import path from 'node:path';
import { parseSyncRemote } from '../remote.js';
import { saveConnection, checkDefaultBackup } from '../connection.js';
import { previewRemoteCleanup, applyRemoteCleanup } from '../remote-cleanup.js';
import { analyzeRepoUsage } from '../repo-usage.js';
import { previewHistoryRebuild, applyHistoryRebuild } from '../history-rebuild.js';
import { previewLocalHistory, reclaimLocalHistory } from '../local-history.js';
import { normalizeScope } from '../scope.js';
import { writeSyncConfig } from '../config-file.js';
import { json, readBody } from './guard.js';
import { summarize } from './summary.js';

/** Settings shown on the sync page, with defaults applied. */
function configView(c) {
  return {
    mode: c.mode || 'manual',
    automatic: c.enabled !== false,
    enabled: c.enabled !== false,
    intervalSeconds: c.intervalSeconds,
    autoPullOnStart: c.autoPullOnStart,
    autoPushOnExit: c.autoPushOnExit,
    workspaceSync: c.workspaceSync !== false,
    contentScope: c.contentScope,
    syncInstructions: c.syncInstructions === true,
    autoRestartAfterRepair: c.autoRestartAfterRepair === true,
    showSidebarSync: c.showSidebarSync !== false,
    proxy: c.proxy || '',
    remote: c.remote || '',
    branch: c.branch,
    autoRepo: c.autoRepo !== false,
  };
}

/** Validate a settings save; only listed fields are accepted. */
async function readConfigPatch(engine, body) {
  // 只接受白名单字段；连接地址不接收访问令牌。
  const patch = {};
  if (body.showSidebarSync !== undefined) {
    if (typeof body.showSidebarSync !== 'boolean') throw new Error('侧边栏显示选项必须为布尔值。');
    patch.showSidebarSync = body.showSidebarSync;
  }
  if (body.remote !== undefined) {
    if (typeof body.remote !== 'string' || (body.remote.trim() && !parseSyncRemote(body.remote)))
      throw new Error('请输入 GitHub 私有仓库的 HTTPS 或 SSH 地址，不要包含访问令牌。');
    patch.remote = body.remote.trim();
  }
  if (body.branch !== undefined) {
    if (
      typeof body.branch !== 'string' ||
      !body.branch.trim() ||
      body.branch.includes('@{') ||
      (await engine.git(['check-ref-format', '--branch', body.branch.trim()])).code !== 0
    )
      throw new Error('请输入有效的同步分支名，例如 main，并确认已安装 Git。');
    patch.branch = body.branch.trim();
  }
  if (body.autoRepo !== undefined) {
    if (typeof body.autoRepo !== 'boolean') throw new Error('自动建仓选项必须为布尔值');
    patch.autoRepo = body.autoRepo;
  }
  if (body.autoRestartAfterRepair !== undefined) patch.autoRestartAfterRepair = body.autoRestartAfterRepair === true;
  if (body.workspaceSync !== undefined) patch.workspaceSync = body.workspaceSync !== false;
  if (body.contentScope !== undefined) patch.contentScope = normalizeScope(body.contentScope);
  if (body.syncInstructions !== undefined) {
    if (typeof body.syncInstructions !== 'boolean') throw new Error('指令与技能同步选项必须为布尔值');
    patch.syncInstructions = body.syncInstructions;
  }
  if (body.autoPullOnStart !== undefined) {
    patch.autoPullOnStart = body.autoPullOnStart === true;
    patch.lifecycleAutomation = 1;
  }
  if (body.autoPushOnExit !== undefined) {
    patch.autoPushOnExit = body.autoPushOnExit === true;
    patch.lifecycleAutomation = 1;
  }
  if (typeof body.mode === 'string' && ['manual', 'auto'].includes(body.mode)) patch.mode = body.mode;
  if (typeof body.proxy === 'string') patch.proxy = body.proxy.trim();
  /* 总开关只控制启动/退出；旧 mode/intervalSeconds 不再触发后台同步。 */
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new Error('自动同步开关必须是布尔值');
    patch.enabled = body.enabled;
  }
  if (body.automatic !== undefined) {
    if (typeof body.automatic !== 'boolean') throw new Error('自动同步开关必须是布尔值');
    if (body.mode !== undefined || body.enabled !== undefined) throw new Error('请只提供 automatic 自动同步开关。');
    patch.mode = body.automatic ? 'auto' : 'manual';
    patch.enabled = body.automatic;
    patch.lifecycleAutomation = 1;
  }
  if (body.intervalSeconds !== undefined) {
    const seconds = Number(body.intervalSeconds);
    if (!Number.isFinite(seconds) || seconds < 30 || seconds > 86400)
      throw new Error('自动同步间隔需在 30 秒到 24 小时之间。');
    patch.intervalSeconds = Math.round(seconds);
  }
  return patch;
}

export function settingsRoutes(deps) {
  return [...connectionRoutes(deps), ...configRoutes(deps)];
}

function connectionRoutes({ engine, scheduler }) {
  return [
    {
      kind: 'exact',
      path: '/dsh-sync/api/connection',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          const result = await saveConnection(engine, JSON.parse((await readBody(req)) || '{}'));
          scheduler.refresh();
          json(res, 200, { ok: true, ...result });
        } catch (error) {
          json(res, 200, { ok: false, error: error.message });
        }
      },
    },
    // —— 远端清理:GET 预览不再同步的远端文件与未升级的电脑;POST 经确认后移除(只改共享树,不删任何电脑的本机文件) ——
    {
      kind: 'exact',
      path: '/dsh-sync/api/remote-cleanup',
      handler: async (req, res) => {
        try {
          if (req.method === 'GET') {
            json(res, 200, await previewRemoteCleanup(engine));
            return;
          }
          if (req.method !== 'POST') {
            json(res, 405, { ok: false, error: 'method not allowed' });
            return;
          }
          const body = JSON.parse((await readBody(req)) || '{}');
          const done = await applyRemoteCleanup(engine, {
            previewId: body?.previewId,
            retiredDevices: body?.retiredDevices,
          });
          json(res, 200, {
            ok: done.ok,
            removed: done.removed,
            error: done.result?.error || null,
            summary: done.result ? summarize(done.result) : '',
          });
        } catch (error) {
          json(res, 200, { ok: false, error: error.message });
        }
      },
    },
    // —— 同步仓库占用:只读统计当前版本与历史各占多少,不改动任何文件 ——
    {
      kind: 'exact',
      path: '/dsh-sync/api/repo-usage',
      handler: async (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          json(res, 200, await analyzeRepoUsage(engine));
        } catch (error) {
          json(res, 200, { ok: false, error: error.message });
        }
      },
    },
    // —— 清除历史版本:GET 检查其他电脑与备份分支;POST 经确认后先备份旧历史,再只保留当前内容 ——
    {
      kind: 'exact',
      path: '/dsh-sync/api/history-rebuild',
      handler: async (req, res) => {
        try {
          if (req.method === 'GET') return json(res, 200, await previewHistoryRebuild(engine));
          if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
          const body = JSON.parse((await readBody(req)) || '{}');
          json(
            res,
            200,
            await applyHistoryRebuild(engine, {
              previewId: body?.previewId,
              retiredDevices: body?.retiredDevices,
              deleteBackupBranches: body?.deleteBackupBranches === true,
            }),
          );
        } catch (error) {
          json(res, 200, { ok: false, error: error.message });
        }
      },
    },
    // —— 本机旧历史:GET 列出同步分支以外仍占本机空间的引用;POST 只删除 GitHub 确认保有的旧备份并回收 ——
    {
      kind: 'exact',
      path: '/dsh-sync/api/local-history',
      handler: async (req, res) => {
        try {
          if (req.method === 'GET') return json(res, 200, await previewLocalHistory(engine));
          if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
          const body = JSON.parse((await readBody(req)) || '{}');
          json(res, 200, await reclaimLocalHistory(engine, { previewId: body?.previewId }));
        } catch (error) {
          json(res, 200, { ok: false, error: error.message });
        }
      },
    },
    // —— 默认备份检查:只读确认 gh 账号及 dsh-sync 将复用还是新建,不建仓、不改配置 ——
    {
      kind: 'exact',
      path: '/dsh-sync/api/connection/check',
      handler: async (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          json(res, 200, await checkDefaultBackup(engine));
        } catch (error) {
          json(res, 200, { ok: false, message: error.message });
        }
      },
    },
    // 工作区路径覆盖:本机专属(不同步);可指定其他文件夹或清空恢复默认
    {
      kind: 'exact',
      path: '/dsh-sync/api/workspace/path',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        try {
          const body = JSON.parse((await readBody(req)) || '{}');
          const id = String(body.workspaceId || '').trim();
          if (!id) throw new Error('缺少 workspaceId');
          const p = String(body.path || '').trim();
          if (p) {
            const abs = path.resolve(p);
            try {
              fs.mkdirSync(abs, { recursive: true });
            } catch (e) {
              throw new Error('无法创建文件夹 ' + abs + ': ' + (e && e.message));
            }
            engine.setLocalWorkspacePath(id, abs);
          } else {
            engine.setLocalWorkspacePath(id, null);
          }
          json(res, 200, { ok: true, workspaceId: id, path: p || null });
        } catch (e) {
          json(res, 200, { ok: false, error: String((e && e.message) || e) });
        }
      },
    },
  ];
}

function configRoutes({ engine, home, scheduler }) {
  return [
    // —— 配置读写:保存「同步后自动重启」等开关到 dsh-sync.json(与插件默认值/引擎逐层合并) ——
    {
      kind: 'exact',
      path: '/dsh-sync/api/config',
      handler: async (req, res) => {
        try {
          if (req.method === 'GET') {
            const c = engine.loadConfig();
            if (c.configError) throw new Error(c.configError);
            json(res, 200, {
              ok: true,
              config: configView(c),
            });
            return;
          }
          if (req.method !== 'POST') {
            json(res, 405, { ok: false, error: 'method not allowed' });
            return;
          }
          const body = JSON.parse((await readBody(req)) || '{}');
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('配置必须是 JSON 对象');
          const sidebarOnly = Object.keys(body).length === 1 && Object.hasOwn(body, 'showSidebarSync');
          if (engine.progress?.running && !sidebarOnly) throw new Error('同步正在进行，请完成后再保存设置。');
          const cfgFile = path.join(home, 'dsh-sync.json');
          const patch = await readConfigPatch(engine, body);
          if (engine.inFlight && !sidebarOnly) throw new Error('同步正在进行，请完成后再保存设置。');
          // Read after async validation so another settings save cannot be lost.
          writeSyncConfig(cfgFile, patch);
          scheduler.refresh();
          const effective = engine.loadConfig();
          json(res, 200, {
            ok: true,
            saved: patch,
            auto: scheduler.active,
            autoConfigured: effective.enabled !== false,
            config: {
              automatic: effective.enabled !== false,
              mode: effective.mode,
              workspaceSync: effective.workspaceSync !== false,
              contentScope: effective.contentScope,
              syncInstructions: effective.syncInstructions === true,
              enabled: effective.enabled !== false,
              intervalSeconds: effective.intervalSeconds,
              autoPullOnStart: effective.autoPullOnStart !== false,
              autoPushOnExit: effective.autoPushOnExit !== false,
              autoRestartAfterRepair: effective.autoRestartAfterRepair === true,
              showSidebarSync: effective.showSidebarSync !== false,
              remote: effective.remote || '',
              branch: effective.branch,
              autoRepo: effective.autoRepo !== false,
            },
          });
        } catch (e) {
          json(res, 200, { ok: false, error: String((e && e.message) || e) });
        }
      },
    },
  ];
}
