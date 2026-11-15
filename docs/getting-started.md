# 安装与日常使用

最低支持 DSH **0.2.0-rc.1**。独立运行需要 Node.js 24 或更新版，桌面端使用应用自带运行时。准备好 Git 后，在「插件 → 添加插件」输入 `chatsync`。旧包名 `@dpskk2/dsh-chatsync` 继续提供同版本，已有安装可沿用原包名。

从 GitHub Release 下载同一版本的 tgz 安装包和完整源码 ZIP，验证范围以对应版本日志为准。Web 与 Desktop 分别安装并重新打开。[最新已发布版本](https://github.com/dpskk2/dsh-chatsync/releases/latest)

### 命令行安装

Web 端使用 DSH 命令，Windows 桌面端在 PowerShell 7 使用应用自带的命令。下面是默认安装路径，自定义安装时请替换路径。

```powershell
dsh plugin --profile web add chatsync
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add chatsync
```

macOS 桌面端在终端使用应用内的命令。

```bash
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add chatsync
```

更新已有安装时，可用插件详情页的更新入口，或执行提醒提供的更新命令。[插件更新](configuration.md#插件更新)

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
| 打开 Windows 上建的会话 | **不能。** 宿主不接受另一种系统的工作目录，这类会话不导入、云端保留，同步不受影响 |

macOS 与 Windows 共用仓库时还有两个边界：

- `.DS_Store`、`._*`、`Thumbs.db`、`desktop.ini` 不同步。
- macOS 允许但 Windows 不允许的文件名（含 `?`、`*`、`:` 等，或以点或空格结尾）：指令与技能里的这类新文件留在本机，并在上次同步详情中列出；项目文件中的这类文件会让 Windows 上这个项目的同步报错，需要改名。

## 1. 安装本地包

先解压完整源码 ZIP，把同批提供的安装包放到源码目录的 `outputs/` 下。在源码目录打开 PowerShell 7，按实际包名和版本替换下面的文件名。示例使用 `0.21.3` 源码版本。已安装 Node.js 24 时可运行随源码提供的备份安装脚本。

```powershell
node scripts\install-local-desktop.mjs outputs\dpskk2-dsh-chatsync-0.21.3.tgz outputs\install-0.21.3
```

没有单独安装 Node.js 时，可借用桌面端自带的运行环境。整行复制运行，不要拆开（`2>&1` 让报错显示在窗口中，最后显示退出码）：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'; & "$env:LOCALAPPDATA\Programs\DeepSeek Harness\DeepSeek Harness.exe" scripts\install-local-desktop.mjs outputs\dpskk2-dsh-chatsync-0.21.3.tgz outputs\install-0.21.3 2>&1 | Out-Host; "退出码 $LASTEXITCODE"; Remove-Item Env:ELECTRON_RUN_AS_NODE
```

退出码为 0 且显示「桌面端已安装」才表示成功；失败时会显示「安装失败：」及原因。原包名 `@dpskk2/dsh-chatsync` 与短包名 `chatsync` 请按当前已安装的包名选择安装包。安装需要能访问 npm 官方源；出现 `ECONNREFUSED` 时多半是设置了代理但代理软件没有运行。安装记录目录必须是新的，避免覆盖回滚材料。脚本使用 Desktop 自带的 DSH 命令，只安装包并核对版本；安装后从菜单完全退出桌面应用，再重新打开，以加载新源码。

Web 端在同一位置安装本地包：

```powershell
dsh plugin --profile web add "file:./outputs/dpskk2-dsh-chatsync-0.21.3.tgz"
```

然后重新启动 Web 宿主。仅命令退出成功不等于正在运行的宿主已经加载新版本；可在同步状态接口或更新信息中核对 `currentVersion`，并检查实际宿主类型与状态。

## 2. 第一次设置

点击侧边栏「同步」，也可进入「设置 → 同步」：

1. **同步仓库。** 安装 Git。使用 GitHub 默认仓库时，再按页内登录帮助安装 GitHub CLI 并完成 `gh auth login --hostname github.com --git-protocol https --web`，然后点「使用 GitHub 仓库」。首次同步时会创建或复用当前账号的 `dsh-sync` 私有仓库。使用已有仓库时点「使用其他仓库（实验性）」，填写 GitHub、Gitee、GitLab 等托管站的私有仓库 HTTPS 或 SSH 克隆地址，再点「验证并继续」。[其他 Git 托管站](configuration.md#其他-git-托管站)
2. **选择内容。** 会话、聊天附件、设置、指令与技能、项目文件默认都未勾选。至少选一项再点「继续」。选中项目文件后会显示各项目在本机使用的目录，必要时可以点「更改」。
3. **首次同步。** 点「立即同步」保存连接并开始同步。如有预览，按提示选择。等待上传完成，失败时可根据提示重试。

未连接仓库时不会在启动或退出自动建仓；使用默认仓库时，手动同步会自动创建或复用私有仓库。只生成本地快照不等于已经上传。

## 3. 日常使用

设置完成后，同步页顶部显示状态、网络和「立即同步」。「同步设置」中可修改同步范围与自动同步。勾选「项目文件」后，保存位置直接显示在同步设置中。「更换同步仓库」会打开仓库地址和登录帮助。默认使用 `main` 分支，已有自定义分支可在配置文件中调整。

自动同步只有启动和正常退出两个时机。总开关关闭仍可手动同步；启动失败可重试或本次离线。桌面端需从菜单完全退出，关闭窗口到托盘不会触发退出上传。断网、强退和立即关机可能无法完成上传。

同步期间可在状态灯旁查看当前步骤。失败时自动展开「上次同步详情」，点击网络状态可重新检测。

## 4. 换台电脑接着使用

在另一台电脑安装同一批包，连接同一个私有仓库，取回后打开已有会话、附件和项目文件检查。再新增一句对话并同步，回原电脑取回核对。

项目文件放在用户主目录下时（如 `C:\Users\<名字>\Documents\…` 或 `/Users/<名字>/Documents/…`），另一台电脑会放到本机主目录下的相同位置，Windows 与 macOS 之间也一样。放在主目录以外的项目（如 `D:\work`）到了另一种系统上没有对应位置，不会传输项目文件，请在同步设置中为它选择本机保存位置。

API 密钥、插件及项目依赖需在各电脑单独配置。

Windows 上创建且依赖 Windows 工作目录的会话在 macOS 不导入，原件保留在同步仓库。macOS 上创建的会话可以导入 Windows 查看；继续对话时如果原目录不可用，可按提示放入本机项目。

## 需要找回内容时

有会话冲突时，同步页会展开待处理的列表。点会话的「查看冲突」，可并排比较本机和云端消息。可保留两个版本，或只保留当前版本并在「历史冲突会话备份 → 管理备份」查看舍弃的版本。项目文件和其他恢复原件在「同步仓库与本机存储（实验性）→ 管理存储 → 找回同步前的内容」。遇到会话归属或记录问题，可点「检查会话问题」。[配置与恢复](configuration.md)

[同步范围](sync-content.md) · [本版验证记录](release-0.21.3-validation.md)
