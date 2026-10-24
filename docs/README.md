# 文档入口

| 类别 | 入口 | 用途 |
| --- | --- | --- |
| 使用与配置 | [快速开始](getting-started.md)、[配置参考](configuration.md)、[同步内容](sync-content.md)、[文件说明](dsh-file-catalog.md)、[历史数据修复](data-repair-0.20.1.md)、[本地存储与备份](local-storage.md) | 当前使用说明，随安装包提供 |
| 版本验证 | [0.20.3 发布构建](release-0.20.3-validation.md)、[0.20.3 本地版](local-0.20.3-validation.md)、[0.20.2](release-0.20.2-validation.md)、[0.20.1](release-0.20.1-validation.md)、[0.20.0](release-0.20.0-validation.md) | README 和更新日志引用的实际验证范围；历史结果不代表新版已验收 |
| 开发维护 | 根目录 AGENTS.md、[贡献指南](https://github.com/dpskk2/dsh-chatsync/blob/main/CONTRIBUTING.md)、[目录说明](https://github.com/dpskk2/dsh-chatsync/blob/main/docs/project-layout.md)、[合并设计](https://github.com/dpskk2/dsh-chatsync/blob/main/docs/merge-engine-refactor.md) | 源码仓库提供，不装入运行包 |
| 发版安全 | [检查清单](https://github.com/dpskk2/dsh-chatsync/blob/main/docs/release-safety-checklist.md)、release-evidence/<版本>/ | 保留脱敏证据和发布决定，不装入运行包 |
| 界面与宿主专项记录 | 带日期的界面、启动、修复记录 | 仅保留在源码仓库，按各自日期与构建解读 |

已经完成的功能选择清单、旧消融实验、旧评审、投稿草稿和早期 0.12.x 验证记录已从当前源码移除，可通过 Git 历史追溯。维护用测试、宿主检查和演示脚本仍有用途，保留在源码仓库；文件长期未修改不表示无用。

安装包内容由 package.json 的 files 控制，运行 node scripts/check-package-contents.mjs 检查实际文件列表、运行入口和随包文档的相对链接。完整源码 ZIP 仍包含对应标签下全部受版本控制文件，方便复核和开发。
