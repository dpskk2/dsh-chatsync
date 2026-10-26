// Part of the SyncEngine (lib/sync.js); moved verbatim from lib/sync.js.
import fs from 'node:fs';
import path from 'node:path';
import { chooseSessionHistory } from '../branch-history.js';
import { classifyFile, mergeCordisEntries } from '../merge.js';
import { validateSessionTree } from '../session-transfer.js';
import { reviewTransfer } from '../review.js';

export const mainSyncMethods = {
  async _mainSync(reason, opts = {}) {
    this.progress = { running: true, stage: 'prepare', label: '准备本地仓库…', startedAt: Date.now() };
    const cfg = this.loadConfig();
    const unready = await this._prepareMainRepo(cfg, reason);
    if (unready) return unready;

    const hasRemote = Boolean(cfg.remote);
    let remoteHead = null;
    let authFailed = false;

    if (hasRemote) {
      const fetched = await this._fetchMainRemote(cfg);
      if (fetched.error) return fetched;
      ({ remoteHead, authFailed } = fetched);
    }

    // 幽灵登记清理:fetch 成功(云端快照可用)后,剔除本机与云端都没有文件的会话登记 —— 删除的会话不再"复活"
    if (remoteHead !== null) {
      try {
        await this.pruneGhostRegistrations();
      } catch (e) {
        this.log('warn', '幽灵登记清理异常: ' + String(e?.message || e));
      }
    }

    // 手动触发(按钮/面板/CLI)传 forceCommit:不受提交节流限制
    this.step('commit', '提交本地快照…');
    const commitRes = await this.commitIfDirty(cfg, opts.forceCommit === true);
    let committed = commitRes === 'committed';
    if (remoteHead) {
      const review = await reviewTransfer(this, 'download', remoteHead, cfg.branch);
      if (review) return { committed, error: '同步已暂停，等待确认预览' };
    }

    if (!hasRemote) {
      if (committed) {
        this.log('info', `[${reason}] 已提交本地快照(未配置 remote,仅本地)`);
        this.gcIfNeeded().catch(() => {});
      }
      return { committed, pushed: false, pulled: false };
    }
    if (remoteHead === null) return this._pushFirstBranch(cfg, reason, committed, authFailed);
    return this._reconcileMain(cfg, reason, commitRes, committed, remoteHead);
  },

  /** Git、私有远端、传输副本与本地仓库都就绪时返回 null,否则返回本轮结果。 */
  async _prepareMainRepo(cfg, reason) {
    if (this.gitMissing)
      return { error: '未检测到 Git。请安装 Git 后重启 DSH，再重试同步。', skipped: 'git-not-found' };

    // 首次同步:remote 为空时尝试用 gh 自动建仓/复用,并把 remote 写回配置
    if (!cfg.remote && cfg.autoRepo !== false) {
      this.step('prepare', '检测远端仓库(gh)…');
      const boot = await this.bootstrapRemote(cfg, { reason });
      if (boot) cfg.remote = boot;
      if (this._bootstrapError) return { error: this._bootstrapError };
    }

    this._verifiedPrivateRemote = null;
    if (cfg.remote) {
      const visibility = await this.verifyPrivateRemote(cfg.remote);
      if (!visibility.ok) return { error: visibility.error };
      this._verifiedPrivateRemote = cfg.remote;
    }

    if (!this._isolatedTransport)
      return { error: 'unsafe-main-tree', hint: '主数据必须通过独立传输副本同步，请使用 syncOnce' };
    if (!(await this.ensureRepo(cfg))) return { error: 'ensure-repo' };

    // Legacy hook is intentionally read-only: DSH owns workspace membership.
    try {
      this.repairWorkspaceRegistry();
    } catch (e) {
      this.log('warn', '工作区登记表修复异常: ' + String(e?.message || e));
    }
    return null;
  },

  /** 获取远端状态;远端会话不合法时返回本轮结果(带 error)。 */
  async _fetchMainRemote(cfg) {
    let remoteHead = null;
    let authFailed = false;
    this.step('fetch', '获取远端状态…');
    const rf = await this.runWithRetry('fetch', '主仓库', ['fetch', 'origin', '--prune'], {
      timeoutMs: 180000,
      onProgress: d => this.liveTransfer('fetch', '主仓库', d),
    });
    if (!this.ok(rf)) {
      authFailed = this.isAuthError(rf.err);
      this.log(
        'warn',
        `git fetch 失败(${authFailed ? '凭据缺失/认证失败' : '远端不可达?'}本次只做本地快照): ${rf.err.trim().split('\n')[0] || rf.code}`,
      );
    } else {
      remoteHead = await this.rev(`refs/remotes/origin/${cfg.branch}`);
      if (remoteHead) {
        try {
          await validateSessionTree(this, remoteHead);
        } catch (error) {
          return { error: 'invalid-remote-session', hint: error.message };
        }
      }
    }
    return { remoteHead, authFailed };
  },

  /** 取不到远端分支:凭据不可用时给出指引,否则直接推送本地状态。 */
  async _pushFirstBranch(cfg, reason, committed, authFailed) {
    // 凭据缺失/认证失败:跳过推送尝试(否则会再弹一次 GCM/再失败一次),给出明确指引
    if (authFailed) {
      return {
        committed,
        pushed: false,
        error: 'auth',
        hint: '远端需要凭据但当前不可用。请先 gh auth login 或配置 PAT(见 README「凭据」),再点同步。',
      };
    }
    // 远端还没有分支:直接推送本地状态
    this.step('push', '首次推送到远端…');
    const p = await this.runWithRetry('push', '主仓库', ['push', '-u', 'origin', cfg.branch], {
      timeoutMs: 180000,
      onProgress: d => this.liveTransfer('push', '主仓库', d),
    });
    if (this.ok(p)) {
      this.log('info', `[${reason}] 首次推送成功 → ${cfg.remote}`);
      return { committed, pushed: true, pulled: false };
    }
    this.log('error', `git push 失败(检查远端地址与凭据): ${p.err.trim().split('\n')[0] || p.code}`);
    return { committed, pushed: false, error: 'push' };
  },

  /** 本地与远端各有头:按祖先关系整体取回、推送、快进,或进入合并。 */
  async _reconcileMain(cfg, reason, commitRes, committed, remoteHead) {
    const localHead = await this.rev('HEAD');
    this.step('analyze', '比对本地与远端…');

    // 情况 1:本地没有任何提交(如新电脑空 .dsh)→ 整体取回远端
    if (localHead === null) {
      this.step('pull', '从远端整体取回…');
      const co = await this.git(['checkout', '-B', cfg.branch, `origin/${cfg.branch}`]);
      if (this.ok(co)) {
        this.log('info', `[${reason}] 本地仓库为空,已从远端整体取回 .dsh`);
        return { committed, pushed: false, pulled: 'reset' };
      }
      this.log('error', `从远端取回失败: ${co.err.trim()}`);
      return { committed, error: 'checkout' };
    }

    if (localHead === remoteHead) {
      if (committed) {
        this.step('push', '推送到远端…');
        const p = await this.runWithRetry('push', '主仓库', ['push', 'origin', cfg.branch], {
          timeoutMs: 180000,
          onProgress: d => this.liveTransfer('push', '主仓库', d),
        });
        if (!this.ok(p)) this.log('error', `git push 失败: ${p.err.trim().split('\n')[0] || p.code}`);
        if (this.ok(p)) this.gcIfNeeded().catch(() => {});
        return { committed, pushed: this.ok(p), ...(!this.ok(p) && { error: 'push' }) };
      }
      return { committed: false, pushed: false, pulled: false };
    }

    // 后续快进/合并/重置都需要干净的工作树:节流攒下的未提交变更先强制提交
    if (commitRes === 'throttled') {
      const forced = await this.commitIfDirty(cfg, true);
      if (forced === 'committed') committed = true;
    }

    // 情况 2:本地领先(远端是本地祖先)→ 推送
    if (await this.isAncestor(remoteHead, localHead)) {
      this.step('push', '推送到远端…');
      const p = await this.runWithRetry('push', '主仓库', ['push', 'origin', cfg.branch], {
        timeoutMs: 180000,
        onProgress: d => this.liveTransfer('push', '主仓库', d),
      });
      if (this.ok(p)) {
        this.log('info', `[${reason}] 已推送本地变更(${committed ? '含新快照' : '先前提交'})`);
        return { committed, pushed: true };
      }
      this.log('error', `git push 失败: ${p.err.trim().split('\n')[0] || p.code}`);
      return { committed, pushed: false, error: 'push' };
    }

    // 情况 3:远端领先(本地是远端祖先)→ 快进拉取
    if (await this.isAncestor(localHead, remoteHead)) {
      this.step('pull', '拉取远端新数据…');
      const mg = await this.git(['merge', '--ff-only', `origin/${cfg.branch}`]);
      if (this.ok(mg)) {
        this.log('info', `[${reason}] 已从远端快进同步新数据`);
        return { committed, pushed: false, pulled: 'ff' };
      }
      // 理论到不了这里(祖先关系已确认);失败则保守地 hard reset
      const stNow = await this.git(['status', '--porcelain']);
      if (!(this.ok(stNow) && !stNow.out.trim())) {
        this.log('warn', '工作树不干净,跳过 reset,保留未提交变更待下次同步');
        return { committed, pushed: false, pulled: false };
      }
      const rs = await this.git(['reset', '--hard', `origin/${cfg.branch}`]);
      if (this.ok(rs)) {
        this.log('info', `[${reason}] 已从远端同步新数据(reset)`);
        return { committed, pushed: false, pulled: 'reset' };
      }
      this.log('error', `快进同步失败: ${mg.err.trim()}`);
      return { committed, error: 'pull' };
    }

    return this._mergeDivergentMain(cfg, reason, committed, localHead, remoteHead);
  },

  async _mergeDivergentMain(cfg, reason, committed, localHead, remoteHead) {
    // 情况 4:双方都有独立提交 → merge;冲突文件保留本地,远端先备份
    this.step('merge', '合并双方数据…');
    let mg = await this.git(['merge', '--no-edit', `origin/${cfg.branch}`]);
    let unrelated = false;
    const mergeHeadExists = fs.existsSync(path.join(this.home, '.git', 'MERGE_HEAD'));
    if (!this.ok(mg) && !mergeHeadExists) {
      const cf0 = await this.git(['diff', '--name-only', '--diff-filter=U', '-z']);
      const noConflicts = !this.ok(cf0) || !cf0.out.trim();
      if (noConflicts) {
        // 无冲突却合并失败 → 多半是"无共同历史"(如新电脑首次并入远端):
        // 允许合并不相关历史,同名文件以远端为准,本地独有文件保留
        unrelated = true;
        mg = await this.git(['merge', '--no-edit', '--allow-unrelated-histories', `origin/${cfg.branch}`]);
      }
    }
    if (this.ok(mg)) {
      this.log(
        'info',
        unrelated
          ? `[${reason}] 本地新仓库已并入远端历史(同名文件以远端为准,本地独有文件保留)`
          : `[${reason}] 两台电脑都有新数据,已自动合并`,
      );
      const p = await this.runWithRetry('push', '主仓库', ['push', 'origin', cfg.branch], {
        timeoutMs: 180000,
        onProgress: d => this.liveTransfer('push', '主仓库', d),
      });
      if (!this.ok(p)) this.log('error', `合并后推送失败: ${p.err.trim().split('\n')[0] || p.code}`);
      return { committed, pushed: this.ok(p), pulled: 'merge', unrelated, ...(!this.ok(p) && { error: 'push' }) };
    }
    const cf = await this.git(['diff', '--name-only', '--diff-filter=U', '-z']);
    let conflicts = this.ok(cf) ? cf.out.split('\0').filter(Boolean) : [];
    let recoveryIds;
    try {
      recoveryIds = await this.captureConflicts(conflicts, localHead, remoteHead);
    } catch (e) {
      await this.git(['merge', '--abort']);
      return { committed, error: '无法保存冲突原件：' + e.message };
    }
    const sessionWarnings = [];
    const backup = unrelated ? null : await this.backupRemoteHead(null, null, remoteHead);
    const backupBranch = backup?.branch || null;
    await this._resolveMainConflicts(conflicts, unrelated, cfg, reason, localHead, remoteHead, sessionWarnings);
    return this._finishMainMerge(
      cfg,
      reason,
      committed,
      conflicts,
      recoveryIds,
      unrelated,
      backup,
      backupBranch,
      sessionWarnings,
    );
  },

  async _resolveMainConflicts(conflicts, unrelated, cfg, reason, localHead, remoteHead, sessionWarnings) {
    if (unrelated) {
      // 无共同历史(新机并入远端):同名文件以远端为准,本地独有文件保留
      for (const f of conflicts) {
        if (classifyFile(f) === 'session-log')
          sessionWarnings.push({ path: f, reason: 'unrelated-history', localHead, remoteHead, kept: 'remote' });
        await this.git(['checkout', '--theirs', '--', f]);
      }
    } else {
      // 分层合并引擎:按文件类型确定性合并,任何类型都不再产出「待人工裁决」的 .dsh-conflict 拷贝
      let autoMerged = 0;
      let keptLocal = 0;
      for (const f of conflicts) {
        if (!f || f.includes('\0')) continue;
        if ((await this._mergeMainConflict(f, cfg, reason, localHead, remoteHead, sessionWarnings)) === 'merged')
          autoMerged += 1;
        else keptLocal += 1;
      }
      if (autoMerged) this.log('info', `[${reason}] 分层合并:${autoMerged} 个文件已自动合并`);
      if (keptLocal) this.log('info', `[${reason}] 分层合并:${keptLocal} 个 opaque 文件自动取本机`);
    }
  },

  /** 按文件类型合并一个冲突文件:返回 'merged',取本机版本时返回 'local'。 */
  async _mergeMainConflict(f, cfg, reason, localHead, remoteHead, sessionWarnings) {
    try {
      if (f === 'storages/workspace.json') {
        // 项目登记三方合并，尊重基线后的删除；失败保留本机版本
        if (await this.unionMergeWorkspaceJson()) {
          await this.git(['add', '--', f]);
          this.log('info', `[${reason}] workspace.json 已并集合并`);
          return 'merged';
        }
        await this.git(['checkout', '--ours', '--', f]);
        this.log(
          'warn',
          `[${reason}] workspace.json 并集合并失败,已自动取本机(远端登记见 origin/${cfg.branch} 历史,可从 git 找回)`,
        );
        return 'local';
      }
      const type = classifyFile(f);
      if (type === 'session-log') {
        const b = await this.conflictBlobs(null, this.home, f);
        if (b.ours && b.theirs) {
          const r = await chooseSessionHistory(this, b.ours, b.theirs);
          if (r.ok) {
            this._writeMerged(f, r.value);
            await this.git(['add', '--', f]);
            this.log('info', `[${reason}] 会话日志已原样保留完整追加版本: ${f}`);
            return 'merged';
          }
          sessionWarnings.push({ path: f, reason: r.reason, localHead, remoteHead, kept: 'local' });
        } else {
          sessionWarnings.push({ path: f, reason: 'missing-side', localHead, remoteHead, kept: 'local' });
        }
        throw new Error('session-log merge failed');
      }
      if (type === 'crdt-json' || type === 'crdt-yaml') {
        if (f === '.credentials.yaml') {
          await this.git(['checkout', '--ours', '--', f]);
          return 'local';
        }
        if (await this.mergeCrdtFile(f, type)) {
          this.log('info', `[${reason}] ${type === 'crdt-yaml' ? 'YAML' : 'JSON'} 配置已字段级合并: ${f}`);
          return 'merged';
        }
        throw new Error(type + ' merge failed');
      }
      if (type === 'crdt-meta') {
        if (await this.mergeCrdtFile(f, type)) {
          this.log('info', `[${reason}] vmap 已合并: ${f}`);
          return 'merged';
        }
        throw new Error('vmap merge failed');
      }
      if (type === 'cordis-entries') {
        const b = await this.conflictBlobs(null, this.home, f);
        const text = x => (x ? x.toString('utf8') : null);
        const r = mergeCordisEntries(text(b.base), text(b.ours), text(b.theirs));
        if (r.ok) {
          this._writeMerged(f, Buffer.from(r.value, 'utf8'));
          await this.git(['add', '--', f]);
          this.log(
            'info',
            `[${reason}] 设置补丁已按条目合并: ${f}` +
              (r.conflicts.length ? `；两边都改过的条目保留本机：${r.conflicts.join('、')}` : ''),
          );
          return 'merged';
        }
        // Order-dependent or unreadable lists keep a complete local side below.
      }
      // opaque(session_projcache/.gitignore/工作区文件等)→ 本机优先,远端在 backup 分支 + origin 历史
      await this.git(['checkout', '--ours', '--', f]);
      return 'local';
    } catch (e) {
      try {
        await this.git(['checkout', '--ours', '--', f]);
      } catch {}
      this.log(
        'warn',
        `[${reason}] ${f} 合并失败,自动取本机(远端见 backup 分支/origin 历史): ${String(e?.message || e)}`,
      );
      return 'local';
    }
  },

  async _finishMainMerge(
    cfg,
    reason,
    committed,
    conflicts,
    recoveryIds,
    unrelated,
    backup,
    backupBranch,
    sessionWarnings,
  ) {
    // 守卫:任何冲突文件仍残留合并标记 → 中止合并,绝不把标记提交/推送(标记会让页面/文档打开为空白或乱码)
    const stillMarked = this.conflictMarkersRemain(this.home, conflicts);
    if (stillMarked.length) {
      await this.git(['merge', '--abort']);
      this.log(
        'error',
        `主仓库合并冲突无法安全物化(文件仍含冲突标记: ${stillMarked.join(', ')}),已中止,本地状态未变;请手工解决后重新同步`,
      );
      return { committed, error: 'merge-markers' };
    }
    const done = await this.git(['add', '-A']);
    const cm = this.ok(done) ? await this.git(['commit', '--no-edit']) : { code: 1 };
    if (!this.ok(cm)) {
      // 极端情况:合并没法收尾 → 中止合并,保留本地,推送交给下次
      await this.git(['merge', '--abort']);
      this.log('error', `合并收尾失败,已中止(本地状态未变): ${cm.err?.trim() || ''}`);
      return { committed, error: 'merge' };
    }
    this.finishConflicts(recoveryIds, this.home);
    if (unrelated) {
      this.log(
        'warn',
        `[${reason}] 本地新仓库已并入远端历史;${conflicts.length} 个同名文件采用了远端版本` +
          (conflicts.length ? `(本地版本见本地提交历史): ${conflicts.join(', ')}` : ''),
      );
    } else {
      this.log(
        'info',
        `[${reason}] 双方都有新提交,已按文件类型处理 ${conflicts.length} 个冲突` +
          (backupBranch ? `,远端头已备份到 ${backupBranch}` : '') +
          (conflicts.length ? `;冲突: ${conflicts.join(', ')}` : ''),
      );
    }
    const p = await this.runWithRetry('push', '主仓库', ['push', 'origin', cfg.branch], {
      timeoutMs: 180000,
      onProgress: d => this.liveTransfer('push', '主仓库', d),
    });
    if (!this.ok(p)) this.log('error', `合并后推送失败: ${p.err.trim().split('\n')[0] || p.code}`);
    return {
      committed,
      pushed: this.ok(p),
      pulled: 'merge',
      conflicts,
      sessionWarnings,
      conflictCopies: [],
      backupBranch,
      backupPushed: backup?.pushed ?? false,
      ...(!this.ok(p) && { error: 'push' }),
    };
  },
};
