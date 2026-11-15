# 0.21.3 候选版验证

## DSH 0.2.2-rc.3

本版接入原生导入使用的会话构造校验、写入后列表缓存刷新和项目复核。本地裸 Git 仓库上的两个隔离 Web 宿主各在重启后读回 20 条合成会话，取回的会话在重启前可读且具备列表缓存。隔离 Windows 桌面宿主验证了冲突另存、同一身份重试、项目归属和重启后附件读回。以上是源码阶段的宿主检查。[原生导入实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/experimental/deepseek-chat-import/src/importer.ts)

待发布安装包和完整回归证据在正式版本提交的 `release-evidence/0.21.3/` 中记录。源码阶段使用一台电脑，物理双机及报告者原环境尚未验证。会话列表缓存验证不涵盖桌面窗口免重启显示分组。

## DSH 0.2.2-rc.2

对比官方 `dsh-v0.2.2-rc.1` 和 `dsh-v0.2.2-rc.2` 源码：公开会话持久化入口和 `SessionHandle` 的源码一致。ChatSync 继续通过写入句柄追加、刷新并读回。插件导航仍公开 `pluginNavigation.openBundle(packageName)`，更新提醒按实际能力显示入口。最低 DSH 版本仍是 `0.2.0-rc.1`。

rc.2 的工作目录服务新增访问协调和错误分类，既有会话的原目录不可用时仍会拒绝打开。公开服务没有提供按项目注册跨设备路径的接口，原会话跨目录直接续聊仍由 [#10](https://github.com/dpskk2/dsh-chatsync/issues/10) 跟踪。

- [会话持久化](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.2/packages/session/session-persistence)
- [插件页导航](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.2/packages/client/ui-plugin-manager/src/client/index.ts)
- [工作目录服务](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.2/packages/session/working-directory/src/index.ts)

## 专项检查

- Windows 使用合成数据与本地裸 Git 仓库验证版本先后、所有电脑升级后的接管、远端先更新的竞态、备份失败，以及同版本远端在备份后有新提交的保护。
- 界面自动检查覆盖 GitHub 和其他托管站的登录帮助、取消清除及确认后发起同步。更新入口自动检查覆盖宿主能力与两个 npm 包名。
- 2026-11-15 的离线预览核对了设置页直接展示项目目录、两项目取回和会话列表变化、仓库登录帮助及冲突备份操作。该预览使用示例数据。

## 维护者验收

检查更新提醒在支持更新和缺少插件页能力的宿主上的入口、登录帮助两组标签和授权步骤，以及清除设置版本记录时的确认、备份和结果提示。网页示意用于核对文字和点击流程。实际宿主、物理双机及安装包的验证结果随候选检查记录更新。
