# 0.21.3 执行计划

> 本文件是交给执行智能体的任务说明，不是更新日志，也不代表已经实现或验证。基线：`main` 的 `5508284`（0.21.2 已合并）。
> 执行时先读 `AGENTS.md`、`CONTRIBUTING.md`、`docs/release-safety-checklist.md`；本文件与它们冲突时，停下来向维护者说明，不静默选择。

## 0. 本版内容一览

| 编号 | 内容 | 来源 | 性质 |
| --- | --- | --- | --- |
| A | 「登录帮助」按仓库类型分成 3 个子标签，改用维护者给定的新文案 | 维护者指令 | 界面文案 |
| B1 | 修复：所有电脑升级到同一 DSH 版本后，设置仍一直提示「DSH 版本不同」而暂停 | 维护者报告，已复现 | 缺陷修复（同步路径） |
| B2 | 新增「清除版本记录」按钮：放弃旧版本记录、先备份再恢复设置同步 | 维护者指令 | 新功能（同步路径） |
| C | 自建 SSH 服务器作为同步仓库（实验性） | [#25](https://github.com/dpskk2/dsh-chatsync/issues/25) | 新功能（隐私不变量相关） |

建议提交顺序：A → B1 → B2 → C → 发布准备，每项单独提交（可多次提交），全部在新分支上完成后开一个 PR 到 `main`。**不要发布、不要打标签、不要发 npm**；发布由维护者另行授权。

## 1. 已确认的决定

维护者已确认 D1–D4 均按下表执行。

| 编号 | 问题 | 采用 |
| --- | --- | --- |
| D1 | B1 改变了 0.21.0 起「版本不同时双向暂停」的规则：改为**只有旧版暂停**，新版照常同步并接管版本记录。是否接受？ | 接受（理由见 B1） |
| D2 | B2 清除版本记录后，同步仓库中旧版本写下的设置怎么处理？(a) 按正常规则与本机设置合并；(b) 以本机为准覆盖远端 | (a) 合并。(b) 会把重置后电脑的空白默认设置推给其他电脑 |
| D3 | B2 的备份放在哪里（维护者说的「指定地址」）？ | 写入本机恢复记录（`.chatsync-local/recovery/`），在「找回同步前的内容」中按「清除版本记录前」分类列出，本机和远端两份都可取回；完成提示里给出数量 |
| D4 | A 的文案是否按维护者原文一字不改？ | 措辞不改；只按仓库现有风格补中英文之间的空格、统一全角标点，并修正原文中命令的反引号位置（见 A.3） |

## 2. A：登录帮助分为 3 个子标签

### A.1 现状

`src/client/51-connection-settings.js` 第 196–244 行的 `<details className="dss-tip">`「登录帮助」把「所有托管站都要安装 Git」「GitHub」「其他托管站」三段和三个链接一次性全部展开，篇幅长。

### A.2 改成

- `<details>` 外壳和 `summary`「登录帮助」保留，展开逻辑不变（`open: config ? !config.remote : false`）。
- 内部改为一组子标签，**一次只显示一个面板**：
  1. `GitHub 仓库`
  2. `Gitee、GitLab 等其他托管站`
  3. `自建服务器（实验性）`
- 默认选中：首次打开（尚未连接仓库）显示「GitHub 仓库」。已连接仓库后再展开登录帮助，按当前地址显示对应标签：GitHub → 1，自建服务器 → 3，其他 → 2。用户切换后在本次页面内保持，不写配置、不写 `localStorage`。
- 无障碍：`role="tablist"` / `role="tab"`（`<button type="button">`，`aria-selected`、`aria-controls`、`id`）/ `role="tabpanel"`（`aria-labelledby`）；左右方向键在标签间移动，未选中的标签 `tabIndex=-1`。
- 样式：沿用现有 `dss-pill` 外观或在同一样式表中新增 `dss-help-tabs`，窄屏不得横向溢出。先查 `dss-tip`、`dss-help-group` 的样式写在哪个文件里，放在同一处。
- 链接按标签分开：1 →「GitHub 登录说明」「代理与高级配置」；2 →「其他托管站说明」；3 →「自建服务器说明」（指向 C 新增的配置参考章节）。

### A.3 文案（按维护者原文）

**子标签 1：GitHub 仓库**（有序列表）

1. 安装 [Git](https://git-scm.com/downloads)
2. 安装 [GitHub CLI](https://cli.github.com/)
3. 打开“终端”（如需通过代理访问 GitHub，请确保已通过环境变量为 GitHub CLI（gh）配置可用代理，或已启用能够代理 GitHub 流量的 TUN 模式。），运行
   `gh auth login --hostname github.com --git-protocol https --web`
4. 根据指引完成授权（输入 Y，点击 Enter 打开授权页，输入“终端”显示的一次性代码）

**子标签 2：Gitee、GitLab 等其他托管站**

1. 安装 [Git](https://git-scm.com/downloads)
2. HTTPS 地址：打开“终端”，运行（换成你的仓库地址）
   `git ls-remote https://gitee.com/用户名/dsh-sync.git`
   按 Git 的提示输入该站的账号和密码或访问令牌。
   或 SSH 地址：为这台电脑生成 SSH 密钥，把公钥添加到托管站的「SSH 公钥」设置，再运行 git ls-remote 加仓库地址。

> 维护者原文写作 `` `git ls-remote `https://gitee.com/用户名/dsh-sync.git ``，反引号位置有误；按上面整条命令放进一个 `dss-command` 代码块。

**子标签 3：自建服务器（实验性）** —— 文案见 5.4。

命令仍用现有的 `e('code', { className: 'dss-command' }, …)`；链接仍用 `helpLink`。登录帮助的内容整体替换为以上文案，原有分组标题和说明不再保留。仓库地址输入框下方的说明不在本次范围，不要改。

### A.4 子标签 1 的授权过程示意图

维护者提供了一张实际授权过程的终端截图，要求放进登录帮助，帮助完全不熟悉 GitHub 的人完成授权。不直接放截图，改为用 HTML/CSS 画的示意图（参考稿：`release-evidence/0.21.3/github-login-diagram.html`，直接用浏览器打开即可看到效果）。原因：截图里有维护者的账号名；位图在深色主题和高分屏下效果差；截图只有终端部分，缺少新手最容易卡住的浏览器那一步。

- 位置：子标签 1 的第 4 步之后，标题「终端里会看到这些（蓝色是你要做的）」。
- 结构（编号圆标 + 原样的英文输出 + 中文说明）：
  1. 终端：`PS C:\Users\你> gh auth login …` —— 粘贴命令，按 Enter
  2. 灰显 `! Did you know that expiring tokens …` —— 提示信息，不用管（无编号）
  3. `? Authenticate Git with your GitHub credentials? (Y/n) Y` —— 输入 Y，按 Enter
  4. `! One-time code ABCD-1234 copied to clipboard` —— 一次性代码，已经自动复制好了
  5. `Press Enter to open https://github.com/login/device in your browser...` —— 再按一次 Enter，浏览器会打开授权页
  6. 浏览器卡片（地址栏 `github.com/login/device`，不仿制 GitHub 页面外观）：没登录 GitHub 时先登录，没有账号就点 Sign up 注册一个；在代码框里按 Ctrl + V 粘贴一次性代码，点 Continue；点 Authorize 确认授权，看到授权成功后回到终端
  7. 终端：`✓ Authentication complete.`、`✓ Logged in as 你的用户名` —— 看到这一行就完成了，回到这里点「立即同步」
- 编号连续为 1–8（参考稿中终端 1–4、浏览器 5–7、完成 8）。
- 示意图里的验证码用 `ABCD-1234`，用户名用「你的用户名」，不出现任何真实账号。
- 终端区域固定深色背景，浏览器卡片和文字颜色使用插件现有的 `--dsw-alias-*` 变量，深浅主题都要可读；窄屏（390px）下命令自动换行，不横向滚动。样式加到 `src/client/10-api.js` 的样式表中。
- 示意图整体 `role="img"` 并带中文 `aria-label`，浏览器步骤用列表。
- 开工前用最新版 GitHub CLI 实际跑一次 `gh auth login --hostname github.com --git-protocol https --web`，核对示意图里的英文输出和浏览器按钮名（Continue、Authorize）与实际一致；不一致以实际为准。

### A.5 测试与文档

- 改 `tests/preferences.test.mjs` 第 937–940 行附近对旧文案的断言；新增：
  - 首次打开（无地址）默认选中标签 1，只渲染标签 1 的面板；
  - 已连接 Gitee 地址时默认选中标签 2，自建服务器地址时选中标签 3；
  - 点击另一个标签后面板内容切换，`aria-selected` 随之变化；
  - 各标签的命令文本与 A.3 一致；
  - 子标签 1 渲染示意图，包含 8 个编号步骤，其他标签不渲染。
- `node scripts/build-client.mjs` 重新生成并一并提交 `lib/client.js`。
- 文档一致性（AGENTS.md「修改文案时中英文 README 与配置参考保持一致」）：
  - `README.md`「第一次设置 → ① 登录托管站」与 `README.en.md` 对应段：GitHub 一段加入代理 / TUN 提示和授权指引（输入 Y、Enter、一次性代码），其他托管站一段与新界面一致。
  - `docs/getting-started.md` 第 57 行同步修改。
  - `docs/configuration.md`「其他 Git 托管站」是参考文档：只把第 2 步的登录描述与界面对齐，其余内容不改。

## 3. B1：版本记录卡死，升级后设置仍不同步

### 3.1 根因（已用合成数据复现）

- `lib/scope.js` 第 66–81 行、第 933–962 行：同步仓库里的 `storages/sync-meta/settings-writer.json` 记录**最后一次写入设置的 DSH 版本**。本机版本与它不同就把本轮 `scope.settings` 设为 `false`。
- 只有 `exportToMirror`（第 584–591 行）在 `scope.settings` 为真时才改写这条记录。被暂停的电脑永远不会改写它。
- 结果：只要记录里的版本是旧版本，而用过旧版本的电脑**全部**升级（或被重置、退役），所有电脑都与记录不同、都暂停、都不会改写记录，设置同步永久卡死。`docs/sync-content.md` 第 13 行承诺的「把 DSH 更新到同一版本后自动恢复」不成立。
- 复现（执行智能体请把它写成正式测试）：A、B 都是 `0.2.1-rc.5` 并各同步一次 → 两台都改为 `0.2.2-rc.1` → A、B、A 依次同步：三轮都返回「两台电脑的 DSH 版本不同（本机 0.2.2-rc.1，另一台 0.2.1-rc.5）」，远端记录仍是 `0.2.1-rc.5`。现有 `tests/settings-version-gate.test.mjs` 只覆盖了「较新的一台先写、较旧的一台后升级」的方向，所以没有发现。
- 维护者遇到的情况是同一问题：电脑 2（rc.5）最后写入设置后被重置，重装后的 DSH 是 rc.1，与电脑 1 相同，但记录仍是 rc.5。

### 3.2 修改（D1）

保护的目的是「旧版 DSH 不能收到新版格式的设置，也不能覆盖它」。新版读取旧版写的设置正是 DSH 自身的升级路径，不需要暂停。因此：

- 新增版本比较（建议新文件 `lib/dsh-version.js`，或放在 `lib/scope.js` 内）：解析 `主.次.修订(-预发布)`，按 SemVer 优先级比较（预发布低于正式版；`rc.5` 与 `rc.10` 按数字比较）；任一方无法解析时返回 `null`。不要复用 `lib/updates.js` 的 `isNewerVersion`，它对预发布有意返回 `false`。
- `pauseSettingsFor` 的判定改为：
  - 记录为空或与本机相同 → 不暂停（同现在）；
  - **本机较新** → 不暂停；本轮导出时把记录改写为本机版本（`exportToMirror` 已有此逻辑，只要 `scope.settings` 为真就会写）；
  - **本机较旧**或**无法比较** → 暂停（同现在）。
- 注意 `scopedSync` 中 `pauseSettingsFor` 调用两次（导出前、取回后），两次都按新规则判定。取回后才发现远端记录变得比本机新时，本轮已导出的设置记录不能被推上去覆盖较新的记录：先确认现有流程在第二次判定暂停后不会推送本机设置；如果会，修正并加测试。
- 提示文案按方向区分（只在暂停的电脑上出现）：
  - 本机较旧：`同步仓库中的设置由较新的 DSH ${other} 写入，本机是 ${own}，本轮暂停同步设置；把这台电脑的 DSH 更新到 ${other} 或更新版本后自动恢复。会话和附件照常同步。`
  - 无法比较：沿用现有文案。
- 返回结果在字符串 `settingsPause` 之外新增结构化字段 `settingsPauseVersions: { own, other }`，经 `lib/http/summary.js` 的 `lastDetail` 透传（与 `settingsPause` 同样做类型过滤），供 B2 使用。

### 3.3 测试（`tests/settings-version-gate.test.mjs`）

- 原有两条测试保持通过（较旧一台暂停、升级后恢复；未知版本按原方式同步）。
- 新增：上面的复现场景，修复后第一轮同步即恢复设置，远端记录变为 `0.2.2-rc.1`。
- 新增：较新一台接管后，仍为旧版本的电脑同步时暂停，不取回、不覆盖远端设置（保护仍然有效）。
- 新增：无法解析的版本（如 `dev-build`）与记录不同时仍暂停。
- 版本比较的单元测试：`0.2.2-rc.1 > 0.2.1-rc.5`、`0.2.1 > 0.2.1-rc.5`、`0.2.1-rc.10 > 0.2.1-rc.9`、无法解析返回 `null`。

## 4. B2：「清除版本记录」按钮

用于 B1 之后仍会暂停的情况：本机较旧而较新的电脑已不再使用（重置、退役、DSH 回退），或版本无法比较。维护者原话：按下即允许旧数据丢失，丢弃该状态并备份。

### 4.1 界面

- 位置：同步状态中显示 `settingsPause` 的地方（`src/client/50-section-helpers.js` 第 56 行附近生成的详情；状态摘要在 `src/client/54-section.js` 第 121 行）。仅当 `lastDetail.settingsPauseVersions` 存在、且没有同步在进行时显示按钮「清除版本记录」。
- 点击后用 `window.confirm`（与 `52-recovery.js`、`53-data-health.js` 一致）确认：`清除 DSH {other} 的版本记录，由这台电脑接管设置同步？当前设置会先另存为恢复记录。`
- 确认后调用接口，成功后立即开始一次同步（与「立即同步」同一入口），完成后在同步详情显示：`已清除 DSH {other} 的设置版本记录，设置恢复同步；原设置另存为 {n} 份恢复记录。`

### 4.2 接口与行为

- 新增 `POST /dsh-sync/api/settings-version/reset`（放在 `lib/http/sync-routes.js` 或 `settings-routes.js`，沿用 `lib/http/guard.js` 的同源、JSON、请求体大小限制），请求体 `{ "expectedVersion": "<other>" }`。
- 拒绝条件（返回明确中文错误，什么都不改）：同步正在进行（使用现有同步锁）；没有配置仓库；本机传输副本的 `refs/remotes/origin/<branch>` 上的记录与 `expectedVersion` 不一致（页面已过期）；本机无法检测 DSH 版本。
- 执行：
  1. **备份**：对远端跟踪分支中每个 `contentKind(file) === 'settings'` 的文件，用 `RecoveryStore.save`（`lib/recovery.js` 第 92 行起）保存一份记录：`local` = 本机数据目录中的当前字节（不存在为 `null`），`remote` = 远端字节；元数据含 `kind: 'settings-version-reset'`、`file`、`otherVersion`、`ownVersion`、`remoteCommit`。在 `recoveryCategory`、`lib/recovery-presentation.js` 和恢复页中加入分类名「清除版本记录前」。任何一份写入失败就中止，不写第 2 步的标记。
  2. **写本机标记** `.chatsync-local/settings-version-reset.json`：`{ acknowledged: other, own, remoteCommit, at }`，用 `atomicJson`。**不直接改远端**，远端只通过正常同步改变。
  3. 返回 `{ ok: true, backups: n }`。
- 同步时（`lib/scope.js` 的 `pauseSettingsFor`）：读取标记，**仅当远端记录恰好等于 `acknowledged`** 时不暂停；本轮按正常设置合并规则（D2 默认 (a)）导出与取回，`exportToMirror` 将记录改写为本机版本。推送成功、远端记录已等于本机版本后删除标记，并在结果中加 `settingsVersionReset: { from, to, backups }`。远端记录变成第三个版本时标记失效：删除标记并照常暂停。
- 标记文件在 `.chatsync-local/` 下，不会上传；确认 `transportable` 已排除该目录。

### 4.3 数据安全核对（按 AGENTS.md 修改同步路径前自查）

- 不涉及会话日志与 seq；设置的取回仍走原有覆盖前写恢复记录、同步期间本机变化不覆盖的路径。
- 备份先于状态改变；备份失败不改任何状态。
- 不直接改写同步仓库，不改写 Git 历史。
- 新接口遵守同源 JSON 与体积限制，加入 `tests/request-and-import-safety.test.mjs` 现有的跨源 / 非 JSON 拒绝用例。

### 4.4 测试

- 记录为较新版本、本机较旧：清除 → 恢复记录数量等于远端设置文件数，两侧字节正确 → 下一轮同步不暂停、远端记录变为本机版本、标记被删除。
- `expectedVersion` 与远端记录不符被拒绝，无恢复记录、无标记。
- 同步进行中被拒绝。
- 标记针对版本 X，远端记录变为 Y 时仍暂停，标记被删除。
- 备份写入失败（模拟）时不写标记。
- 界面：只有 `settingsPauseVersions` 存在时出现按钮；取消确认不发请求。

### 4.5 文档

- `docs/sync-content.md` 第 13 行改写：较旧的一台暂停；升级后自动恢复；较新的电脑不再使用时可用「清除版本记录」，备份位置和后果。
- `README.md` / `README.en.md` / `docs/configuration.md` 若提到该行为，同步修改（先 `grep "版本不同"`、`"DSH version"`）。

## 5. C：自建 SSH 服务器（实验性）

### 5.1 现状（已读代码确认）

[#25](https://github.com/dpskk2/dsh-chatsync/issues/25) 希望用自家服务器上 `git init --bare` 建的空仓库，通过 SSH 同步。目前做不到：

- `lib/remote.js` 的地址解析：scp 形式禁止绝对路径（`user@host:/srv/git/dsh-sync.git` 不接受），且路径至少两级（`user@host:dsh-sync.git` 不接受）；`ssh://user@host:端口/srv/git/dsh-sync.git` 可以解析。
- `lib/engine/remote-repo.js` 的 `verifyPrivateRemote`：非 GitHub 地址一律用同一主机的 HTTPS 地址匿名读取（`probeUrl`）来判断私有；只开 SSH 的服务器连不上 HTTPS，按 `anonymousReadError` 判为「连接失败，无法确认私有」，**不会上传**。`docs/configuration.md`「已知边界」也写明了这一点。

### 5.2 设计

- 模式：只有在「自建服务器（实验性）」中保存的地址走此路径；在「使用其他仓库」普通输入框中填写的地址行为不变。
- 地址：只接受 SSH，新增形式：`user@host:/绝对/路径/repo.git`、`user@host:repo.git`、`user@host:相对/路径/repo.git`；`ssh://user@host[:端口]/路径/repo.git` 已支持。不接受 HTTPS、`~` 路径、凭据。解析结果 `provider: 'self-hosted'`，`webUrl: null`（同步页不显示「在…查看仓库」链接，`remoteWeb` 返回 `null`）。
- 从第三个标签保存的地址按自建服务器处理：在本机配置中记下该地址属于自建服务器（只存本机、不随设置上传；`dsh-sync.json` 属于同步的设置文件，先查 `lib/settings-projection.js` 中哪些字段保留本机值再决定放哪里），`verifyPrivateRemote` 对它不做匿名 HTTPS 读取，直接放行。地址被改成别的，这个标记随之失效。
- 连接检查：保存时用这台电脑的 SSH 登录运行一次 `git ls-remote <地址>`（复用 `lib/connection.js` 现有的非交互方式），空仓库没有任何分支属于正常；主机指纹未确认、密钥被拒、路径不存在分别给出原因。
- 首次推送到空的裸仓库：现有测试已用本地 `git init --bare` 作远端，确认 `autoRepo: false` 下首次推送可用；不需要特殊处理时不要改。
- 依赖 GitHub 的功能（自动建仓、「本机另存旧历史」向 GitHub 查询等）对自建服务器关闭，行为与其他托管站一致。
- `AGENTS.md`「只向已确认私有的远端上传」一句同步改为与实现一致（自建服务器地址不做私有检查）。

### 5.3 测试

- 解析：上述新形式在自建模式下接受、在普通模式下仍拒绝；HTTPS、`~`、含凭据、`..` 路径拒绝。
- `verifyPrivateRemote`：自建服务器地址不发起匿名读取直接通过；地址改动后标记失效、走原检查。
- 用本地裸仓库完成两台设备首次上传和取回。
- 界面：第三个子标签可保存地址；同步页不显示仓库网页链接。
- 真实 SSH 服务器上的验证无法在 CI 中进行：记录为「未验证」，除非维护者提供专用测试服务器。

### 5.4 子标签 3 文案（草案，维护者可改）

1. 安装 [Git](https://git-scm.com/downloads)
2. 在服务器上建空仓库：`git init --bare dsh-sync.git`
3. 为这台电脑生成 SSH 密钥（`ssh-keygen -t ed25519`），把公钥加入服务器的 `~/.ssh/authorized_keys`
4. 打开“终端”，运行 `git ls-remote 用户名@服务器地址:dsh-sync.git`，首次连接输入 `yes` 确认服务器指纹
5. 在下方填写地址并保存

### 5.5 文档

`docs/configuration.md` 新增「自建 SSH 服务器（实验性）」一节：地址形式、建仓与密钥步骤、首次连接确认主机指纹、不支持的功能。中英文 README 各加一句指向该节。

## 6. 发布准备（只准备，不发布）

- `package.json`：`version` 改为 `0.21.3`，`chatsyncBuild` 改为 `<冻结当天日期>-release-0.21.3`。
- `CHANGELOG.md` 新增 `## 0.21.3 · YYYY-MM-DD`，按 `CONTRIBUTING.md`「更新日志写法」面向用户书写。草稿：
  - **升级 DSH 后设置不再一直暂停同步。** 以前用过旧版 DSH 的电脑全部升级或重置后，设置仍一直提示「两台电脑的 DSH 版本不同」。现在较新的 DSH 照常同步设置并接管版本记录，只有仍是旧版的电脑暂停。
  - **可以清除不再使用的电脑留下的版本记录。** 同步状态提示 DSH 版本不同时，可点击「清除版本记录」由这台电脑接管设置同步；同步仓库和本机的设置先另存为恢复记录。
  - **登录帮助按仓库类型分开。** GitHub、其他托管站、自建服务器各一页，GitHub 页说明了代理和授权码的输入步骤。
  - **可以用自己的服务器存放同步数据（实验性）。** 在服务器上用 `git init --bare` 建空仓库，通过 SSH 地址同步。（[#25](https://github.com/dpskk2/dsh-chatsync/issues/25)）
  - **升级注意：** 较旧 DSH 的电脑在较新的电脑同步后会暂停设置同步，直到升级；清除版本记录后，旧版本电脑尚未合并的设置改动不再同步。
  - **验证：** 按实际完成情况填写，不得预填。
- 新增 `docs/release-0.21.3-validation.md` 与 `release-evidence/0.21.3/manifest.json` 等证据文件，格式参照 `release-evidence/0.21.2/`。
- 门禁（补丁版）：`full-regression`（独立 Node 与 Windows 桌面端内置运行时各一次）、`candidate-install`；B 涉及设置同步，参考检查做 `data-loss` 的 `automated`。最后运行 `node scripts/check-release-safety.mjs`。云端执行智能体做不了 Windows/Electron 回归和隔离宿主检查时，如实记为未完成，交维护者在本机完成，**不得记为通过**。

## 7. 完成标准

- 本地：开发中用 `npm run test:changed`，提交前一次完整 `npm test`（含界面生成一致性、ESLint、Prettier、tsc）通过；`npm run format` 已运行；`lib/client.js` 与 `src/client/` 一致。
- 推送分支，开 PR 到 `main`。PR 描述写清各项改动、B1 的根因、D1–D4 的实际采用值和尚未完成的验证。
- CI 四项（Ubuntu、macOS、Windows、Windows/Electron）全部通过后交维护者审阅；CI 失败先修复，不跳过测试。
- 不合并、不打标签、不发布、不改 npm。

## 8. 不在本版范围

- 登录帮助以外的连接设置文案。
- 设置格式的跨版本转换（ChatSync 不改写 DSH 的设置格式）。
- 按设备登记版本（每台电脑一条记录）的方案：能更精确地判断「旧电脑是否还在」，但改动面大，留待以后评估。
- 自建服务器的 HTTPS 地址、Git 守护进程协议、`~` 路径。
