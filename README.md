<div align="center">

# DSH 接着聊

### 换台电脑，接着聊、接着做。

把 DeepSeek Harness（DSH）的会话、附件、设置和项目文件同步到你的其他电脑。<br>
数据存放在你自己的 GitHub 私有仓库中。

[![npm](https://img.shields.io/npm/v/%40dpskk2%2Fdsh-chatsync?color=2563eb)](https://www.npmjs.com/package/@dpskk2/dsh-chatsync)
[![MIT](https://img.shields.io/badge/license-MIT-slateblue)](LICENSE)

[安装使用](#使用前准备) · [详细指南](docs/getting-started.md) · [源码下载](https://github.com/dpskk2/dsh-chatsync/releases/latest) · [更新日志](CHANGELOG.md) · [English](README.en.md)

</div>

- **会同步：** 会话、附件、模型与界面设置，以及工作区里的项目文件。
- **需要另行准备：** 新电脑的模型 API 密钥、其他插件和项目依赖。
- **怎样同步：** 原电脑先同步，新电脑再同步。每次同步都会取回远端数据并上传本机改动。

## 使用前准备

准备：DSH ≥ `0.1.5-rc.3` 能正常打开，已安装 [Git](https://git-scm.com/downloads/) 和 [GitHub CLI](https://cli.github.com/)，能访问 GitHub。

### 安装插件

在 PowerShell 中，按使用的端执行；两端都用就分别安装。

**Web 端：**

```sh
dsh plugin --profile web add @dpskk2/dsh-chatsync
```

**桌面端（Windows 默认安装位置）：**

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add @dpskk2/dsh-chatsync
```

桌面端先打开一次，再完全退出（含托盘）后安装；自定义安装位置或安装报错见[桌面安装详解](docs/getting-started.md#桌面端桌面应用)。

<details>
<summary>更新插件</summary>

桌面端先完全退出应用（含托盘）。更新后重新启动 DSH。

**Web 端：**

```powershell
dsh plugin --profile web update @dpskk2/dsh-chatsync
```

**桌面端：**

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop update @dpskk2/dsh-chatsync
```

</details>

<details>
<summary>卸载插件</summary>

桌面端先完全退出应用（含托盘）。卸载后重新启动 DSH。

**Web 端：**

```powershell
dsh plugin --profile web remove @dpskk2/dsh-chatsync
```

**桌面端：**

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove @dpskk2/dsh-chatsync
```

</details>

### 登录 GitHub

```sh
gh auth login --hostname github.com --git-protocol https --web
```

按提示完成浏览器授权；询问是否让 Git 使用此账号时选 **Yes**。

## 第一次使用

安装后重新启动 DSH，打开 **设置 → 同步**，按设置页的四步完成。先在原电脑操作，再接入新电脑。

### ① 连接同步仓库

- **第一次使用：** 仓库地址留空，保持「地址留空时自动创建或复用私有仓库」勾选，分支保留 `main`。同步时会尝试创建或复用账号下的 `dsh-sync` 私有仓库。
- **已有同步仓库：** 填写仓库地址和分支；接入新电脑时，使用原电脑显示的地址和分支。

点击 **保存连接，继续第 2 步**。

**注意：** 保存只写入设置，不代表已连接成功；第③步才会检查连接并传输数据。

### ② 选择同步内容和方式

默认同步会话、附件、设置和工作区里的项目文件。只需要会话与设置时，关闭 **同步工作区文件**；关闭后暂停项目文件的上传与取回，远端已有文件保留但不再更新。

首次保留 **手动同步**，点击 **保存选择，继续第 3 步**。

**注意：** 首次同步前检查敏感文件。专用凭据文件不会上传，但聊天、附件或项目文件中的密钥仍可能被同步；需要时先设置[排除规则](docs/sync-content.md)。

### ③ 在原电脑开始同步

点击 **立即同步**，取回远端数据并上传本机改动。传输完成前保持 DSH 打开。

**确认结果：** 设置页显示仓库地址、本机同步已完成，且没有同步失败。只显示「本地快照」表示尚未上传，新电脑还无法取回；失败时查看「上次同步详情」，处理后重试。

### ④ 在新电脑取回并验证

1. 完成前面的安装与登录，使用**同一个 GitHub 账号**。重新启动 DSH，在设置页填写**原电脑的仓库地址和分支**，保存连接及同步内容选择。
2. 点击 **立即同步**，确认原电脑的会话和选定的项目文件已出现。分组未刷新时重启 DSH；项目路径需要调整时，在「本机新创建的工作区」中点「换位置」。
3. 在新电脑创建一条测试会话并同步，再回原电脑同步，确认也能看见这条会话。需要同步项目文件时，再用一个测试文件检查双向传输。

**注意：** 换机后仍需配置本机模型 API 密钥、安装其他插件和项目依赖。

## 日常使用

**开工前同步，收工后同步，确认成功再换电脑。** 日常可在侧栏点「⟳ 同步」。

双向验证通过后，可在 **设置 → 同步 → 选择同步内容和方式** 中选择「自动同步」，开启「允许自动同步」并保存。默认每 5 分钟同步，也响应会话活动；完整触发时机见[配置参考](docs/configuration.md)。

## 详细说明与帮助

- **安装与排障：** [工具准备、桌面安装与常见问题](docs/getting-started.md)。
- **换电脑：** [取回数据、项目路径与依赖安装](docs/getting-started.md#第二台电脑)。
- **同步设置：** [自动同步、周期、代理与自定义仓库](docs/configuration.md)。
- **同步范围：** [哪些内容会同步、如何排除文件](docs/sync-content.md)。
- **冲突与恢复：** [合并规则与原件保留位置](docs/sync-content.md#合并与恢复边界)。
- **同步后重启：** [自动重启条件与会话生成中的处理](docs/configuration.md#会话生成中与重启守卫)。
- **提交反馈：** [报告问题](https://github.com/dpskk2/dsh-chatsync/issues/new/choose)，附错误信息并隐藏私人内容和密钥。

同步会传播删除和修改，重要资料请另留备份。

[更新记录](CHANGELOG.md) · [开发与验证](CONTRIBUTING.md)
