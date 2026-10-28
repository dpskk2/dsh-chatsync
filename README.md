<div align="center">

# chatsync 接着聊
### 换台电脑，继续做。

把 DeepSeek Harness（DSH）的会话、附件、设置和项目文件带到另一台电脑。<br>
数据存放在你自己的 **GitHub 私有仓库**中。

[![npm](https://img.shields.io/npm/v/chatsync?color=2563eb)](https://www.npmjs.com/package/chatsync)
[![DSH](https://img.shields.io/badge/DSH-%E2%89%A50.2.0--rc.1-0f766e)](#兼容性)
[![Desktop](https://img.shields.io/badge/Desktop-%E6%8E%A8%E8%8D%90%200.2.1--rc.3-2563eb)](#兼容性)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524-43853d)](#兼容性)
[![MIT](https://img.shields.io/badge/license-MIT-slateblue)](LICENSE)

[安装方式](#安装方式) · [更新方式](#更新方式) · [首次设置](#第一次设置) · [换台电脑](#换台电脑接着使用) · [详细指南](docs/getting-started.md) · [发布与下载](https://github.com/dpskk2/dsh-chatsync/releases/latest) · [English](README.en.md)

</div>

## chatsync 能做什么

| 接着做的事 | 同步内容 |
| --- | --- |
| 接着聊 | 会话记录、聊天附件，以及会话与「工作区」的对应关系 |
| 接着做 | 项目文件夹中的文档、代码等文件 |
| 少配一遍 | 模型、界面设置；密钥、代理和本机路径各机保留；可选同步全局 AGENTS.md 与技能 |

## 安装方式

先准备能正常打开的 DSH、[Git](https://git-scm.com/downloads/) 和 [GitHub CLI](https://cli.github.com/)，以及可访问 GitHub 的网络。

未手动指定代理时，同步优先使用环境变量，否则跟随当前 Windows 系统代理；更换系统代理端口无需重启。已保存的固定代理可以改为空或 `auto`，详见[代理配置](docs/configuration.md)。

**推荐：在 DSH 中安装。** 打开「插件」→「添加插件」，输入 `chatsync`。

也可使用 PowerShell 安装：

**Web 端：**

```powershell
dsh plugin --profile web add chatsync
```

**Windows 桌面端：**

以下命令适用于默认安装位置，自定义安装时请调整路径。

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add chatsync
```

旧包名 `@dpskk2/dsh-chatsync` 继续提供同版本，原有安装可沿用，无需重复安装两个包名。

也可从 [GitHub Release](https://github.com/dpskk2/dsh-chatsync/releases/latest) 下载安装包，按[本地包安装指南](docs/getting-started.md#1-安装本地包)操作。

## 更新方式

**如果原先安装的是 `@dpskk2/dsh-chatsync`，把命令中的 `chatsync` 换成原包名。** 插件更新提醒可关闭，不会自动安装更新。

**Web 端：**

```powershell
dsh plugin --profile web update chatsync
```

**Windows 桌面端：**

以下命令适用于默认安装位置，自定义安装时请调整路径。

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop update chatsync
```

## 第一次设置

安装后重启 DSH，点击侧边栏「同步」，也可从「设置 → 同步」进入。

**① 登录 GitHub**

在 PowerShell 中执行，按提示在浏览器完成授权：

```powershell
gh auth login --hostname github.com --git-protocol https --web
```

**② 备份地址** — 点击「使用默认备份并继续」。首次同步时自动创建或复用 `dsh-sync` 私有仓库；使用已有仓库则点击「使用其他仓库」。

**③ 选择内容** — 按需勾选，修改即时保存。首次连接先手动使用，之后可开启自动同步。[完整同步范围与排除规则](docs/sync-content.md)

**④ 首次同步** — 点击「立即同步」，等待完成。确认上传成功后再换电脑；只生成本地快照不代表已经上传。

## 换台电脑接着使用

1. 原电脑同步成功后，在新电脑安装插件并登录同一 GitHub 账号。
2. 打开「同步」，使用默认备份；自定义仓库时，两台电脑使用相同仓库与分支。
3. 同步取回后，检查会话、附件和项目文件，配置本机模型 API 密钥。界面提示需要重启时，完全退出后重新打开。

其他插件和项目依赖需另装；项目目录不同可在同步设置中调整本机保存位置。[详细指南](docs/getting-started.md#4-换台电脑接着使用)

## 日常使用

点击侧边栏「同步」→「立即同步」。

开启自动同步后，会在启动和正常退出时运行。

启动同步期间可正常新建会话、工作区和编辑草稿。旧会话若提示等待，请在核对完成后再次发送；文字与附件会保留。

## 冲突与修复

- **查看冲突内容：** 选择文件，点击「查看内容」对比双方原件。项目文件可选择版本恢复，会话分叉可另存为独立会话。
- **会话与数据修复：** 在同步页打开处理页面，查看检查结果、预览方案并确认；需要退出 DSH 的修复会明确提示，原件和备份会保留。
- **分组检查：** 会话分组异常时，可在同步页查看检查结果与处理方案。

[冲突与恢复](docs/configuration.md#冲突原件与项目文件恢复) · [历史数据修复与会话分支](docs/data-repair-0.20.1.md)

## 数据与隐私

聊天、附件或项目文件中写入的密钥等敏感信息需自行处理，可用[排除规则](docs/sync-content.md)控制同步范围。本机凭据、锁、缓存及运行状态不参与传输。

会话分叉会保留为独立版本。远端删除不会直接删除本机会话。重要资料请另留备份。[同步与恢复边界](docs/configuration.md)

**同步仓库与本机存储（新增）：** 同步页点「检查」，按同步的会话、同步仓库、本机备份、远端旧文件各列一行数量和大小；点每行右侧的按钮，在弹出的窗口里查看明细、移出同步或删除。同步仓库一行显示新电脑首次同步要下载多少，其中多少是历史版本。[同步范围](docs/sync-content.md#同步仓库与本机存储) · [本机备份](docs/local-storage.md)

## 兼容性

支持 DSH 的 Web 和 Windows 桌面端，最低 **0.2.0-rc.1**；桌面端推荐 **0.2.1-rc.3 或更新版**。独立运行要求 **Node.js 24 或更新版**，桌面端使用应用自带运行时。

具体已验证与未覆盖范围见[本版验证记录](docs/release-0.21.0-validation.md)。

## 帮助与开发

[安装与使用](docs/getting-started.md) · [配置与恢复](docs/configuration.md) · [同步范围](docs/sync-content.md) · [文件说明](docs/dsh-file-catalog.md) · [提交问题](https://github.com/dpskk2/dsh-chatsync/issues)

开发需要 Node.js 24 和 Git，原生 ESM，无运行时 npm 依赖：

```powershell
npm test
npm pack --dry-run
```

[开发约定](https://github.com/dpskk2/dsh-chatsync/blob/main/CONTRIBUTING.md) · [更新日志](CHANGELOG.md) · [MIT License](LICENSE)
