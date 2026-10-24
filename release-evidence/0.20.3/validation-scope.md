# 0.20.3 验证范围与未完成项

源码指纹、构建、两个 tgz 哈希见 manifest.json；本记录只适用于该候选。原始本机材料保存在本轮 outputs/release-0.20.3-20261025/，公共材料不包含日常同步配置、个人会话、连接凭据或安装前私密备份。

## 自动检查如何对应五类风险

| 风险 | 独立预期及行为断言 | 相关用例 |
| --- | --- | --- |
| 数据丢失 | 独立事件序列/原件字节、分叉双方保留、A/B 文件往返、并发写入后缀不丢失、未完成时不出回执；清理只删除预览的已完成副本，活动附件/硬链接原件字节及权限不变。 | two-device、session-merge、session-transfer、session-removals、issue4-stress、host-sync、handoff、local-storage |
| 损坏扩散 | 官方 catalog 校验逻辑事件；缺序、乱序、半帧、未知事件、扫描异常停止；失败部分追加保留种子并重试，修复前后哈希和状态核对。 | issue4-stress、session-safety、session-transfer、data-health、compatibility-repair、session-repair、audit-regressions |
| 隐私 | 合成标记覆盖当前及已删除的未发布 Git 历史；分批枚举与读取错误阻断；关闭范围、已跟踪忽略项、链接、错误/公开远端、脱敏副本与本机连接字段逐项断言。 | privacy、privacy-copy、scope、private-remote、connection、dsh-rc3-settings、local-storage |
| 升级/环境 | 历史会话格式与配置、最高代际选择、旧手动和明确自动开关、Cordis 标签/别名和稳定身份、更新包身份/可下载性及固定版本命令；Node 与 Electron 分开记录。 | session-upgrade、config-migration、preferences、scheduler、process-control、dsh-rc3-settings、updates、issue6-workspace |
| 恢复 | 原件哈希、备份后恢复及撤销、过期预览/坏备份拒绝、修复中断与宿主待核对保护；备份清理不能移除未完成/被引用原件。 | recovery、session-recovery、recovery-guide、session-repair、data-health、project-preservation、local-storage |

自动化用例用隔离目录、合成内容和本地 Git 远端，不连接个人同步仓库。源码中的合成示例和校验器正负样本不包含真实令牌。通过项目级自动检查不等于清单内每个故障、每个宿主或每个生命周期组合均已实测。

## 实际候选包已执行的部分

`candidate-scoped.json` 与 `candidate-short.json` 分别记录宿主检查时两个 tgz 的 SHA-256、45 个运行文件哈希、固定源码提交及实际 DSH 0.2.1-rc.3 / Electron 44.7.0 / Node 24.21.0 环境。两种包均从实际解包内容装入隔离 profile，通过真实 Desktop Host IPC 加载，未使用个人 profile。

实际执行：合法 Cordis 动态配置被宿主接受；全新配置自动开关开启但没有自行建立远端；公开清理接口拒绝未确认请求、要求旧仓库单独确认、删除指定合成 Git 副本与配置备份、保留原附件；原裸仓库 fsck 通过；重启后版本和保存的保留时间读回一致。

这是真实 Host 与公开接口证据，但没有打开真实 Desktop 窗口。因此 candidate-install 及五类 native-runtime 的完整要求仍标为 not-verified，不能把成功加载或 API 检查扩写成窗口验收。

## 必须继续保留 not-verified 的 13 项

| 检查 | 已有部分证据 | 未完成范围 |
| --- | --- | --- |
| data-loss/fault-injection | 并发编辑/追加、取消、种子重试、清理前变化与坏登记的隔离断言 | 五类风险对应全部注入点、终止/恢复时间线及真实存储失败矩阵 |
| corruption-spread/fault-injection | 残缺输入、扫描失败、异常命令和部分应用检查 | 全部快照/替换/提交/推送断电点，磁盘满、占用、响应丢失组合 |
| privacy/fault-injection | 合成凭据、扫描异常、远端身份错误、越界及联接 | 专用实网测试远端全部本轮可达提交与完整故障时间线核对 |
| upgrade-environments/fault-injection | 旧配置/格式、Windows 路径和隔离故障 | 完整混合版本、回滚、真实 OneDrive 替换观察和休眠/断网矩阵 |
| recovery/fault-injection | 坏备份、过期计划、应用/回滚异常与引用保护 | 每个恢复阶段强退/取消/撤销，恢复后面对坏远端与旧客户端的完整矩阵 |
| data-loss/native-runtime | 最终包真实 Host 清理及原件保留、冷启动 | L1–L5 的完整实际宿主及真实窗口场景 |
| corruption-spread/native-runtime | 最终包真实 Host 正常加载/读回 | C1–C5 的完整宿主故障、重启核对及确认放行 |
| privacy/native-runtime | 最终包与公开证据内容核对、设置表达式宿主加载 | P1–P5 的完整宿主脱敏/范围检查及真实窗口操作 |
| upgrade-environments/native-runtime | 实装 Desktop Host 环境及冷启动、运行文件哈希 | 全部声明支持环境、Web/Desktop 与生命周期/OneDrive 组合 |
| recovery/native-runtime | 最终包清理保护与持久化读回 | R1–R5 的完整真实宿主恢复和用户操作记录 |
| candidate-install | 实际最终 tgz 安装/加载、公开接口、重启及逐文件核对 | 实际 Desktop 窗口检查与全部安装验收步骤 |
| restore-drill | 自动恢复、回滚、坏备份与中断用例 | 新目录中端到端灾难恢复、正文/事件/附件/身份/归属、用户核对放行及窗口记录 |
| physical-two-device-github | 没有本版物理双机证据 | 两台物理设备、专用私有 GitHub 仓库、大陆真实网络、离线分叉/连续写入/断网重试/重启恢复全流程 |

物理设备只有一台，不把同机双副本或两个隔离 Host 命名为物理双机。不能由旧版 ownerDecision、发布目标确认或自动检查成功推导为本版这些项目已通过；没有本轮明确例外决定时，默认发布门禁继续阻断。实际 failed、损坏证据、缺失检查或候选哈希变化也不得以例外放行。

最终 README 对齐后，发布包的运行文件与宿主已验证候选的全部 45 个运行文件相同，最终包的说明、文件清单与源码字节重新核对，见 package-audit.json。没有把旧包的实际加载记录改称新说明包的加载记录。用户已明确允许本版有限验证发布；13 项完整场景仍为 not-verified。
