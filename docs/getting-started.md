# 安装与日常使用

本版最低支持 DSH **0.2.0-rc.1**，桌面端推荐 **0.2.1-rc.2 或更新版**；独立运行使用 Node.js 24 或更新版。这是本版验证范围的支持下限，不代表侧边栏接口从该版本才出现。插件管理 → 添加插件输入 **chatsync**；旧包名 **@dpskk2/dsh-chatsync** 继续提供同版本，已安装用户可沿用原包名。

从 [GitHub Release](https://github.com/dpskk2/dsh-chatsync/releases/latest) 下载已发布版本的 tgz 安装包和完整源码 ZIP，验证范围以该版本日志为准。0.21.0 当前为本机候选，尚未对外发布；本地检查不能代替物理双机验收。Web 与 Desktop 分别安装并重新打开。

## macOS 与 Windows 的差异

下表按功能列出 macOS 桌面端的情况。Web 端除自动重启外与桌面端相同。macOS 没有真机验收记录，自动测试在 GitHub 的 macOS 环境运行。

| 功能 | macOS 上 |
| --- | --- |
| 同步会话、附件、设置、指令与技能、项目文件；同步仓库与本机存储；找回同步前的内容 | 相同 |
| 启动时取回、退出时上传 | 相同 |
| 确认过的修复在退出 DSH 后执行 | 相同，也会等 DSH 完全退出 |
| 命令行修复（`node lib/cli.mjs`） | 相同，用 `ps` 确认 DSH 已退出 |
| 插件更新命令 | 指向当前运行的 `DeepSeek Harness.app` 内的命令行，在“终端”中执行，执行前按 Command+Q 退出 |
| 自动使用系统代理 | 读取 macOS 系统代理（`scutil --proxy`）；和 Windows 一样不执行 PAC 脚本 |
| Git 登录 | 使用 GitHub CLI 或“钥匙串”（`osxkeychain`），不使用 Git Credential Manager |
| 桌面端自动重启、「关闭并修复」 | **不提供。** 需要刷新会话列表时提示手动退出再打开；「关闭并修复」按钮不显示，修复在退出后自动执行 |
| 本地安装脚本 `install-local-desktop.mjs` | **不提供。** 用「添加插件」，或用 `app` 内的 `dsh` 命令安装 |
| 打开 Windows 上建的会话 | **不能。** 宿主不接受另一种系统的工作目录，这类会话不导入、远端保留，同步不受影响 |

macOS 与 Windows 共用仓库时还有两个边界：

- `.DS_Store`、`._*`、`Thumbs.db`、`desktop.ini` 不同步。
- macOS 允许但 Windows 不允许的文件名（含 `?`、`*`、`:` 等，或以点或空格结尾）：指令与技能里的这类新文件留在本机，并在上次同步详情中列出；项目文件中的这类文件会让 Windows 上这个项目的同步报错，需要改名。

## 1. 安装本地包

先解压完整源码 ZIP，把同批提供的安装包（如 `dpskk2-dsh-chatsync-0.21.0.tgz`）放到源码目录的 `outputs/` 下。桌面端可在源码目录打开 PowerShell，运行随源码提供的备份安装脚本。已安装 Node.js 24 时：

```powershell
node scripts\install-local-desktop.mjs outputs\dpskk2-dsh-chatsync-0.21.0.tgz outputs\install-0.21.0
```

没有单独安装 Node.js 时，可借用桌面端自带的运行环境。整行复制运行，不要拆开（`2>&1` 让报错显示在窗口中，最后显示退出码）：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'; & "$env:LOCALAPPDATA\Programs\DeepSeek Harness\DeepSeek Harness.exe" scripts\install-local-desktop.mjs outputs\dpskk2-dsh-chatsync-0.21.0.tgz outputs\install-0.21.0 2>&1 | Out-Host; "退出码 $LASTEXITCODE"; Remove-Item Env:ELECTRON_RUN_AS_NODE
```

退出码为 0 且显示「桌面端已安装」才表示成功；失败时会显示「安装失败：」及原因。原包名 `@dpskk2/dsh-chatsync` 与短包名 `chatsync` 请按当前已安装的包名选择安装包。安装需要能访问 npm 官方源；出现 `ECONNREFUSED` 时多半是设置了代理但代理软件没有运行。安装记录目录必须是新的，避免覆盖回滚材料。脚本使用 Desktop 自带的 DSH 命令，只安装包并核对版本；安装后从菜单完全退出桌面应用，再重新打开，以加载新源码。

Web 端在同一位置安装本地包：

```powershell
dsh plugin --profile web add "file:./outputs/dpskk2-dsh-chatsync-0.21.0.tgz"
```

然后重新启动 Web 宿主。仅命令退出成功不等于正在运行的宿主已经加载新版本；可在同步状态接口或更新信息中核对 `currentVersion`，并检查实际宿主类型与状态。

## 2. 第一次设置

点击侧边栏「同步」，也可进入「设置 → 同步」：

1. **同步仓库。** 安装 Git。使用默认仓库（GitHub）时再安装 GitHub CLI，打开“终端”运行 `gh auth login --hostname github.com --git-protocol https --web`（如需通过代理访问 GitHub，请确保已通过环境变量为 GitHub CLI（gh）配置可用代理，或已启用能够代理 GitHub 流量的 TUN 模式），根据指引完成授权：输入 Y，按 Enter 打开授权页，在浏览器输入“终端”显示的一次性代码。点击「使用默认仓库并继续」；首次点击「立即同步」才创建或复用当前账号的 dsh-sync 私有仓库。第二台电脑登录同一账号即可复用，使用其他仓库时，点击「使用其他仓库」，填写已有私有仓库地址；GitHub 仓库保存时检查私有状态和当前账号的写入权限。也可以填写 Gitee、GitLab 等托管站的私有仓库，先在每台电脑登录一次，见[其他 Git 托管站](configuration.md#其他-git-托管站)。连接后隐藏地址输入框，需要修改时点击「更换同步仓库」。
2. **选择内容。** 会话、聊天附件、可共享设置、项目文件分别选择，修改即时保存。首次连接默认开启自动同步（启动取回、退出上传）；已有明确开关保留。
3. **首次同步。** 点击「立即同步」。如有预览，核对范围和配置变化后「确认并继续」。等待完成，失败时查看实际错误重试。

未连接仓库时不会在启动或退出自动建仓；使用默认仓库时，手动同步会自动创建或复用私有仓库。只生成本地快照不等于已经上传。

## 3. 日常使用

设置完成后直接进入「日常同步」，状态和按钮位于最上方。「同步设置」与「同步仓库管理」常驻显示。默认使用 main 分支；界面无需填写，已有自定义分支保留，可在配置文件中调整。

自动同步只有启动和正常退出两个时机。总开关关闭仍可手动同步；启动失败可重试或本次离线。桌面端需从菜单完全退出，关闭窗口到托盘不会触发退出上传。断网、强退和立即关机可能无法完成上传。

同步期间可查看当前步骤；失败后根据提示检查并重试。

## 4. 换台电脑接着使用

在另一台电脑安装同一批包，连接同一个私有仓库，取回后打开已有会话、附件和项目文件检查。再新增一句对话并同步，回原电脑取回核对。

项目文件放在用户主目录下时（如 `C:\Users\<名字>\Documents\…` 或 `/Users/<名字>/Documents/…`），另一台电脑会放到本机主目录下的相同位置，Windows 与 macOS 之间也一样。放在主目录以外的项目（如 `D:\work`）到了另一种系统上没有对应位置，不会传输项目文件，请在同步设置中为它选择本机保存位置。

API 密钥、插件及项目依赖需在各电脑单独配置。

## 需要找回内容时

展开「查看冲突内容」，选择文件并点击「查看内容」对比双方原件。项目文件可在对比窗口底部恢复，会话分叉可另存为独立会话。历史数据问题使用独立的「检查与修复历史数据」，详见[配置与恢复](configuration.md)。

[同步范围](sync-content.md) · [本版验证记录](release-0.21.2-validation.md)
