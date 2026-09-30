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
- **可以只同步聊天：** 项目文件默认同步，不需要时可在首次同步前关闭「同步工作区文件」。

## 功能

除了同步本身，插件还做了几件让「换电脑」真正省心的事：

- **会话自动归组**：每个会话属于哪个「工作区」会随同步一起走——换电脑后侧栏分组和原来一致，不会散落到「未分组」。
- **两种同步方式**：手动点侧栏「⟳ 同步」；或在设置 → 同步 → 同步偏好 开启自动同步（每 5 分钟一次、响应会话活动、退出 DSH 时自动提交推送）。
- **会话管理**：设置面板「归档会话」可查看全部会话（含已归档、幽灵），预览、取消归档、彻底删除。
- **冲突处理**：会话日志仅原样接续可确认的追加记录；同一会话发生分叉时保留当前一侧，双方原件保存在 Git 历史并显示恢复位置。设置按字段合并，普通文件冲突通常保留本机版本。
- **分组自动修复**：同步拉回的新会话会自动登记回对应工作区；若侧栏仍显示「未分组」，可手动重启 DSH 重建索引；自动重启默认关闭，仅适用于 Web 端，开启后仍依赖本机 Windows 重启脚本；桌面端需手动确认重启。`session.v4.jsonl.zstd` 日志识别及验证范围见[兼容验证记录](docs/release-0.12.12-validation.md)。
- **补丁托管（高级）**：把 node_modules 补丁放进 `.dsh/patches/` 随仓库同步，启动和每次同步后自动套用。

## 第一次使用

### 1. 安装并登录

先确保 DSH Web 已能正常使用，并已安装 [Git](https://git-scm.com/downloads/) 和 [GitHub CLI](https://cli.github.com/)。准备一个 GitHub 账号，以及能访问 GitHub 的网络。

在终端（Windows 可用 PowerShell）安装插件：

```sh
dsh plugin --profile web add @dpskk2/dsh-chatsync
```

然后登录 GitHub，按提示完成浏览器授权：

```sh
gh auth login --hostname github.com --git-protocol https --web
```

不熟悉安装或授权流程？查看[安装与登录详解](docs/getting-started.md#环境准备)。

### 2. 完成首次同步

重启 DSH，再刷新网页，打开 **设置 → 同步**：

1. 确认同步范围；只想同步聊天、附件和设置时，关闭「同步工作区文件」并保存偏好。
2. 保持默认连接设置，点击「立即同步」。插件会尝试创建或复用你账号下的 `dsh-sync` 私有仓库，无需手动建仓。
3. 等待上传成功，确认没有工作区同步失败。**如果只显示「本地快照」，数据还没有上传。**

已有指定仓库？按[手动连接说明](docs/getting-started.md#手动连接仓库)填写地址与分支，再同步。

### 3. 换到另一台电脑

先确认原电脑已同步成功。在新电脑安装同样的工具和插件，登录**同一个 GitHub 账号**，重启 DSH 后点击同步，默认会尝试复用同一仓库。

取回成功后，再重启 DSH，配置本机的模型 API 密钥，即可打开原来的会话继续使用。所需插件和项目依赖按需安装；自定义仓库需填写与原电脑相同的地址和分支。[换机与项目路径说明](docs/getting-started.md#第二台电脑)

## 日常使用

**开工前同步，收工后同步。** 在侧栏点击「⟳ 同步」，确认上传成功后再换电脑。

也可以在 **设置 → 同步 → 同步偏好** 开启自动同步并保存，默认每 5 分钟同步，也会响应会话活动。自动同步需要 DSH 保持运行且网络可用。

## 数据与隐私

专用凭据文件不会上传，但聊天、附件或项目文件中写入的密钥仍可能被同步。可用[排除规则](docs/sync-content.md)控制上传范围。同步会传播删除和修改，重要资料请另留备份。

## 更新与帮助

每个新版本都会在 [GitHub Releases](https://github.com/dpskk2/dsh-chatsync/releases) 提供中文更新说明和对应版本的完整源码 ZIP。需要下载源码时，打开版本页面，在 **Assets** 中选择 `dsh-chatsync-v版本号-source.zip`；安装和更新插件请使用下方命令及前面的安装步骤。

更新插件后重启 DSH：

```sh
dsh plugin --profile web update @dpskk2/dsh-chatsync
```

- 安装失败、找不到同步入口、上传失败或新电脑没有会话：查看[常见问题](docs/getting-started.md#常见问题)。
- 代理、自定义仓库和其他设置：查看[配置参考](docs/configuration.md)。
- 仍有问题：[提交反馈](https://github.com/dpskk2/dsh-chatsync/issues/new/choose)，附错误信息并隐藏私人内容和密钥。

支持 DSH `web` profile，声明要求 DSH ≥ `0.1.5-rc.3`、Node.js ≥20；建议 Node.js 24。已验证 DSH Web `0.2.0-rc.1`；实际测试范围见[验证记录](docs/release-0.12.12-validation.md)。

[更新记录](CHANGELOG.md) · [开发与验证](CONTRIBUTING.md)
