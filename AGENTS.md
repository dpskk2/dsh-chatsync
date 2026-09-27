# 项目维护约定

- 本仓库的本地维护目录为 `C:\Users\tanos\OneDrive\Document\项目\chatsync`，后续源码修改、验证和发布准备均在此进行。
- 默认使用中文沟通，面向中国大陆、Windows 11 用户；需要用户执行代码或命令时按步骤说明。
- 每次发布新版本必须更新 `CHANGELOG.md`，以 `## 版本号 · YYYY-MM-DD` 为标题，用中文说明实际改动、必要的升级注意事项和验证情况，不得编造验证结果。
- `package.json`、Git 标签 `v版本号`、更新日志标题和 GitHub Release 版本必须一致。
- 每次发布必须将对应标签的完整受版本控制源码打包为 ZIP，作为 GitHub Release 附件上传，并将该版本更新日志写入 Release 正文；不能只发布 npm 包。
- 发布前遵循 `CONTRIBUTING.md` 的验证要求；发布后检查 npm、GitHub Release 正文和源码附件是否齐全。发布流程修改在推送到远端后才生效。
