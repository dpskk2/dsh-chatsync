# 架构说明

本文说明当前源码的模块分工和一轮同步的数据流，供修改代码前快速定位。数据安全规则以 `AGENTS.md`「数据安全不变量」为准；用户可见的同步范围与合并边界见 [同步内容](sync-content.md)。早期合并层的设计推演保存在 [docs/history/merge-engine-design-0.11.md](history/merge-engine-design-0.11.md)，只作追溯。

## 一、整体分层

```
DSH 宿主 ──apply(ctx)──► lib/index.js（组装）
                           ├─ lib/http/         本机 HTTP 接口（同源 JSON，统一来源校验）
                           ├─ lib/sync.js       SyncEngine（方法分布在 lib/engine/）
                           │    └─ lib/scope.js 隔离传输副本：导出 → Git 传输 → 校验后导入
                           └─ 只读诊断工具（sync_status / sync_preview / sync_doctor）
浏览器页面 ◄── lib/client.js（由 src/client/ 生成）── 调用 /dsh-sync/api/*
```

- **运行时零依赖**：只用 Node 内建模块和 Git 子进程；YAML 解析用 `lib/vendor/` 中按原样内置的 js-yaml（附许可证）。
- **Git 只作用于传输副本**：主数据在 `~/.dsh/.chatsync-local/main-views/<key>/tree` 中提交、合并和推送；项目文件在各自的影子仓库中处理。checkout、merge、reset 从不作用于宿主正在使用的 `~/.dsh`。
- **会话只能经宿主写入**：取回的会话通过宿主公开的 `sessionPersistence` 追加，写后读回比对。

## 二、目录与模块

| 位置 | 职责 |
| --- | --- |
| `lib/index.js` | 插件入口 `apply`：读取配置、创建引擎、安装发送前检查、注册接口与只读工具、安排启动与退出同步 |
| `lib/http/guard.js` | `requestRejection` 来源与格式校验、请求体大小上限、`json`/`readBody`；`registerRoutes` 为每条路由套用校验 |
| `lib/http/*-routes.js` | 按领域分组的接口：同步与状态（`sync-routes`）、恢复与修复（`records-routes`）、连接与设置（`settings-routes`） |
| `lib/http/startup.js`、`summary.js` | 启动同步状态机；同步结果的一句话摘要与详情 |
| `lib/sync.js` | `SyncEngine` 类定义与原有导出；把 `lib/engine/` 中的方法组以不可枚举属性装回原型（测试可直接 `t.mock.method(SyncEngine.prototype, …)`） |
| `lib/engine/run.js` | `syncOnce`/`_syncOnce` 总入口：暂停条件、内容范围同步、同步后登记自查、项目同步、交接回执 |
| `lib/engine/main-sync.js` | 传输副本内的一轮 Git 同步：取远端 → 提交快照 → 推送 / 快进 / 合并，冲突按文件类型处理 |
| `lib/engine/workspace-sync.js` | 项目文件夹（影子仓库）的同样流程；冲突取本机、远端留在备份分支 |
| `lib/engine/` 其余文件 | 配置、Git 调用、远端与建仓、冲突原件、项目登记、重启、状态与预览 |
| `lib/scope.js` | 内容范围允许清单 `contentKind`、传输副本的准备、导出、导入与发送放行 |
| `lib/merge.js` | 纯函数合并层：`classifyFile`、会话日志校验、字段级 LWW 合并、Cordis 补丁按条目合并 |
| `lib/session-*.js`、`branch-history.js` | 会话格式校验、经宿主写入、分叉保留、恢复与停机修复、活动探测、删除回执 |
| `lib/recovery.js` | 恢复记录：覆盖前保存原件，原子替换文件 |
| `lib/privacy*.js`、`review.js` | 上传前的大小与敏感内容检查、脱敏副本、需要确认的传输预览 |
| `lib/data-health.js`、`local-storage.js`、`remote-cleanup.js` | 历史数据检查与修复、本地备份清理、远端残留文件清理 |
| `src/client/` | 浏览器端界面源码：`00-`/`99-` 是模块加载器外壳，其余按文件名顺序拼接，经 `scripts/build-client.mjs` 生成 `lib/client.js` |
| `types/`、`tsconfig.json` | 只用于 `tsc --checkJs` 类型检查，不进安装包 |

## 三、一轮同步的数据流

1. **入口与暂停条件**（`run.js`）：配置损坏、待核对的数据修复、已安排的停机修复、未完成的会话导入都会让本轮直接返回，不上传也不下载。
2. **准备传输副本**（`scope.js`）：首次使用时按需建仓或复用默认备份，确认远端是私有 GitHub 仓库；没有副本时从远端克隆，中断留下的半成品副本先归档再重建。
3. **导出**：按 `effectiveScope` 选出会话、附件、设置以及可选的指令与技能，过滤忽略规则和已删除会话。会话日志必须通过 `validateSessionLog` 与官方格式校验；读到正在写入的日志时稍等再读，仍在变化就暂停本轮。设置先投影掉本机字段再导出。
4. **Git 传输**（`main-sync.js`，在传输副本中运行）：取远端并校验远端会话树 → 提交本地快照 → 需要时等待确认预览 → 推送、快进或合并。合并冲突按 `classifyFile` 的类型处理：
   - `session-log`：只接受严格追加的一侧（`chooseSessionHistory`）；双方分叉时保留本机，远端原件留在 Git 历史并在结果中提示，不交错、不重编号；
   - `crdt-json` / `crdt-yaml` / `crdt-meta`：按版本账本（vmap）做字段级「后写胜」合并；
   - `cordis-entries`：`cordis.patch.yml` 中互不相同的条目各自合并，含插入项或重复条目时整份保留本机；
   - `storages/workspace.json`：三方合并，尊重基线后的删除；
   - 其余（`opaque`）：取本机，远端在备份分支与远端历史中。
   合并后仍有冲突标记就中止合并，绝不提交标记。
5. **导入**：只导入允许清单内的文件。同步期间本机文件发生变化的不覆盖；覆盖前先写恢复记录；普通文件失败时整体回滚；会话经宿主追加并读回；项目登记在会话都写入成功后才更新。
6. **项目文件**（`workspace-sync.js` / `project-sync.js`）：每个项目单独同步，失败只影响该项目。
7. **收尾**：核对已应用的会话后放行发送前检查；写交接回执分支 `chatsync-device/<设备>`（含插件版本，供远端清理判断各电脑是否已升级）；需要刷新会话分组时，只在没有会话正在生成时安排桌面端重启。

## 四、本机 HTTP 接口

所有路由经 `registerRoutes` 注册：带浏览器跨站标记、来源不符、非 JSON 的写请求和超过 4 MB 的请求体都会被拒绝；没有浏览器头的宿主内部调用不受影响。路由路径保持兼容，前端调用集中在 `src/client/10-api.js` 的 `API` 对象中。

## 五、修改时的检查

- `npm test` 依次运行：界面生成一致性、全部测试、ESLint、Prettier 格式检查、tsc 类型检查。测试只用临时目录、合成数据和本地裸仓库。
- 修改同步、合并或写入路径前，先对照 `AGENTS.md` 的数据安全不变量；新增文件类型时同时考虑 `contentKind`（是否同步）与 `classifyFile`（如何合并）。
- 修改界面只改 `src/client/`，再运行 `node scripts/build-client.mjs`。
- 阶段性或发布前的回归与验收要求见 `CONTRIBUTING.md` 与 [发版前数据安全检查](release-safety-checklist.md)。
