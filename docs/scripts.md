# scripts 目录说明

这些脚本都不装入运行包（随包的只有 `restart-dsh-desktop.ps1`）。默认自动检查只使用合成数据、隔离目录和测试远端，不读写个人会话或连接个人同步仓库；下表列出的日常安装、只读个人配置检查与实网检查须按各自条件执行。原始结果按本机约定归档。

Windows 维护命令使用 PowerShell 7 的 `pwsh`；新建或修改 PowerShell 文件的版本声明和 UTF-8 BOM 要求见 [维护约定](../AGENTS.md)。现有随包重启脚本通过系统 `powershell.exe` 启动，当前运行目标是 Windows PowerShell 5.1。改动这条产品链路时，一并核对启动调用、目标设备可用运行时和相关测试。

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
| `restart-dsh-desktop.ps1` | Windows 桌面端安排重新打开或执行「关闭并修复」时使用；插件通过系统 `powershell.exe` 启动，兼容性测试见 `tests/powershell-scripts.test.mjs` | 由插件调用；修改时核对调用方与目标运行时 |

## 回归运行器

| 脚本 | 用途 | 何时运行 |
| --- | --- | --- |
| `check-runtime-regression.mjs` | 运行完整 `npm test` 并保存终态；`--desktop` 改用已安装桌面端的内置 Node | 需要留存完整回归证据时 |
| `run-desktop-regression.mjs <electron.exe>` | 用 Electron 的 Node 运行完整回归，并真正等待进程退出 | CI 的 Windows Electron 任务；本机复核桌面运行时 |
| `test-changed.mjs` | 只运行与改动相关的测试，以及对改动文件的 ESLint、Prettier、类型检查和界面生成一致性检查（`npm run test:changed`）。默认比较未提交的改动，`--base <ref>` 改为与指定提交比较；`--deep` 连同经由其他 `lib/` 模块间接受影响的测试一起运行（核心模块的改动接近完整测试）；`--list` 只列出将运行的项目。没有直接对应测试的模块会单独列出 | 修改过程中的快速检查；智能体按改动影响选择范围，必要时扩大验证或运行完整 `npm test` |
| `profile-test-spawns.mjs` | 测试预加载模块，记录子进程耗时和退出码（不记录参数和输出） | 排查测试变慢时：`node --import ./scripts/profile-test-spawns.mjs --test …` |

## 真实宿主检查（需要本机已安装 DSH）

| 脚本 | 检查内容 |
| --- | --- |
| `check-dsh-host.mjs <dsh包目录>` | 两个临时 DSH 主目录的原生宿主冒烟测试 |
| `check-dsh-desktop.mjs [安装目录]` | 已安装桌面宿主、隔离 profile；可选 `--github-real <专用测试仓库>` |
| `check-dsh-evolution.mjs <dsh包目录>` | 在隔离 Web 宿主内验证同步写入、冲突另存、会话列表缓存和重启读回；可选 `--serve`、`--repair-offline`、`--github-real` |
| `check-dsh-sessions.mjs <dsh包目录> <dsh主目录>` | 用已安装的官方编解码器只读校验会话，不输出消息内容 |
| `check-dsh-file-catalog.mjs` | 只读取官方 npm 包，核对 DSH 文件目录说明 |
| `check-dsh-import-integration.mjs …` | 与官方配套包的导入集成（参数为已解包的 npm 包目录） |
| `check-session-upgrade-native.mjs` | 真实 v0.20.0 引擎 → 当前引擎的升级往返（需要 `v0.20.0` 标签） |
| `check-issue4-safe.mjs` | 宿主公开写入接口 + 两个隔离宿主下的 issue #4 安全验证 |
| `check-data-repair-native.mjs` | 历史数据修复在真实宿主中的验收 |
| `check-lifecycle-desktop.mjs` | 桌面宿主关闭与退出上传进程 |
| `check-local-package-desktop.mjs` | 实际打包的插件装入隔离桌面宿主后的检查；未提交的本地候选加 `--working-tree` 与当前维护源码比对，默认仍与 HEAD 比对 |
| `check-connection-desktop.mjs` | 读取个人 `.dsh/dsh-sync.json` 中的现有远端，在隔离宿主中只读检查连接，可能访问个人远端；不纳入默认隔离自动检查，运行前核对授权与目标 |
| `check-grouping-desktop.mjs`、`check-grouping-intent-desktop.mjs` | 会话分组检查与归档行为 |
| `check-relocation-desktop.mjs [outputs 下的新目录]` | 会话迁移、匹配本机项目预选、完成后原件清理及重启读回；仅使用隔离合成数据 |
| `check-send-guard-desktop.mjs` | 启动同步期间的发送前检查 |
| `preview-settings-desktop.mjs` | 用当前源码和首次安装默认值预览设置页 |
| `native-fixture.mjs` | 上面几项共用的真实宿主夹具（不单独运行） |

## 需要真实 GitHub 或其他托管站的检查

只使用**专用的私有测试仓库**，不要填个人同步仓库。

| 脚本 | 检查内容 |
| --- | --- |
| `check-github-workspace.mjs <测试仓库地址>` | 真实 GitHub 传输项目文件（单台 Windows） |
| `prove-auto-repo-desktop.mjs` | 单台设备上两个隔离桌面宿主的自动建仓与往返；不是物理双机验收 |
| `check-remote-switch-real.mjs --github <测试仓库> --target <空仓库> --mirror-target <空仓库> [--public <公开仓库>]` | 单台设备上两个隔离桌面宿主经真实 GitHub 往返后，通过同步页的连接接口换到其他托管站（如 Gitee）：只带当前内容、复制全部分支两条路线，以及公开仓库被拒绝；仓库名须为 `chatsync-acceptance-*` 且初始为空，其他托管站需先在终端登录一次 |

## 演示与历史调查

| 脚本 | 说明 |
| --- | --- |
| `build-settings-demo.mjs` | 用实际组件、样式和首次安装默认值生成设置页静态演示 |
| `check-issue4-race.mjs` | issue #4 的确定性复现（`--tag v0.20.0`）。断言描述的是**旧版本的漏洞**，不是通过性测试 |
| `check-evolution-ablation.mjs` | 对比诊断（消融实验），不修改产品源码；只用于性能与设计取舍分析 |

新增脚本时请在本文件（`docs/scripts.md`）登记用途、参数和运行条件；一次性脚本在结论写进验证记录后删除，需要时可从 Git 历史恢复。

## issue #4 专项与官方恢复器

`tests/issue4-stress.test.mjs` 用合成日志、独立追加进程与多帧压缩日志检查写入竞态，普通 `npm test` 会运行这些断言，但不会自动下载专项官方恢复器。需要复核旧版 issue #4 数据时，可在隔离目录安装其固定恢复器版本；它不进入项目运行依赖或用户 DSH。

在 `pwsh` 中执行以下可选步骤；创建新的临时目录，避免覆盖旧报告：

```pwsh
$proofRoot = Join-Path ([IO.Path]::GetTempPath()) ('chatsync-issue4-' + [guid]::NewGuid())
npm install --prefix $proofRoot --ignore-scripts --no-audit --no-fund --no-save @deepseek-ai/dsh-session-format-catalog@0.2.0-rc.2
$env:DSH_ISSUE4_CATALOG_ROOT = $proofRoot
$env:DSH_ISSUE4_REPORT = Join-Path $proofRoot 'issue4-stress-proof.json'
node --test tests/issue4-stress.test.mjs
```

先确认安装命令成功，再运行测试。报告的 `complete` 为 `true`、测试退出码为 0 才表示专项执行完整；`officialCodec: true` 才表示使用了官方恢复器。记录实际版本、数据量、哈希与终态，原始报告按本机约定归档；测试后清除本次设置的环境变量，避免影响后续检查。此结果不是物理双机或实际窗口验收。
