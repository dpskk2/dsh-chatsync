# 0.20.1 发布审查与用户决定

日期：2026-10-23（Asia/Shanghai）。构建：`2026-10-23-release-0.20.1`。源码指纹、包哈希、实际运行文件清单见 candidate-audit.json；证据哈希与逐项状态见 manifest.json。

## 发布决定

用户直接指令：“我暂时不希望做这个事情，可以登记为物理双机验收未通过。你理论上检查没问题就先发版”。另已明确要求同时发布 GitHub Release 和 npm。本次根据该决定，在源码审查、自动回归和候选包检查没有未解决失败的前提下，允许带未验证场景发布。

**物理双机验收未通过（未执行）**。没有第二台物理设备的测试执行记录，没有将同机双副本、共享 OneDrive 源码或本地 Git 记作双机实网通过。其余未完整覆盖的真实宿主、故障注入和灾难恢复场景也保留 not-verified。接受限制不等于检查通过，不适用于别的源码或安装包。实际 failed 不受此决定豁免。

## 理论审查

以下是源码逻辑审查结论；通过表示本次审查没有找到确定的发布阻断问题，不是对任何环境零风险的证明。所列入口均从调用与状态变化复核，自动行为用对应 tests/ 文件核对独立断言。相关代码见本标签源码。

| 风险 | 入口、状态与失败路径 | 原件与恢复 | 自动证据范围 / 尚未证明的边界 |
| --- | --- | --- | --- |
| 静默丢失、覆盖和误删 | sync.js `_syncOnce` 先检查损坏配置、待核对修复、排队修复与未验收导入；scope.js 对导出哈希和导入前哈希再次核对；merge.js `mergeSessionLog` 只接受身份相同且逐条严格前缀；branch-history.js 物理表示不同才尝试官方解码后的逻辑前缀。host-grouping.js 只凭项目登记及同步转变证据诊断，删除工作区与正常未分组不补建；session-removals.js 只消费明确本机删除记录。handoff.js 拒绝给错误、延后、待应用和部分工作区失败发布完成回执。 | 活动原件在 home，传输副本独立；重叠和分叉经 RecoveryStore 保存双方至 `.chatsync-local/recovery`，独立分支通过官方接口导入。删除收据仅是本机保护，不声称旧客户端会理解新增语义。 | session-safety、session-transfer、session-merge、session-removals、host-grouping、host-sync、scope、two-device 行为回归。未完成全部旧客户端并发/三机语义验收。 |
| 损坏扩散 | merge.js 校验换行、压缩帧、逻辑序号和旧 packed 事件数；validateSessionTree 对固定提交批量检查完整对象后再合并；session-transfer.js 取得公开持久化写入权，先持久保存应用种子和日志，再 append/flush/readback；失败保留待应用状态，重试前核对来源哈希。session-safety.js 停机路径拒绝活宿主、未知身份与本地变化，写临时文件后再核对。 | session-repair.js / data-health.js 预览先保存校验后的原件；运行或来源变化则停止。失败保留日志和备份，已变更的有效内容不能被无条件回滚覆盖。 | issue4-stress（外部连续写入、多种种子、7173→7183 序号缺失）、session-repair/data-health、网络取消、推送拒绝等用例。完整断电、磁盘满、占用和每个持久化窗口未全部注入。 |
| 隐私越权 | privacy.js 枚举固定的待上传提交及尚未发送历史对象，扫描失败/对象不完整/过大均停止；会话压缩完整解码后检查。scope.js 同时限制导出、导入、忽略规则和本机设置投影，safePath 拒绝越界和链接；connection.js 保存地址前检查仓库私有及写权限，并在网络等待后重新检查当前地址和同步锁。 | privacy-copy.js 与 session-recovery.js 使用独立副本/身份，完整原件本机保留，不把删除当前文件视为删除远端历史。 | privacy、privacy-examples、privacy-copy、scope、private-remote、connection；最终候选源码、npm 包文件、公开证据仅扫描位置与原因，不输出凭据值。扫描不能识别全部秘密；未完成真实双机历史/联接/全网络组合。 |
| 升级与环境差异 | 新旧格式走统一校验和官方格式能力接口；未知格式/代际歧义拒绝猜测。config-file 与配置加载损坏时停止，不回退仓库。工作区路径经规范化和碰撞检查；后台启动与发送保护避免为同步自动关闭编辑器，正常退出与强退分开处理。发行门禁固定源码和包，默认严格；本次 ownerDecision 仅接受明确 not-verified 的场景，不能放过 failed、缺失检查、源码/包漂移、回归或包安装失败。 | 历史原件与迁移副本分开；当前包从 Git 原始内容生成，排除机器名副本、outputs、work、本机部署记录。完整源码 ZIP 对应发布标签。 | session-upgrade、config-migration、process-control、startup-control、scheduler、release-safety。独立 Node 和 Desktop 内置运行时终态分别保留；其他 Node/宿主/操作系统组合未全覆盖。 |
| 无法找回 | recovery.js `safePath`、`RecoveryStore.save/version` 与 `restoreFile` 保存双方及哈希，恢复前核对当前文件和预览哈希；branch-history 重复导入使用持久身份记录。data-health / session-repair 对来源、计划、备份和当前哈希核对；queued / applying / awaiting readback / verification 状态区分，待核对时 sync/exit 拒绝继续传播。 | 原件放在不参与传输的 `.chatsync-local`；恢复先备份当前内容，再写入和读回。没有可靠来源时不补造正文，活动宿主/新内容冲突时停止。 | recovery、session-recovery、recovery-guide、data-health、session-repair 与实际 Web 宿主修复子场景。未完整执行 R1–R5 的最终 Desktop 窗口人工恢复、所有中断窗口和坏远端再污染组合，因此 restore-drill 不记通过。 |

## 实际检查与证据文件

- standalone-result.json、standalone-suite.log、standalone-patch.log：独立 Node 完整回归、终态和补丁断言。完整回归开始后只调整了文档链接、发布流程的制品校验值路径，以及门禁对“已安装但未目视完整 Desktop 窗口”的未验证状态记录；运行代码、依赖、默认值和 tgz 字节不变。最终门禁单独在两个运行环境各补跑 13 项检查，见 policy-supplement 日志。
- desktop-result.json、desktop-suite.log、desktop-patch.log：Desktop 自带 Node/Electron 完整回归，实际运行时写入记录；它不等于真实宿主或窗口操作。
- candidate-audit.json：从 Git 原始内容生成的 tgz、实际安装的全部原始包文件哈希、运行文件哈希及敏感扫描。原始包文件全部一致；测试支架另加，不修改运行源码。个人部署记录、机器名副本与输出目录不入包。
- candidate-desktop.json：实际安装包加载于 DSH Desktop Host，合成数据 A→B→A、4 个会话、项目归属、附件哈希、重复重试及顺序重启读回。只有一台物理机，本地 Git，未打开 Electron 窗口。仅证明所列子场景，不能覆盖 native-runtime 或 candidate-install 的所有条件；candidate-install 同样保留 not-verified，并记录用户接受该未覆盖部分。
- candidate-repair.json：实际 Web 宿主对分叉、损坏尾部和归属修复、重复调用、原件保持、重启读回的子场景；合成数据，未涉及个人远端。不能替代完整灾难恢复演练。
- icon-geometry.json：独立按 SVG 端点重建圆心，半径 6、圆心与旋转中心 (8,8) 一致；6 种尺寸均正方形、不挤压、绕 viewBox 中心旋转。离线几何检查，不声称本轮日常 Desktop 窗口已更新或目视验收。

本轮早期 Desktop 回归的 21 个清理 hook 失败已修正：5 个测试使用现有受限 removeFixture 清除临时 Git 只读文件，未删安全断言。最终结果以本目录的最新终态为准；原始失败与修正前报告保留在本机 outputs，未把失败报告改为成功。

## 支持矩阵和未验证项

本机 Windows 11；独立 Node 24.19.0；Desktop Electron 44.7.0 / Node 24.21.0 / DSH 0.2.1-rc.2；修复子场景 Web DSH 0.2.0-rc.1。其余声明兼容组合只代表源码兼容设计，未在本轮穷举。真实 OneDrive 并发替换、物理双机 GitHub、中国大陆不同网络路径、全部生命周期和灾难恢复交互未全部验证。对这些缺口按用户决定发布并公开，不作全部验收通过声明。

## 制品与发布

工作流再次执行回归、按相同 Node/npm 和 Git 原始内容打包、核对 ownerDecision 与候选哈希，发布同一 tgz 至 npm，再创建 GitHub Release，附 tgz、标签完整源码 ZIP 和 SHA256SUMS。源码 ZIP 包括本目录脱敏证据。发布后核对 npm 实际下载字节、Release 标签/正文/附件及 ZIP 文件清单。
