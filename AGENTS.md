# 项目维护约定

chatsync 是 DeepSeek Harness（DSH）插件：通过用户自己的 GitHub 私有仓库同步会话、附件、设置和项目文件。默认使用中文沟通，面向中国大陆、Windows 11 用户；需要用户执行命令时按步骤说明。

- 用户当次的明确指令优先于本文件和历史文档。历史报告、旧任务里的“本轮”“本次”、待选功能清单和旧记忆只用于追溯，不是永久禁令，也不扩大操作授权。遇到冲突时指出来源与影响，不静默采用旧约定。
- 如果根目录存在 `AGENTS.local.md`（不入库），一并阅读；其中是本机维护目录、归档位置等私有约定。

## 开发与验证

- Node.js ≥ 24，原生 ESM，运行时没有 npm 依赖；不得新增运行时依赖（`lib/vendor/` 内置的库须附许可证）。
- 安装验证依赖并测试：`npm ci --ignore-scripts`，然后 `npm test`（含界面生成一致性、ESLint、Prettier 格式与 tsc 类型检查，也可单独运行 `npm run lint`、`npm run format:check`、`npm run typecheck`；提交前用 `npm run format` 统一格式）。类型写在 JSDoc 里，按 `tsconfig.json` 的非严格模式检查；ESLint、Prettier、TypeScript 等工具只作为开发依赖，不进入安装包。调整 `package.json` 的 `files` 后运行 `node scripts/check-package-contents.mjs`。
- 浏览器端界面的源码在 `src/client/`：`00-loader-head.js` 与 `99-loader-tail.js` 是模块加载器外壳，其余文件是工厂函数内的语句，顶格书写、按文件名顺序拼接；修改后运行 `node scripts/build-client.mjs` 重新生成并一并提交 `lib/client.js`，不要直接改 `lib/client.js`。`npm test` 会检查二者一致。
- 测试只使用临时目录、合成数据和本地裸仓库，不读写真实的 `~/.dsh`，也不访问个人同步仓库；需要远端时显式设置 `autoRepo: false`。
- 自动测试、故障模拟、隔离宿主检查和物理双机验收不能互相替代；中断、跳过或缺少最终结果的运行不算通过，不得编造验证结果。
- `scripts/` 中各脚本的用途和运行条件见 `docs/scripts.md`。

## 数据安全不变量

修改 `lib/merge.js`、`lib/scope.js`、`lib/session-*.js`、`lib/sync.js` 的同步或写入路径前，必须先确认这些规则不被破坏：

- 会话日志只能追加：不得重排、交错或重新编号 seq；无法严格接续时双方原件都保留，交给用户处理。
- 宿主运行时，会话只能通过宿主公开的 `sessionPersistence` 写入租约追加，写后读回比对；Git 的 checkout、merge、reset 只能作用于独立传输副本，不能触碰正在使用的 `~/.dsh`。
- 导出、取回、应用三个阶段都要通过 `validateSessionLog` 和官方会话格式校验；校验失败时停止该轮并保留原件。
- 覆盖本机文件前，先把原件写入恢复记录；同步期间本机文件发生变化时，不覆盖。
- 只向已确认私有的远端上传；凭据、代理、本机路径和 `.chatsync-local/` 永不上传。
- 本地 HTTP 接口只接受同源的 JSON 请求，并限制请求体大小。

## 兼容性

- 只声明最低 DSH 版本，不设置最高版本或逐版白名单；已验证版本单独记录，不当作上限。宿主接口缺失或数据校验失败时，必须停止对应操作，不能用开放的版本范围代替功能验证。
- 更新提醒生成的命令必须写明所提示的版本、使用 npm 官方源，并先确认对应安装包可以下载；不得只给可能被发布等待期静默跳过的裸 `update`，也不得全局关闭供应链保护。短包名和旧作用域包要分别验证。

## 发布

- `package.json` 版本、Git 标签 `v版本号`、`CHANGELOG.md` 标题和 GitHub Release 版本必须一致。
- 每次发布都要更新 `CHANGELOG.md`，标题为 `## 版本号 · YYYY-MM-DD`，按 `CONTRIBUTING.md`「更新日志写法」面向用户书写；升级注意和验证边界必须保留，内部过程（如 README 处理方式、脚本名）不写进日志。
- 每次发布都要把对应标签的完整受版本控制源码打包为 ZIP 上传到 GitHub Release，Release 正文使用该版本的更新日志；不能只发布 npm。
- 定版、打标签或对外发布前，按版本级别完成 `docs/release-safety-checklist.md` 的必过项（补丁版：完整回归含 Windows/Electron、候选包隔离宿主检查；次版本再加物理双机验收，维护者确认即可），并通过 `scripts/check-release-safety.mjs`。参考检查按改动风险选做，记录为失败的仍会阻断。缺失、失败、跳过、中断、待确认，或源码、安装包发生变化，都会阻断发布；历史报告不能自动沿用为本版通过。未完成的验收项只能通过绑定哈希的 `ownerDecision` 保持 not-verified 并公开说明。
- 安全验收只使用隔离数据和专用测试仓库，不对个人原件注入故障；没有两台物理设备和 GitHub 实网证据时，不得把本地双副本模拟记为双机验收通过。
- 发布目标以维护者当次授权为准：“发到 GitHub”不自动包含 npm 发布、市场发布、修改远端旧标签或更新日常安装。发布流程的修改要推送到远端后才生效。

## 文档

- 公开文档只引用仓库中存在的文件，不写本机绝对路径、个人目录或本机专用的 `outputs/` 子目录。
- 一次性任务指令和发布决定写进对应版本的 `release-evidence/<版本>/`，不写进本文件或 `CONTRIBUTING.md`。
- `docs/` 根目录只放当前有效的使用与维护说明；带日期的开发过程记录放在 `docs/history/`。
- 修改文案或默认值时，中文 README、英文 README 和配置参考要与实际默认值保持一致。
