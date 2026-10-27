# scripts 目录说明

这些脚本都不装入运行包（随包的只有 `restart-dsh-desktop.ps1`）。除非另有说明，均只使用合成数据、隔离目录和本地 Git，不读写个人 `~/.dsh`，也不连接个人同步仓库。结果统一归档到本机 `outputs/`。

## 发布与打包

| 脚本 | 用途 | 何时运行 |
| --- | --- | --- |
| `build-client.mjs` | 由 `src/client/` 生成浏览器端 `lib/client.js`；`--check` 只核对二者一致 | 修改界面后；`npm test` 与发布工作流自动核对 |
| `release-notes.mjs` | 从 `CHANGELOG.md` 提取当前版本的日志，生成 `release-notes.md` | 发布工作流自动运行 |
| `check-release-safety.mjs` | 校验发版安全清单、源码指纹和候选包哈希（`--init`、`--fingerprint`、`--package <tgz>`） | 定版前；发布工作流自动运行 |
| `check-package-contents.mjs` | 检查 npm 实际打包的文件、运行入口和随包文档的相对链接 | 修改 `package.json` 的 `files` 或随包文档后；CI 自动运行 |
| `pack-short-name.mjs` | 用同一份实现生成短包名 `chatsync` 的安装包 | 发布工作流自动运行 |
| `pack-local.mjs <outputs 下的新目录> [--short-name]` | 用已登记的源码在本机打包候选安装包；`--short-name` 生成短包名 `chatsync` | 本机部署前 |
| `install-local-desktop.mjs <tgz> <outputs 下的新目录>` | 把本机候选包装进桌面端 profile，先备份 profile 与旧插件 | 本机部署时；会修改桌面端插件安装 |
| `restart-dsh-desktop.ps1` | 桌面端「立即重启」使用的重启脚本（随包发布；仓库中唯一的 PowerShell 脚本，须兼容 Windows PowerShell 5.1，由 `tests/powershell-scripts.test.mjs` 检查） | 由插件调用 |

## 回归运行器

| 脚本 | 用途 | 何时运行 |
| --- | --- | --- |
| `check-runtime-regression.mjs` | 运行完整 `npm test` 并保存终态；`--desktop` 改用已安装桌面端的内置 Node | 需要留存完整回归证据时 |
| `run-desktop-regression.mjs <electron.exe>` | 用 Electron 的 Node 运行完整回归，并真正等待进程退出 | CI 的 Windows Electron 任务；本机复核桌面运行时 |
| `test-changed.mjs` | 只运行与改动相关的测试，以及对改动文件的 ESLint、Prettier、类型检查和界面生成一致性检查（`npm run test:changed`）。默认比较未提交的改动，`--base <ref>` 改为与指定提交比较；`--deep` 连同经由其他 `lib/` 模块间接受影响的测试一起运行（核心模块的改动接近完整测试）；`--list` 只列出将运行的项目。没有直接对应测试的模块会单独列出 | 修改过程中的快速检查；不代替提交前的完整 `npm test` |
| `profile-test-spawns.mjs` | 测试预加载模块，记录子进程耗时和退出码（不记录参数和输出） | 排查测试变慢时：`node --import ./scripts/profile-test-spawns.mjs --test …` |

## 真实宿主检查（需要本机已安装 DSH）

| 脚本 | 检查内容 |
| --- | --- |
| `check-dsh-host.mjs <dsh包目录>` | 两个临时 DSH 主目录的原生宿主冒烟测试 |
| `check-dsh-desktop.mjs [安装目录]` | 已安装桌面宿主、隔离 profile；可选 `--github-real <专用测试仓库>` |
| `check-dsh-evolution.mjs <dsh包目录>` | 真实宿主下的同步演进场景；可选 `--serve`、`--repair-offline`、`--github-real` |
| `check-dsh-sessions.mjs <dsh包目录> <dsh主目录>` | 用已安装的官方编解码器只读校验会话，不输出消息内容 |
| `check-dsh-file-catalog.mjs` | 只读取官方 npm 包，核对 DSH 文件目录说明 |
| `check-dsh-import-integration.mjs …` | 与官方配套包的导入集成（参数为已解包的 npm 包目录） |
| `check-session-upgrade-native.mjs` | 真实 v0.20.0 引擎 → 当前引擎的升级往返（需要 `v0.20.0` 标签） |
| `check-issue4-safe.mjs` | 宿主公开写入接口 + 两个隔离宿主下的 issue #4 安全验证 |
| `check-data-repair-native.mjs` | 历史数据修复在真实宿主中的验收 |
| `check-lifecycle-desktop.mjs` | 桌面宿主关闭与退出上传进程 |
| `check-local-package-desktop.mjs` | 实际打包的插件装入隔离桌面宿主后的检查 |
| `check-connection-desktop.mjs` | 桌面端备份连接接口；只读检查已有仓库 |
| `check-grouping-desktop.mjs`、`check-grouping-intent-desktop.mjs` | 会话分组检查与归档行为 |
| `check-relocation-desktop.mjs` | 会话迁移 |
| `check-send-guard-desktop.mjs` | 启动同步期间的发送前检查 |
| `preview-settings-desktop.mjs` | 用当前源码和首次安装默认值预览设置页 |
| `native-fixture.mjs` | 上面几项共用的真实宿主夹具（不单独运行） |

## 需要真实 GitHub 的检查

只使用**专用的私有测试仓库**，不要填个人同步仓库。

| 脚本 | 检查内容 |
| --- | --- |
| `check-github-workspace.mjs <测试仓库地址>` | 真实 GitHub 传输项目文件（单台 Windows） |
| `prove-auto-repo-desktop.mjs` | 两个隔离桌面宿主的自动建仓与往返 |

## 演示与历史调查

| 脚本 | 说明 |
| --- | --- |
| `build-settings-demo.mjs` | 用实际组件、样式和首次安装默认值生成设置页静态演示 |
| `check-issue4-race.mjs` | issue #4 的确定性复现（`--tag v0.20.0`）。断言描述的是**旧版本的漏洞**，不是通过性测试 |
| `check-evolution-ablation.mjs` | 对比诊断（消融实验），不修改产品源码；只用于性能与设计取舍分析 |

新增脚本时请在本文件（`docs/scripts.md`）登记用途、参数和运行条件；一次性脚本在结论写进验证记录后删除，需要时可从 Git 历史恢复。
