// Part of the SyncEngine (lib/sync.js); moved verbatim from lib/sync.js.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseSyncRemote } from '../remote.js';
import { AUTOMATIC_SYNC_REASONS } from './config.js';
import { humanSize, parseBytes, ts } from './format.js';
import { BUILTIN_IGNORE, BUILTIN_IGNORE_ENSURE } from './ignore-rules.js';

export const remoteRepoMethods = {
  /** 主仓库对象统计一次(loose 对象数/体积 + pack 体积);失败返回 null。
   *  仓库体积展示与 gc 策略共用,避免同一次同步起两次 git count-objects。 */
  repoStats() {
    try {
      const r = spawnSync('git', ['count-objects', '-vH'], {
        cwd: this.home,
        windowsHide: true,
        encoding: 'utf8',
        timeout: 15000,
      });
      const out = r.stdout || '';
      const looseCount = Number((/^count:\s*(\d+)/m.exec(out) || [])[1] ?? 0);
      const sizeM = /^size:\s*([\d.]+)\s*(\S+)/m.exec(out);
      const packM = /size-pack:\s*([\d.]+)\s*(\S+)/.exec(out);
      const looseBytes = sizeM ? parseBytes(sizeM[1], sizeM[2]) : 0;
      return {
        looseCount,
        looseBytes,
        packBytes: packM ? parseBytes(packM[1], packM[2]) : null,
      };
    } catch {
      return null;
    }
  },

  /** 主仓库 pack 体积(字节);失败返回 null */
  repoSizeBytes() {
    const s = this.repoStats();
    return s ? s.packBytes : null;
  },

  /** Remote writes are allowed only after the provider confirms private visibility. */
  async verifyPrivateRemote(remote) {
    const parsed = parseSyncRemote(remote);
    if (!parsed) return { error: '仅支持不含凭据的 GitHub 仓库地址（HTTPS 或 SSH）；请检查 remote。' };
    const result = await this.gh(['repo', 'view', parsed.fullName, '--json', 'visibility']);
    if (!this.ok(result)) return { error: this.githubRequestError(result) };
    try {
      const visibility = JSON.parse(result.out).visibility;
      if (visibility === 'PRIVATE') return { ok: true };
      if (visibility === 'PUBLIC' || visibility === 'INTERNAL')
        return { error: 'GitHub 仓库不是私有仓库。请改用私有仓库；本次不会上传。' };
    } catch {
      /* invalid response must fail closed */
    }
    return { error: 'GitHub 返回的仓库信息异常。请稍后重试；本次不会上传。' };
  },

  /**
   * 首次同步(remote 为空)时的自动引导:用 gh 判定账号、按 repoName 查找/创建
   * 私有仓库,把 remote 写回配置并返回 URL。失败时返回 null,原因记在 _bootstrapError。
   * 取不到 GitHub 账号时:手动同步报出原因;启动/退出等自动同步只保存本地快照,
   * 原因记在 remoteNotice() 供状态显示。60 秒内只尝试一次,期间重复上次的原因。
   * @param {any} cfg
   * @param {{ reason?: string, automatic?: boolean }} [options]
   */
  async bootstrapRemote(cfg, { reason, automatic = AUTOMATIC_SYNC_REASONS.has(reason) } = {}) {
    if (this.loadConfig().configError) throw new Error(this.loadConfig().configError);
    if (cfg.autoRepo === false) return null;
    if (this._bootstrapAt && Date.now() - this._bootstrapAt < 60000) {
      if (this._bootstrapNotice) this._bootstrapError = automatic ? null : this._bootstrapNotice;
      return null;
    }
    this._bootstrapError = null;
    this._bootstrapAt = Date.now();
    const owner = cfg.repoOwner || (await this.ghLogin());
    if (!owner) {
      const failure = this._ghLoginFailure
        ? this.githubRequestError(this._ghLoginFailure)
        : '无法取得当前 GitHub 账号。请先执行 gh auth login，或在设置中填写已有仓库地址；本次不会上传。';
      this._bootstrapNotice = failure;
      if (!automatic) this._bootstrapError = failure;
      this.log(
        'warn',
        `未配置 remote 且无法通过 gh 取到 GitHub 账号${automatic ? ' —— 本次仅本地快照' : ''}：${failure}`,
      );
      return null;
    }
    const repo = cfg.repoName || 'dsh-sync';
    const remote = `https://github.com/${owner}/${repo}.git`;
    const view = await this.gh(['repo', 'view', `${owner}/${repo}`, '--json', 'visibility']);
    if (this.ok(view)) {
      // 已存在:必须确认私有后才复用
      try {
        const parsed = JSON.parse(view.out.trim());
        if (parsed.visibility !== 'PRIVATE') {
          this._bootstrapError = `${owner}/${repo} 不是已确认的私有仓库；请改用私有仓库。本次不会上传。`;
          this.log('error', this._bootstrapError);
          return null;
        }
      } catch {
        this._bootstrapError = `无法确认 ${owner}/${repo} 的私有状态；本次不会上传。`;
        this.log('error', this._bootstrapError);
        return null;
      }
      this.log('info', `已复用远端仓库 ${owner}/${repo} → ${remote}`);
    } else {
      // Only a missing/inaccessible repository can lead to creation; network failures must not.
      if (
        !/HTTP 404|could not resolve to a repository|not found/i.test(`${view.err || ''}\n${view.out || ''}`) ||
        view.timedOut ||
        view.code === -1
      ) {
        this._bootstrapError = this.githubRequestError(view);
        this.log('error', this._bootstrapError);
        return null;
      }
      const args = ['repo', 'create', `${owner}/${repo}`, '--private'];
      if (cfg.repoDescription) args.push('--description', cfg.repoDescription);
      const created = await this.gh(args);
      if (!this.ok(created)) {
        this._bootstrapError = this.githubRequestError(created);
        this.log(
          'warn',
          `自动创建私有仓库失败(可手动建仓,或编辑 ${this.configPath()} 填 remote): ${created.err.trim().split('\n')[0] || created.code}`,
        );
        return null;
      }
      this.log('info', `已自动创建私有仓库 https://github.com/${owner}/${repo} → ${remote}`);
    }
    await this.writeConfig({ remote });
    this._bootstrapNotice = null;
    return remote;
  },

  /** Why the default backup is still not connected after the last setup attempt; empty when unknown or connected. */
  remoteNotice() {
    return this._bootstrapNotice || '';
  },

  async rev(ref, gitdir = null, realPath = null) {
    const r = gitdir
      ? await this.gitW(gitdir, realPath, ['rev-parse', '--verify', ref])
      : await this.git(['rev-parse', '--verify', ref]);
    return this.ok(r) ? r.out.trim() : null;
  },

  async isAncestor(a, b, gitdir = null, realPath = null) {
    if (!a || !b) return false;
    const r = gitdir
      ? await this.gitW(gitdir, realPath, ['merge-base', '--is-ancestor', a, b])
      : await this.git(['merge-base', '--is-ancestor', a, b]);
    return this.ok(r);
  },

  /** 确保 .git 仓库、身份配置与 .gitignore 就位 */
  async ensureRepo(cfg) {
    const gitDir = path.join(this.home, '.git');
    if (!fs.existsSync(gitDir)) {
      const r = await this.git(['init', '-b', cfg.branch]);
      if (!this.ok(r)) {
        this.log('error', `git init 失败: ${r.err.trim() || r.code}`);
        return false;
      }
      this.log('info', `已在 ${this.home} 初始化本地 git 仓库(分支 ${cfg.branch})`);
    }
    // 确保 origin 指向配置的远端(不存在则添加,URL 变了则更新)
    if (cfg.remote) {
      const cur = await this.git(['remote', 'get-url', 'origin']);
      if (!this.ok(cur)) {
        await this.git(['remote', 'add', 'origin', cfg.remote]);
      } else if (cur.out.trim().replace(/\/+$/, '') !== String(cfg.remote).replace(/\/+$/, '')) {
        await this.git(['remote', 'set-url', 'origin', cfg.remote]);
      }
    }
    if (!(await this._ensureRepoConfig(cfg))) return false;
    // Session relations cannot be safely merged by Git's line-based driver.
    // Local attributes take precedence over synchronized .gitattributes.
    const attrsResult = await this.git(['rev-parse', '--git-path', 'info/attributes']);
    if (!this.ok(attrsResult)) return false;
    const attrsPath = path.resolve(this.home, attrsResult.out.trim());
    const sessionRule = 'sessions/**/*.jsonl* -merge';
    let attrs = fs.existsSync(attrsPath) ? fs.readFileSync(attrsPath, 'utf8') : '';
    if (!attrs.trimEnd().endsWith(sessionRule)) {
      fs.mkdirSync(path.dirname(attrsPath), { recursive: true });
      fs.writeFileSync(attrsPath, attrs.replace(/\s*$/, '') + '\n' + sessionRule + '\n');
    }
    this._ensureIgnoreFile(cfg);
    // 机器本地文件已在仓库跟踪中的,移出索引(不删文件;.gitignore 已排除,下次 add 不会加回)
    try {
      const targets = [
        '.credentials.yaml',
        '.dshw-usage.json',
        '.dshw-size.json',
        '.anonymous-user-id',
        '.pnpm-store',
        '.chatsync-local',
        'storages/workspace-local-paths.json',
        'cache',
        'logs',
        'electron',
        'profiles/web/.dsh-market',
        'profiles/desktop/.dsh-market',
        'profiles/desktop/.plugin-manager',
      ];
      const ls = await this.git(['ls-files', '--', ...targets]);
      if (this.ok(ls) && ls.out.trim()) {
        const r = await this.git(['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', ...targets]);
        if (this.ok(r))
          this.log('info', '机器本地文件已移出同步跟踪(文件保留,不同步): ' + ls.out.trim().split('\n').join(', '));
      }
    } catch {
      /* ignore */
    }
    return true;
  },

  /** 仓库本地配置(身份、换行、凭据助手、取回范围)与期望值一致;失败返回 false。 */
  async _ensureRepoConfig(cfg) {
    // Read every round so external edits are noticed; only write changed local
    // values. Separate config writers must remain sequential (Git's file lock).
    const wanted = {
      'user.name': cfg.gitUserName,
      'user.email': cfg.gitUserEmail,
      'core.autocrlf': 'false',
      'core.longpaths': 'true',
      'core.safecrlf': 'false',
      'commit.gpgsign': 'false',
    };
    if (cfg.remote) {
      // Only fetch main history; credentials stay in the local helper. Git is
      // noninteractive so missing credentials fail without spawning a prompt.
      wanted['remote.origin.fetch'] = '+refs/heads/' + cfg.branch + ':refs/remotes/origin/' + cfg.branch;
      wanted['credential.helper'] =
        parseSyncRemote(cfg.remote)?.provider === 'github' && (await this.ghAvailable())
          ? '!gh auth git-credential'
          : 'manager';
    }
    const localConfig = await this.git(['config', '--local', '--null', '--list']);
    if (!this.ok(localConfig)) {
      this.log('error', '无法读取仓库本地配置');
      return false;
    }
    const values = new Map();
    for (const item of localConfig.out.split('\0')) {
      const split = item.indexOf('\n');
      if (split < 0) continue;
      const key = item.slice(0, split),
        value = item.slice(split + 1);
      values.set(key, [...(values.get(key) || []), value]);
    }
    for (const [key, value] of Object.entries(wanted)) {
      const current = values.get(key);
      if (current?.length === 1 && current[0] === value) continue;
      if (!this.ok(await this.git(['config', '--local', '--replace-all', key, value]))) {
        this.log('error', '无法更新仓库本地配置: ' + key);
        return false;
      }
    }
    return true;
  },

  /** 生成或补全主仓库 .gitignore 的内置排除条目,用户自己加的条目保留。 */
  _ensureIgnoreFile(cfg) {
    const ignorePath = path.join(this.home, '.gitignore');
    if (!fs.existsSync(ignorePath)) {
      const lines = [...BUILTIN_IGNORE.split('\n'), ...(cfg.extraIgnore || [])];
      fs.writeFileSync(ignorePath, lines.join('\n') + '\n', 'utf8');
      this.log('info', '已生成 .gitignore(仅排除机器本地状态/node_modules;设置与密钥随仓库同步)');
    } else {
      // 确保密钥与依赖存储等排除条目在场(用户手工加的其他条目保留)。
      try {
        const cur = fs.readFileSync(ignorePath, 'utf8');
        const ensured = BUILTIN_IGNORE_ENSURE.filter(
          t => !new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(cur),
        );
        if (ensured.length) {
          fs.writeFileSync(
            ignorePath,
            cur.replace(/\s*$/, '\n') +
              '\n# 密钥与依赖存储 —— 不同步(dsh-chatsync 自动维护)\n' +
              ensured.join('\n') +
              '\n',
            'utf8',
          );
          this.log('info', '已补回 .gitignore 排除条目 ' + ensured.join(' / '));
        }
      } catch {
        /* ignore */
      }
    }
    // 确保主仓库排除工作区影子仓库目录(避免把各工作区 git 元数据误当普通文件提交)
    try {
      const cur = fs.readFileSync(ignorePath, 'utf8');
      if (!/^workspace-repos\/$/m.test(cur)) {
        fs.writeFileSync(ignorePath, cur.replace(/\s*$/, '\n') + 'workspace-repos/\n', 'utf8');
      }
    } catch {
      /* ignore */
    }
  },

  /**
   * 有变更就 add + commit。受 minCommitIntervalSeconds 节流(force=true 绕过,
   * 用于合并/拉取前强制清空工作树)。返回 'committed' | 'clean' | 'throttled' | 'error'。
   */
  async commitIfDirty(cfg, force = false) {
    const st = await this.git(['status', '--porcelain']);
    if (!this.ok(st)) {
      this.log('error', `git status 失败: ${st.err.trim()}`);
      return 'error';
    }
    if (!st.out.trim()) return 'clean';
    const throttleMs = force ? 0 : Math.max(0, (Number(cfg.minCommitIntervalSeconds) || 0) * 1000);
    if (Date.now() - (this.lastCommitAt || 0) < throttleMs) return 'throttled';
    // 提交前维护字段级版本图(settings.yaml/package.json 的 LWW 时钟),让「两机改同一字段」可收敛
    try {
      await this.updateCrdtVmaps();
    } catch (e) {
      this.log('warn', '版本图维护异常(不影响同步): ' + String(e?.message || e));
    }
    await this.git(['add', '-A']);
    const cm = await this.git(['commit', '-m', `${cfg.commitMessage} (${ts()})`]);
    if (!this.ok(cm)) {
      this.log('warn', `git commit 失败: ${cm.err.trim() || cm.out.trim()}`);
      return 'error';
    }
    this.lastCommitAt = Date.now();
    this.commitsSinceGc += 1;
    return 'committed';
  },

  /** 回收仓库空间。触发条件不只看提交次数:DSH 每次快照都写入新 blob,
   *  loose 对象会快速堆积(实测 238MB 仓库里 142MB 是未打包对象),
   *  因此还按 loose 体积阈值触发,避免只在「本进程满 20 次提交」时才回收。 */
  async gcIfNeeded() {
    const stats = this.repoStats();
    const looseBytes = stats ? stats.looseBytes : 0;
    const looseCount = stats ? stats.looseCount : 0;
    const byVolume = looseBytes >= 64 * 1024 * 1024 || looseCount >= 5000 || this.commitsSinceGc >= 20;
    if (!byVolume) return;
    this.commitsSinceGc = 0;
    this.step('gc', '回收仓库空间(git gc)…');
    const r = await this.git(['gc', '--quiet'], 600000);
    if (!this.ok(r)) this.log('warn', `git gc 失败(不影响同步): ${r.err.trim().split('\n')[0] || r.code}`);
    else this.log('info', `已执行 git gc 回收仓库空间(回收前 loose ${humanSize(looseBytes)}/${looseCount} 个对象)`);
  },

  /** 把远端头备份到 backup/<ts> 分支并推送(丢弃远端版本前的保险);gitdir/realPath 给定时为工作区影子仓库 */
  async backupRemoteHead(gitdir, realPath, remoteHead) {
    if (!remoteHead) return null;
    const branchName = `backup/${ts()}-${randomUUID()}`;
    const cb = gitdir
      ? await this.gitW(gitdir, realPath, ['branch', branchName, remoteHead])
      : await this.git(['branch', branchName, remoteHead]);
    if (!this.ok(cb)) return null;
    const pb = await this.runWithRetry(
      'push',
      gitdir ? '工作区 ' + path.basename(realPath || '') : '主仓库',
      ['push', 'origin', branchName],
      { gitdir, realPath },
    );
    if (!this.ok(pb)) {
      this.log('warn', `备份分支推送失败(本地分支 ${branchName} 已创建): ${pb.err.trim()}`);
      return { branch: branchName, pushed: false };
    }
    return { branch: branchName, pushed: true };
  },
};
