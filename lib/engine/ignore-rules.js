// Part of the SyncEngine (lib/sync.js); moved verbatim from lib/sync.js.

/**
 * 内置 .gitignore:只排除「每台机器各自的状态 / 可再生依赖 / 密钥」,其余全部同步。
 *
 * 设计取向(v0.11 起):本插件是「个人私有仓库」同步工具,settings.yaml
 * (字号/模型/默认模型/第三方 provider 配置/权限默认)随仓库同步,换电脑后
 * 设置直接带过去;但 .credentials.yaml(API 密钥 / 浏览器授权 secret)是机器
 * 本地机密,不同步 —— 跨机密钥走 apiKeyEnv 环境变量。settings.yaml 冲突时
 * 自动取本机(见 merge 流程),避免拉取覆盖本机设置。
 * 仓库是私有的,钥匙只在你手里;若你确实不想同步某个文件,在 ~/.dsh/.gitignore
 * 里加一行即可(手工改动会被保留)。
 */
export const BUILTIN_IGNORE = [
  '# ===== dsh-chatsync 自动生成(手工改动会被保留;删除本文件后下次同步重新生成)=====',
  '',
  '# 机器本地状态 —— 不同步(窗口大小 / 用量统计 / 匿名 ID,每台机器各自的值)',
  '.anonymous-user-id',
  '.dshw-size.json',
  '.dshw-usage.json',
  '',
  '# 可再生状态 —— 每台机器每次运行都重写(缓存/诊断日志/插件市场状态),不同步,避免每次合并必冲突',
  'cache/',
  'logs/',
  '/electron/', // Desktop runtime is installed separately on each machine.
  'profiles/web/.dsh-market/',
  'profiles/desktop/.dsh-market/',
  'profiles/desktop/.plugin-manager/',
  '**/*.log',
  '',
  '# 密钥 —— 不同步(API 密钥 / 浏览器授权 secret 是机器本地机密;跨机密钥走 apiKeyEnv 环境变量)',
  '.credentials.yaml',
  '',
  '# 会话投影缓存目录会同步(含会话标题 / cwd —— 用于跨机还原「工作区↔会话」对应关系);',
  '# 仅排除单个同级文件(不存在则无影响),目录本身保留,避免第二台电脑丢失会话归属信息',
  'storages/session_projcache.json',
  '',
  '# 依赖目录 / pnpm 存储 —— 不同步(新电脑需在使用的 profile 重新安装插件)',
  '**/node_modules/',
  '.pnpm-store/',
  '',
  '# 同步引擎自身状态',
  '.dsh-sync.state.json',
  '.dsh-sync.process.lock',
  '.chatsync-local/',
  '',
  '# 工作区路径覆盖(「换位置」的本机专属设置:机器 A 的覆盖不能决定机器 B 的工作区位置)',
  'storages/workspace-local-paths.json',
  '',
  '# 工作区影子仓库(各工作区独立的 git 仓库,不与主仓库混同)',
  'workspace-repos/',
].join('\n');
/**
 * 需要确保出现在 .gitignore 里的条目(密钥排除 + 依赖存储排除 + 本机专属路径覆盖);
 * 对已存在的 .gitignore 由 ensureRepo 补写,对旧版本被移除的条目自动恢复。
 */
export const BUILTIN_IGNORE_ENSURE = [
  '.credentials.yaml',
  '.pnpm-store/',
  '.dsh-sync.process.lock',
  '.dsh-sync-*',
  '.chatsync-local/',
  'storages/workspace-local-paths.json',
  'cache/',
  'logs/',
  '/electron/',
  'profiles/web/.dsh-market/',
  'profiles/desktop/.dsh-market/',
  'profiles/desktop/.plugin-manager/',
  '**/*.log',
];
