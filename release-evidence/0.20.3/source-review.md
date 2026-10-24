# 0.20.3 发布候选源码复核

复核日期：2026-10-25。复核人：Codex。候选提交：51e4d118da6aae73f2654068db7c34539d57374c。

源码指纹：d3013ad0f1e9739097517d649baf1e5e68d9cde2abda8e00345408320a067f08。
构建：2026-10-25-release-0.20.3。作用域包 SHA-256：36e38e4f00e8b6bb0a2b9f4badb0b8c71a5ba9a7c2510bbc7cc9c5314e7e5ef2；短包：a38ef0ad34338ec2332ba7527075b68739fe88ad3bffc74d395df2338675554c。

本次从公开同步、清理与恢复入口追踪到隔离树、文件投影、会话写入、Git 提交/推送、完成记录及恢复。检查当版实现，未把旧报告当成本轮通过证据。下表描述源码条件及失败路径，不代表相应实机或故障场景已完成测试；实际执行层次由 manifest.json 和终态记录单独表示。

51e4d11 仅修正额外原生生命周期验收脚本：编辑阶段比较启动同步完成后的提交，同时确认新会话尚未进入远端；不改产品实现、自动回归用例或 npm 包内容。原脚本误将启动同步补齐 `.gitignore` 当成编辑时上传。初次失败保留并经不可变提交差异复核；修正后重新执行该宿主检查和最终源码的 CI，不把旧失败改成成功。两个 tgz 从相同字节重新核对并在本提交下重新进行真实候选包宿主检查。

## 静默丢失、覆盖或误删

| 场景 | 入口、条件与原件保护 |
| --- | --- |
| L1 首次使用与扫描失败 | `scope.js:scopedSync` 首次按远端指定分支建立隔离副本；远端探测、文件清单、配置、忽略规则读取失败立即停止。仅已登记的 previous/exported 路径参与本地删除判断，新空目录不直接推断远端删除；中断 clone 保留原副本。 |
| L2 双方新增与分叉 | `merge.js:mergeSessionLog` 要求相同头部和严格逐事件前缀，只选择现存完整一侧，不混排/重编号；`sync.js:captureConflicts` 与 `branch-history.js:chooseSessionHistory` 保存冲突原件及分支；Cordis 配置按有序程序整体保留一侧，避免数组并集改变执行含义。 |
| L3 用户意图 | `session-removals.js:removedSessionIds/withoutRemovedSessions` 仅使用明确删除登记，坏登记停止；`session-transfer.js:applySessionTransfer` 对远端会话删除返回 deferred。`scope.js` 保留远端删除的本机设置与项目登记并报告未应用；归档、恢复历史和物理删除分开。 |
| L4 并发写入 | `sync.js:syncOnce/acquireProcessLock` 串行化合作进程；会话通过真实 persistence 写入权重新读头与事件后追加，写前持久化完整 seed 与 journal。项目在隔离树合并；`project-sync.js:applyProjectFile` 核对初始哈希，保留原 inode，再以排他 link 安装；编辑器的新路径优先。 |
| L5 幂等及完成 | `retrySessionTransfers` 校验种子后先补完未完成应用；`scope.js` 不给 deferred 文件更新应用清单，退出只上传时核对未取回内容。`sync.js:syncOnce` 将项目错误、凭据检查失败、待预览、取消与 downloadPending 保留在终态；`handoff.js` 的完成条件不只依赖 push 返回值。 |

新清理入口为 `index.js` 的四个 local-storage 路由，执行链为 `local-storage.js:inventory → previewStorageCleanup → applyStorageCleanup`。扫描仅生成受识别项目的 ID；调用方不能传任意删除路径。当前仓库、项目共享 Git 历史、旧根仓库、未知备份、未上传/未提交内容、待处理/被引用原件受到保护。先校验整组选项与内容哈希，再逐项同卷改名、复核并删除。预览失效或依赖变化在首次删除前停止；部分删除失败报告实际逻辑字节和尚存材料位置。保留时间只筛选人工选择，不安排自动删除。

## 损坏扩散

| 场景 | 入口、条件与失败路径 |
| --- | --- |
| C1 残缺与未知输入 | `merge.js:validateSessionLog/decodeZstdFrames` 检查完整帧、末尾换行、逻辑事件连续性及历史打包行；`session-transfer.js:validateTransferSession/validateSessionTree` 使用官方 catalog 校验事件语义、身份及固定 Git 对象，失败不得进入活跃会话。未知能力停止，不猜测格式。 |
| C2 中断与重启 | `session-transfer.js` 在首次 append 前将完整种子与应用登记落盘；重试先续写并读回。`scope.js` 的普通文件应用前统一保存 recovery 原件；项目应用使用 prepared 记录及旁路 vault，`recoverProjectApplications` 在重新扫描删除前处理旧中断。整组设置写入不宣称具备断电事务，完整断电矩阵仍未验收。 |
| C3 存储故障 | `RecoveryStore.save/version` 写入并 flush 原件、记录哈希，错误向调用方抛出；备份不能完成时不进入后续替换。项目在移动原件前探测目标文件系统的排他安装能力；临时文件、备份校验和读回失败都停止并保留恢复材料。全部磁盘满/占用组合须另行实测。 |
| C4 网络与远端变化 | `verifyPrivateRemote` 验证目标；`runWithRetry` 对扫描后的不可变提交推送，网络重试不改用后来移动的分支；本机头变化报告未完成。取回校验绑定已取得的提交，拉取/认证错误不会回退到其他仓库。 |
| C5 修复保护 | `data-health.js:applyDataRepair/rollbackDataRepair` 及 `session-repair.js:repairSessionImport` 校验计划、身份、原件哈希、时效及关闭宿主条件；写入后再读回。导入修复保持 awaiting-host-readback；`hasPendingSessionImport` 阻止继续上传。无法可靠恢复的部分不能补造正文。 |

清理的 `dependencyFingerprint` 在等待 Git 前后核对配置、队列、验证与恢复引用；异常、不完整扫描、元数据损坏或目录链接不构成删除许可。Electron 使用物理文件接口处理归档和只读 Git 对象；逐项 unlink 不改变活跃硬链接的权限。不能据此宣称已测试所有外部恶意替换和存储故障。

## 隐私与范围

| 场景 | 入口、边界与停止条件 |
| --- | --- |
| P1 隐藏历史 | `privacy.js:scanOutgoing` 固定候选提交并枚举本轮未发布的可达对象，含后来删除的文件；按边界分批核对对象身份、长度及内容，不能只检查当前配置。 |
| P2 范围与链接 | `scope.js:walk/transportable/ignoredScopePaths` 在导出、预览与导入检查关闭项、忽略规则及曾跟踪文件；`safePath` 拒绝越界及每层符号链接。项目 `projectFiles/ignored` 保护嵌套仓库和备份 vault；恢复材料位于 `.chatsync-local` 或项目旁 vault，均不进入正常传输。 |
| P3 远端身份 | `connection.js:saveConnection` 验证 GitHub 私有属性及写权限，网络返回后再次核对 expectedRemote 并持锁写配置；`sync.js:verifyPrivateRemote/bootstrapRemote` 对未知可见性、认证/网络失败、损坏配置停止，不凭一次失败另建目标。 |
| P4 脱敏及历史 | `privacy-copy.js:redactedSessionSource` 从合法会话构造独立导入来源，不改写活动原件；再走敏感内容检查。`runWithRetry` 遇到扫描错误或超限同样阻断上传，不把删除当前文件当作清除历史；恢复导入用宿主新身份、读回和归属核对。 |
| P5 证据与制品 | npm 只选择明确的运行文件、使用文档和元数据，源码 ZIP 使用 Git 跟踪清单；个人安装备份、同步配置、会话及 outputs 均不得上传。公共证据只取隔离用例，公开前移除本机个人路径；不收录日常安装的原始配置和连接字段。 |

`settings-projection.js` 保留原有本机字段集合；普通同步偏好通过明确允许列表投影，连接、代理、身份及本机目录不随 dsh-sync.json 传输。Cordis 的合法 `!!js` 作为惰性标记文本往返，不在同步进程求值；未知标签、循环别名、无唯一身份的密钥列表失败关闭。接收方仍由 DSH 执行其设置程序，这是功能本身的范围，不能将字段过滤称为识别全部秘密。

## 升级与环境

| 场景 | 源码条件与范围 |
| --- | --- |
| U1 历史兼容 | `session-transfer.js` 区分历史 catalog 与当前恢复器；选择最高有效代际，拒绝同代歧义，历史行原字节不重编排。旧 `settings.yaml` 仍用既有安全投影规则；新 profile/global Cordis 位置单独处理。 |
| U2 混合与回滚 | `branch-history.js` 与传输种子保护分叉及待应用内容，不将旧前缀覆盖完整远端后缀；缺能力、未知格式及无法确认删除语义返回停止/待处理。全部跨版本轮转和降级组合不以源码推理代替实测。 |
| U3 Windows/OneDrive | 路径经 safePath、工作区规范化、NUL 分隔 Git 清单、跨卷旁路 vault 处理；拒绝联接并保存原件。测试位于隔离目录，维护源在 OneDrive 目录不等于真实 OneDrive 数据替换观察已经通过。 |
| U4 宿主/生命周期 | `resolveSyncConfig` 保留旧手动及明确选择，新配置开启生命周期自动化；`host-sync.js/startExitSync` 只在实际宿主启动后台退出进程，`exit-sync.mjs` 等待宿主退出，启动应用通过公开写入接口。托盘、强退、休眠/唤醒、全部网络恢复与真实窗口仍需专门验收。 |
| U5 发布一致 | 冻结维护源；两种 tgz 从 Git 原始字节打包，记录 Node/npm 和 SHA-256。短包只转换包身份的四个文件；实际候选包隔离宿主核对全部 45 个运行文件。中文 README 与主线一致，英文按本轮指令翻译；发布后仍需核对 npm 实际字节与对应标签源码 ZIP。 |

更新路径另检查 `updates.js:createUpdateChecker/updateCommand`：仅接受稳定精确版本，验证 npm 官方目标包身份和 tarball HEAD 后提醒，短包转换同时覆盖编码名称；缓存失败短期重试，命令固定版本与官方源，无全局关闭供应链保护。兼容范围只保留最低版本，实际能力缺失仍停止。

## 恢复与清理关系

| 场景 | 源码条件与原件位置 |
| --- | --- |
| R1 先备份 | `RecoveryStore.save` 将 local/remote 原件写入 `.chatsync-local/recovery/<id>`，记录字节和哈希后才返回；`scope.js` 先创建全部变更备份；项目 vault 保留被移动原 inode。失败不能授权继续危险写入。 |
| R2 真正恢复 | `recovery.js:restoreFile` 对预览哈希、版本哈希和写后读回核对，并备份恢复前文件；会话走 `session-recovery.js` 的宿主新会话导入与身份/归属/附件核对。真实灾难恢复端到端与窗口可达性仍未完整执行。 |
| R3 避免再污染 | 待导入/修复核对、未完成 seed、修复验证队列均阻断相应传播；清理识别同一批登记与引用，不删除这些恢复来源；元数据损坏保守保护。 |
| R4 中断撤销 | `session-repair.js` 保存 repair backup，计划/目标/导入身份变化立即停止，回滚只针对仍匹配的内容；已宿主验证的导入不能回滚为部分日志。项目中断恢复不覆盖编辑器后来建立的新路径，保留 warning 要求核对。 |
| R5 用户操作 | `client.js` 独立恢复/处理页面显示原件、比对、方案及待核对；新清理面板显示用途、保护原因、选择项、永久删除警告和双重确认，失败显示残留路径与实际移除量。React 夹具与公开 API 只能证明相应逻辑，完整 Desktop 窗口恢复操作保留未验证。 |

复核结论：本轮审查范围未发现需要先修复的源码阻断问题；不作穷尽缺陷不存在的承诺。源码审查、自动回归、故障注入、真实宿主窗口、物理双机分别记录。未完成的故障/宿主/恢复/物理场景仍阻断默认发布；本文件不提供发布例外，也不沿用历史 ownerDecision。

## 最终制品绑定复核

最终源码提交 f55e271adeecaac805c920a721e5b3377d97021d；指纹 fb6f2b3db1d6ed4941eeb90d7c31dcd698ebf812423d6bac028665dedc4887d9。完整通过的 CI 源码为 51e4d118da6aae73f2654068db7c34539d57374c，之后仅有 AGENTS.md、README.en.md、README.md 变化，全部运行代码、测试、依赖与检查脚本字节保持一致。最终两种包的 45 个运行文件分别与真实宿主已验证候选逐字节等价，最新哈希以 manifest.json 和 package-audit.json 为准。源代码审查与此前宿主原始报告中的旧候选指纹保留，不能将其原包哈希改写成最终说明更新后的包哈希。
