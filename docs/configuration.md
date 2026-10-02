# 配置参考

[返回 README](../README.md) · [安装指南](getting-started.md)

设置 → 同步中可填写仓库地址与分支、切换自动建仓、调整手动 / 自动同步、自动同步开关与周期、是否同步工作区文件，以及自动重启修复。自动模式且 `enabled: true` 时，按周期和会话活动触发双向同步；默认也在 DSH 启动后同步，正常退出时尝试保存并上传改动。启动和退出行为分别由 `autoPullOnStart`、`autoPushOnExit` 控制，退出上传只针对已验证的远端，强制结束进程时无法保证。自动重启检测到会话生成时暂停，活动未知时仅提示手动重启，详见[会话生成中与重启守卫](#会话生成中与重启守卫)。其他选项位于 DSH 数据目录的 `dsh-sync.json`（默认 `~/.dsh/dsh-sync.json`）。**设置页切换模式保存后立即生效，连接设置在下次同步使用。** 保存连接不等于连接验证，请点「立即同步」检查结果。直接编辑配置文件后，重启 DSH 以确保调度参数重新加载。切回手动不会中断已经开始的同步。

配置按默认值、配置文件、插件加载参数依次覆盖；加载参数优先。此文件也会同步，适合所有机器共用的设置才放在这里。工作区「换位置」产生的路径覆盖另存本机。

## 常用选项

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `remote` | `""` | Git 仓库地址；空值时可能触发自动建仓 |
| `branch` | `"main"` | 主数据分支，两台电脑保持一致 |
| `mode` | `"manual"` | `manual` 手动；`auto` 自动；设置页保存即时生效 |
| `enabled` | `true` | 自动同步总开关（设置页「允许自动同步」）。关闭后只手动同步，连开机后的首次自动拉取也停止；不等同于卸载插件 |
| `workspaceSync` | `true` | 同步工作区真实文件；关闭后暂停上传与取回，仍同步会话、附件与设置，不删除已上传文件；重新开启后继续更新 |
| `intervalSeconds` | `300` | 自动同步周期，实际至少 30 秒；设置页可直接填写分钟数 |
| `proxy` | `""` | Git 代理，如 `http://127.0.0.1:7890`；不是 DSH 全局网络代理 |
| `autoRepo` | `true` | `remote` 空时尝试通过 `gh` 创建 / 复用仓库；只做本地快照需设为 `false` |
| `autoRestartAfterRepair` | `true` | 补登记或取回新会话后自动重启宿主（Web 与桌面端都支持）；检测到生成时暂停，活动未知时仅提示手动重启 |
| `workspaceBase` | `""` | 工作区统一落盘目录；配置会同步，两台机器路径不同时优先用「换位置」 |

只同步会话与设置，不同步项目文件：

```json
{
  "workspaceSync": false
}
```

只做本地快照，不尝试连接仓库（已有远端配置时也需将 `remote` 清空）：

```json
{
  "remote": "",
  "autoRepo": false,
  "mode": "manual"
}
```

示例只列需要改的字段，请合并进已有文件，避免覆盖其他设置。

## 其他选项

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `eventDebounceSeconds` | `15` | 自动模式响应会话事件的延迟，实际至少 5 秒 |
| `minCommitIntervalSeconds` | `120` | 自动提交节流；手动按钮可强制提交 |
| `autoPullOnStart` | `true` | 自动模式启动时触发同步 |
| `autoPushOnExit` | `true` | 自动模式正常退出时尝试提交与推送；强制结束进程不保证执行 |
| `commitMessage` | `"dsh-chatsync: auto snapshot"` | 快照提交消息 |
| `gitUserName` | `"dsh-chatsync"` | 同步仓库的 Git 提交名 |
| `gitUserEmail` | `"dsh-chatsync@localhost"` | Git 提交邮箱，不用于登录 |
| `repoName` | `"dsh-sync"` | 自动建仓 / 复用的仓库名 |
| `repoOwner` | `""` | 自动建仓账号，空值取 `gh` 登录账号 |
| `repoDescription` | `""` | 自动新建仓库时的描述 |
| `workspaceBranchPrefix` | `"ws"` | 工作区分支前缀；已有同步数据时不建议改动 |
| `extraIgnore` | `[]` | 首次生成主数据 `.gitignore` 时追加的规则；已有文件请直接编辑 `.gitignore` |
| `workspaceExtraIgnore` | `["node_modules", ".pnpm-store", ".npm-cache"]` | 工作区额外排除规则；自定义数组会替换默认值，请保留仍需要的条目 |
| `patches` | `true` | 是否应用数据目录 `patches/` 中的托管补丁 |
| `restartGuard.activityWindowMs` | `120000` | agents 服务不可用时，会话日志在此毫秒窗口内仍有活动即视为「正在生成」 |

## 会话生成中与重启守卫

在 Windows 上，插件按实际宿主进程识别 Web 与桌面端，重启确认框和设置页说明随之调整。Web 端只重启 Web 服务，需要数据目录下的 `restart-dsh-web.ps1`；桌面端使用随插件分发的 `scripts/restart-dsh-desktop.ps1`，核验宿主进程后关闭并重新打开桌面应用。缺少脚本或无法识别宿主时不调度重启，界面提示手动操作。自动重启默认开启（明确关闭的配置会保留）；两端若共用同一数据目录，配置文件中的开关也共用，但各端重启自己的宿主。当前宿主自动重启识别仅适用于 Windows。

同步后补登记了未分组会话时，插件需要重启 DSH 才能重建索引。为避免打断正在进行的对话，重启前会先判断当前是否有会话正在生成：

- 优先读取 DSH agents 服务，把状态为 `running` 的会话计为生成中。
- agents 服务不可用时，改用会话日志文件的最近活动时间兜底：`restartGuard.activityWindowMs`（默认 `120000` 毫秒）内仍有日志活动即视为生成中。
- 探测结果为「未知」时不自动重启，保留手动提示。目录或日志无法读取时按未知处理；自动重启只在确认空闲、整轮同步成功且传输结束后调度。

存在会话生成时：不会自动重启，设置页的「自动重启修复会话分组」开关此时不生效；界面左下角会出现引导卡片，提供「立即重启 / 稍后」，「稍后」在本次浏览器会话内不再自动弹出，检测到生成中会按**会话名**列出会被打断的会话（最多 3 个，取不到名字时退回工作目录名）。

接口层面：`GET /dsh-sync/api/status` 返回 `activeSessionCount`、`activeSessionIds`、`activeSessions`（`[{ id, name }]`，`name` 为侧栏显示的会话名）和 `sessionActivitySource`（`agents` / `log-activity` / `none`）。界面确认后调用 `POST /dsh-sync/api/restart`；当前路由无条件按强制重启执行，活动守卫不拦截此请求，不能把其中的 HTTP 409 分支当成默认保护。

## 冲突如何处理

新版同步用分层合并引擎，按文件类型确定性合并，不再产出需要人工裁决的冲突拷贝：

- 会话日志（`sessions/**/session*.jsonl.zstd`）按事件合并；无法确认可安全接续时保留一侧原件，并在同步详情里列出双方提交位置。
- `settings.yaml`、`profiles/web/package.json`、`storages/workspace.json` 及版本图 sidecar 按字段合并（并发改同一字段时按 Lamport 时钟 + actor 字典序确定性取胜者）。
- 其他文件冲突时确定性保留本机版本，远端版本留在 Git 历史与备份分支（`backup/*`）。

设置页的「遗留冲突副本（只读）」只列出旧版本同步留下的 `.dsh-conflict-<时间戳>` 拷贝，供确认后清理；这些条目没有「保留本机 / 采用远端 / 两侧都留」按钮，也不需要人工裁决。会话投影缓存（`storages/session_projcache/`）属于可再生缓存，下次同步会自动清理。

## 补丁管理

这是高级功能。插件提供补丁应用机制，**安装插件本身不代表附带某个 DSH 修复补丁**。

补丁放在 `<DSH_HOME>/patches/<补丁名>/`，由 `patch.json` 和完整的目标文件内容组成。清单字段包括 `package`（目标包）、`target`（包内相对路径）、`payload`（补丁文件）、`packageVersion`（录制版本）、`marker`（补丁标记）、`enabled`、`disabledPackageVersions`（仅对列出的安装版本停用）。

引擎在启动及同步后检查内容：已一致则跳过，与原始备份一致时可重新应用；上游文件已经变化时可能提示重新录制。仅带旧标记不再允许覆盖；无原始备份且无明确录制版本也不会自动应用。“与补丁文件一致”不表示已经验证所有 DSH 版本。补丁修改本机安装目录，通常重启 DSH 后生效。仅使用自己信任的补丁。

实现见 [lib/patches.js](../lib/patches.js)；隔离验证运行 `node patch-version-agnostic-test.mjs`。
