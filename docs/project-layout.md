# 项目目录与维护入口

维护时先读 [AGENTS.md](../AGENTS.md) 和存在的本机约定，再按任务需要查阅其余入口。工作决策与验收分工在 AGENTS，命令与操作在 [贡献指南](../CONTRIBUTING.md)，脚本能力与前提在 [脚本说明](scripts.md)，模块分工与数据流在 [架构说明](architecture.md)。[发布安全检查](release-safety-checklist.md) 用于正式定版和发布，不是每次文字修改的操作清单。

## 仓库目录

| 目录或文件 | 用途 | 保留原则 |
| --- | --- | --- |
| `lib/`、`cordis.patch.yml`、`icon.png`、`package.json` | 插件运行源码、挂载配置和包定义 | 当前维护源；删改时核对引用与安装包声明 |
| `src/client/` | 浏览器端界面源码，按文件名顺序拼成 `lib/client.js` | 修改后运行 `node scripts/build-client.mjs`，不装入运行包 |
| `tests/` | 自动回归（`npm test`） | 开发维护需要，不装入运行包 |
| `scripts/` | 真实宿主检查、打包、部署与发布脚本，用途见 `docs/scripts.md` | 长期未修改不代表无用 |
| `.github/workflows/` | CI（`check.yml`）、诊断包与发布流程 | 修改推送到远端后才生效 |
| `docs/` | 当前有效的使用说明、配置参考与维护文档 | 部分随安装包提供，见 `package.json` 的 `files` |
| `docs/history/` | 带日期的界面、启动、修复等开发过程记录 | 只作追溯，按各自日期与构建解读 |
| `release-evidence/<版本>/` | 当版安全清单、脱敏证据和发布决定 | 复核与本次候选的对应关系，不把旧结论直接写成本次通过 |
| README、`CONTRIBUTING.md`、`CHANGELOG.md`、`LICENSE` | 使用说明、维护规则与历史记录 | 旧记录不能证明新版已验收 |

本机生成、不入库的目录（如 `outputs/`、`work/`、`node_modules/`）和本机状态文件已在 `.gitignore` 中排除；维护者的本机约定写在不入库的 `AGENTS.local.md`。`CLAUDE.md` 只引用 `AGENTS.md`，供 Claude Code 自动加载；不入库的 `CLAUDE.local.md` 引用本机约定。

## DSH 运行目录

以下是用户电脑上的 DSH 数据和运行位置，与源码仓库无关。整理或测试时不得把它们当作缓存清理：

- `%USERPROFILE%/.dsh/` 是 DSH 的真实数据目录，包含会话、附件、项目登记、配置与同步状态。
- `.dsh/profiles/desktop/` 和 `.dsh/profiles/web/` 是两套独立的插件安装位置。共享数据目录不代表装了相同的插件构建。
- `.dsh/.chatsync-local/` 保存本机恢复原件、传输副本、修复材料及本机凭据会话备份，同步排除规则须一直覆盖它。
- `.dsh/workspace-repos/` 和 `.dsh/.git/` 是同步与恢复使用的 Git 存储，不同于源码仓库的 `.git/`。在证明可重建且没有独有历史之前，不能删除。
- `%LOCALAPPDATA%/Programs/DeepSeek Harness/` 是桌面端程序及内置运行时；修改源码不会让运行中的宿主自动加载新代码。
- `%APPDATA%/npm/node_modules/@deepseek-ai/dsh/` 是另一套全局 CLI / Web 运行环境，不能代替桌面端的内置安装命令。

## 历史材料

历史任务、旧约定与经验记录按原日期和环境追溯，当前工作以 AGENTS 及用户当次指令为准。AI 工具的约定与 DSH 自身规则属于不同来源，使用前核对其适用范围。
