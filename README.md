<div align="center">

# DSH 接着聊

### 换台电脑，接着聊、接着做。

把 DeepSeek Harness（DSH）的会话、附件、设置和项目文件同步到你的其他电脑。<br>
数据存放在你自己的 GitHub 私有仓库中。

[![npm](https://img.shields.io/npm/v/%40dpskk2%2Fdsh-chatsync?color=2563eb)](https://www.npmjs.com/package/@dpskk2/dsh-chatsync)
[![MIT](https://img.shields.io/badge/license-MIT-slateblue)](LICENSE)

[安装使用](#第一次使用) · [详细指南](docs/getting-started.md) · [源码下载](https://github.com/dpskk2/dsh-chatsync/releases/latest) · [更新日志](CHANGELOG.md) · [English](README.en.md)

</div>

适合在自己的多台电脑之间交替使用 DSH。原电脑同步一次，新电脑取回后就能继续。

- **会同步：** 会话、附件、模型与界面设置，以及工作区里的项目文件。
- **需要另行准备：** 新电脑的模型 API 密钥、其他插件和项目依赖。
- **连项目一起带走：** 不仅同步会话，还同步工作区里的项目文件，换台电脑继续聊，也继续做。

## 第一次使用

准备：DSH 能正常打开，已安装 [Git](https://git-scm.com/downloads/) 和 [GitHub CLI](https://cli.github.com/)，能访问 GitHub。

### ① 安装插件

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

### ② 登录 GitHub

```sh
gh auth login --hostname github.com --git-protocol https --web
```

按提示完成浏览器授权；询问是否让 Git 使用此账号时选 **Yes**。

### ③ 在原电脑同步

重新启动 DSH，打开 **设置 → 同步**，点击 **立即同步**。默认自动创建或复用 GitHub 私有仓库，无需手动建仓。

**注意：** 不需要项目文件时，先关闭「同步工作区文件」并保存；只显示「本地快照」表示尚未上传。

### ④ 在新电脑取回

重复①②，登录**同一个 GitHub 账号**，重新启动 DSH 后点击同步。取回成功后再次重启，配置本机模型 API 密钥，即可继续聊天。

**注意：** 其他插件和项目依赖需另装；自定义仓库时，两台电脑的地址与分支须一致。

## 日常使用

**开工前同步，收工后同步，确认成功再换电脑。** 侧栏点「⟳ 同步」；需要自动同步时，在 **设置 → 同步 → 同步偏好** 中开启并保存。

## 详细说明

- **安装与排障：** [工具准备、桌面安装、两套 dsh 命令与常见问题](docs/getting-started.md)。
- **换电脑：** [取回数据、项目路径与依赖安装](docs/getting-started.md#第二台电脑)。
- **同步设置：** [自动同步、周期、代理与自定义仓库](docs/configuration.md)。
- **同步范围：** [哪些内容会同步、如何排除文件](docs/sync-content.md)。

### 功能与边界

- **会话归组：** 同步会话与工作区的对应关系，并尝试补登记；侧栏需要刷新时会提示重启。
- **自动同步：** 默认关闭；开启后默认每 5 分钟同步，也响应会话活动。启动时双向同步，正常退出时尝试保存并上传；需要 DSH 保持运行且网络可用，详见[配置参考](docs/configuration.md)。
- **冲突处理：** 可确认的追加会话记录原样接续；分叉时保留一侧，双方原件留在 Git 历史，同步详情提供恢复位置。设置按字段合并，普通文件冲突通常保留本机版本。
- **重启修复：** Windows 上按宿主调整说明与动作：Web 重启 Web 服务，桌面端关闭并重新打开应用。自动重启默认开启（明确关闭的配置会保留），检测到会话生成时暂停，活动未知时仅提示手动重启；脚本要求见[重启说明](docs/configuration.md#会话生成中与重启守卫)。
- **补丁托管（高级）：** `.dsh/patches/` 随仓库同步，Web 端启动和同步后检查并套用；桌面端不应用这套 Web 运行时补丁。

## 数据与隐私

专用凭据文件不会上传，但聊天、附件或项目文件中写入的密钥仍可能被同步。可用[排除规则](docs/sync-content.md)控制上传范围。同步会传播删除和修改，重要资料请另留备份。

## 更新与帮助

每个新版本都会在 [GitHub Releases](https://github.com/dpskk2/dsh-chatsync/releases) 提供中文更新说明和对应版本的完整源码 ZIP。需要下载源码时，打开版本页面，在 **Assets** 中选择 `dsh-chatsync-v版本号-source.zip`；安装和更新插件请使用下方命令及前面的安装步骤。

这里的“完整源码 ZIP”指对应标签下全部受版本控制的文件，包含 `tests/`、开发检查脚本和文档，不包含 Git 历史、依赖或仓库外的本机文件。npm 包按 `package.json` 的 `files` 清单提供运行时代码、桌面重启脚本及选定文档，不包含测试和开发检查脚本；两者用途和内容范围不同。随 npm 包提供的验证记录是历史验证证据，不代表当前版本新增了同等范围的实机验证；当前版本见 [0.20.0 验证记录](docs/release-0.20.0-validation.md)。

更新插件后重启 DSH：

```sh
dsh plugin --profile web update @dpskk2/dsh-chatsync
```

桌面版改用桌面应用自带的命令运行时更新（同样先完全退出桌面应用）：

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop update @dpskk2/dsh-chatsync
```

- 安装失败、找不到同步入口、上传失败或新电脑没有会话：查看[常见问题](docs/getting-started.md#常见问题)。
- 代理、自定义仓库和其他设置：查看[配置参考](docs/configuration.md)。
- 仍有问题：[提交反馈](https://github.com/dpskk2/dsh-chatsync/issues/new/choose)，附错误信息并隐藏私人内容和密钥。

支持 DSH 的 `web` 与桌面版 `desktop` profile，声明要求 DSH ≥ `0.1.5-rc.3`、Node.js ≥20；建议 Node.js 24。已验证 DSH Web `0.2.0-rc.1`；实际测试范围见[验证记录](docs/release-0.12.12-validation.md)。

[更新记录](CHANGELOG.md) · [开发与验证](CONTRIBUTING.md)
