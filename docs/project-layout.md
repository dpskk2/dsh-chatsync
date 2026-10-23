# 项目目录与维护入口

当前约定先读根目录 `AGENTS.md`，当前维护/最近安装状态读“当前版本说明.md”，安全验收读 `docs/release-safety-checklist.md`。旧评审、旧任务禁令和历史记忆不能代替用户当前指令。下列本机目录位置只说明职责，不表示所有位置都是同一版本。

| 目录或文件 | 用途 | 保留原则 |
| --- | --- | --- |
| `lib/`、`cordis.patch.yml`、图标、`package.json` | 插件运行源码、挂载和包定义 | 当前实现，必须保留 |
| `tests/`、`scripts/`、`.github/workflows/` | 自动验证、真实宿主检查、打包部署与发布 | 开发维护需要，不要求全部装进运行包 |
| `docs/`、README、贡献指南、更新日志、LICENSE | 使用说明、维护规则、发布与历史记录 | 当前说明与历史记录分开看；旧记录不能证明新版已验收 |
| `.git/` | 提交、标签、分支、暂存区、stash、reflog、工作树元数据 | 维护与完整恢复需要，不能当缓存清理 |
| `release-evidence/<版本>/` | 当版安全清单及可公开的脱敏证据 | 初始待验收；不是旧报告的汇总通过章 |
| `outputs/archive/` | 历史开发版本、未完成代码与整理前快照的存档入口 | 只作追溯，禁止整包上传为发行源码；其中可能含本机配置及历史记录 |
| `outputs/` 中其他目录 | 历史包、源码快照、测试报告、截图与安装备份 | 不是当前源码；现有安装的 `file:` 依赖和报告链接可能仍引用，不能按日期批量删除/移动 |
| `work/` | 临时脚本、预览及中间材料 | 不进入运行包；仍在使用或唯一副本须先存档 |
| `node_modules/` | 本机开发/预览工具依赖 | 可重建，不是插件源码；清理前确认没有任务在用 |
| `CURRENT-VERSION.json` | 最近部署和此前部署链 | 不是整个当前工作区的验收状态；实际安装和运行须另外检查 |

## 本机运行目录

- `%USERPROFILE%/.dsh/` 是 DSH 真实数据目录，包含会话、附件、项目登记、配置与同步状态；不是这个源码仓库的临时文件。
- `.dsh/profiles/desktop/` 和 `.dsh/profiles/web/` 是两套独立插件安装位置。它们共享数据目录不代表已安装相同插件构建。实际安装包引用可能仍指向源码目录的 `outputs/`，移动前必须核对。
- `.dsh/.chatsync-local/` 保存本机恢复原件、传输副本、修复材料及本机凭据会话备份；不能因为整理工程就删除。同步排除规则须持续覆盖它。
- `.dsh/workspace-repos/` 和 `.dsh/.git/` 是同步与恢复使用的 Git 存储，区别于源码仓库的 `.git/`。未证明可重建且无独有历史前不能删除。
- `%LOCALAPPDATA%/Programs/DeepSeek Harness/` 是 Desktop 程序及内置运行时；源码修改不会自动让运行中的宿主加载新代码。
- `%APPDATA%/npm/node_modules/@deepseek-ai/dsh/` 是另一套全局 CLI/Web 运行环境；不能代替 Desktop 的内置安装命令。
- `%USERPROFILE%/.codex/worktrees/` 中可能有旧开发工作树；Git 登记还在不代表目录仍存在，整理前保存可用目录及 Git 元数据。

## 模型约束与记忆分开管理

- 项目 `AGENTS.md` 是当前项目维护约定，`CONTRIBUTING.md` 是维护/发布指南。历史任务文档中的“本轮”只属于当时任务。
- `%USERPROFILE%/.codex/AGENTS.md` 是 Codex 的用户级约定；本会话实际提供的系统、开发者及用户指令仍优先。不要把文档里写的“必须”理解成比当前用户指令更高的权限。
- `%USERPROFILE%/.codex/memories/` 是 Codex 经验记录；`%USERPROFILE%/.dsh/AGENTS.md` 和 `.dsh/memory/lessons.md` 是 DSH 环境的另一套全局规则与经验。两套不能混为一份当前事实；日期、版本、环境都要核实。
- 存档里的 AGENTS、贡献指南、记忆和配置只供追溯，不能在后续任务中重新启用；整理项目不包含删除或改写其他项目的全局记忆。

2026-10-23 的本机详细盘点、历史存档校验和待决定规则保存在本机 `outputs/project-organize-20261023/`。
