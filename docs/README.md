# 文档入口

| 类别 | 入口 | 如何使用 |
| --- | --- | --- |
| 当前项目维护 | 根目录 `AGENTS.md`、`CONTRIBUTING.md`、[目录说明](project-layout.md)、根目录“当前版本说明.md” | 当前任务先看；用户当前指令优先 |
| 使用与配置 | [快速开始](getting-started.md)、[配置参考](configuration.md)、[同步内容](sync-content.md)、[文件说明](dsh-file-catalog.md) | 结合当前实现核对，不从旧评审恢复已移除的交互 |
| 发版安全 | [检查清单](release-safety-checklist.md)、`release-evidence/<版本>/manifest.json` | 当版每项取证；历史报告不能自动算通过 |
| 历史设计选择 | `0.20.1-change-selection.md`、`0.20.1-recommended-scope.md`、`product-review.md`、`optimization-review.md`、`review-0.12.14.md` | 当时的选择/评审，不能要求用户重新做已完成的选择 |
| 历史验收与本机修订 | `release-*-validation.md`、带日期的界面/修复记录、根目录 `ABLATION.md` | 只证明各自日期和构建；保留原有引用 |
| 完整历史源码与中间产物 | 本机 `outputs/archive/` | 本机恢复材料；不属于 npm 或 GitHub 发行附件 |

对版本、实际安装、源码与证据的判断冲突时，保留原件并核对实际构建/文件哈希；不以目录名中的 `final`、同为 `0.20.1` 或文件日期较新作为通过证明。
