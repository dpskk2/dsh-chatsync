// Part of the SyncEngine (lib/sync.js); moved verbatim from lib/sync.js.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { scanOutgoing } from '../privacy.js';
import { reviewTransfer } from '../review.js';
import { formatTransfer, parseTransfer } from './format.js';

export const gitRunnerMethods = {
  /** 更新实时进度(供 /api/progress 轮询;startedAt 在 _syncOnce 入口统一设定) */
  step(stage, label) {
    const changed = this.progress?.stage !== stage;
    if (changed) {
      this._liveTransfer = null;
      this._transferText = '';
    }
    this.progress = {
      ...(this.progress || {}),
      running: true,
      stage,
      label,
      at: Date.now(),
      stageStartedAt: changed ? Date.now() : this.progress.stageStartedAt,
      ...(changed ? { transfer: null } : {}),
    };
    if (this._stages.at(-1)?.stage !== stage) this._stages.push({ stage, label, at: Date.now() });
  },

  /** 判断一条 git 报错是否属于「凭据缺失/认证失败」(重试无意义,应秒级放弃并给出指引) */
  isAuthError(errText) {
    return /could not read Username|terminal prompts disabled|authentication failed|could not read password|not logged in|failed to execute prompt/i.test(
      String(errText || ''),
    );
  },

  /** 异步执行一条外部命令(git/gh),返回 { code, out, err };命令缺失时 code = -1。
   *  binary=true 时 stdout 以 Buffer 返回(用于读取冲突双方二进制内容);
   *  onProgress 可选:每收到一段 stderr 就回调(用于 --progress 的实时进度展示);
   *  useGitEnv=true 时在 DSH home 目录下、用代理/凭据环境变量执行(git 用;gh 不需要)。 */
  _spawn(
    cmd,
    args,
    timeoutMs,
    { binary = false, onProgress = null, useGitEnv = false, input = null, maxOutputBytes = Infinity } = {},
  ) {
    let commandIndex = 0;
    while (args[commandIndex]?.startsWith('-'))
      commandIndex += ['-c', '--git-dir', '--work-tree', '-C'].includes(args[commandIndex]) ? 2 : 1;
    const cleanup = cmd === 'git' && ((args[0] === 'worktree' && args[1] === 'remove') || args.includes('--abort'));
    if (!cleanup) this.throwIfCancelled();
    const control = this._syncControl;
    const interruptible =
      cmd === 'gh' ||
      cmd === 'curl' ||
      (cmd === 'git' && ['fetch', 'push', 'ls-remote', 'clone'].includes(args[commandIndex]));
    return new Promise(resolve => {
      const chunks = [];
      const errors = [];
      let settled = false;
      let timedOut = false;
      let outputLimit = false,
        outputBytes = 0;
      let stopping = false,
        closeFallback;
      let child;
      try {
        const opts = { windowsHide: true, detached: process.platform !== 'win32' };
        if (useGitEnv) {
          opts.cwd = this.home;
          opts.env = this._gitEnv;
        }
        child = spawn(cmd, args, opts);
        if (input !== null) {
          child.stdin?.on('error', () => {});
          child.stdin?.end(input);
        }
      } catch (e) {
        resolve({ code: -1, out: binary ? Buffer.alloc(0) : '', err: String(e) });
        return;
      }
      const stop = () => {
        if (stopping) return;
        stopping = true;
        try {
          if (process.platform === 'win32') {
            if (child.exitCode === null && child.pid)
              spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
                windowsHide: true,
                timeout: 5000,
                stdio: 'ignore',
              });
          } else if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Fall back to the owned child handle, never a process-name kill. */
        }
        if (child.exitCode === null) {
          try {
            child.kill('SIGKILL');
          } catch {}
        }
        closeFallback = setTimeout(() => {
          child.stdin?.destroy();
          child.stdout?.destroy();
          child.stderr?.destroy();
        }, 1500);
      };
      const interrupt = () => {
        if (!settled) stop();
      };
      if (interruptible) control?.interrupts.add(interrupt);
      const timer = setTimeout(() => {
        if (!settled) {
          timedOut = true;
          stop();
        }
      }, timeoutMs);
      child.stdout?.on('data', d => {
        outputBytes += d.length;
        if (outputBytes > maxOutputBytes) {
          outputLimit = true;
          stop();
          return;
        }
        if (!outputLimit) chunks.push(d);
      });
      child.stderr?.on('data', d => {
        errors.push(d);
        if (onProgress) onProgress(d);
      });
      child.on('error', e => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(closeFallback);
        control?.interrupts.delete(interrupt);
        const msg = String(e?.message || e);
        if (cmd === 'git' && msg.includes('ENOENT')) this.gitMissing = true;
        resolve({ code: -1, out: binary ? Buffer.alloc(0) : Buffer.concat(chunks).toString('utf8'), err: msg });
      });
      child.on('close', code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(closeFallback);
        control?.interrupts.delete(interrupt);
        resolve({
          code,
          out: binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8'),
          err: Buffer.concat(errors).toString('utf8'),
          ...(timedOut ? { timedOut: true } : {}),
          ...(outputLimit ? { outputLimit: true } : {}),
        });
      });
    }).then(result => {
      if (!cleanup) this.throwIfCancelled();
      return result;
    });
  },

  throwIfCancelled() {
    if (this._syncControl?.cancelled && !this._syncControl.maskDepth)
      throw Object.assign(new Error('本次同步已取消，已保存的本地改动保留。'), { code: 'SYNC_CANCELLED' });
  },

  async cancelSync() {
    const pending = this.inFlight,
      control = this._syncControl;
    if (!pending || !control) return;
    control.cancelled = true;
    this.step('cancelling', '正在停止同步；本地写入完成后安全停止…');
    for (const interrupt of control.interrupts) interrupt();
    await pending;
  },

  /** 异步执行一条 git 命令(git 缺失时 code = -1) */
  git(args, timeoutMs = 120000, onProgress = null) {
    if (this._transport) return this._transport.git(args, timeoutMs, onProgress);
    return this._spawn('git', args, timeoutMs, { onProgress, useGitEnv: true });
  },

  /** 字节安全地执行一条 git 命令(用于读取冲突双方二进制内容),stdout 以 Buffer 返回 */
  gitBytes(args, timeoutMs = 60000) {
    if (this._transport) return this._transport.gitBytes(args, timeoutMs);
    return this._spawn('git', args, timeoutMs, { binary: true, useGitEnv: true });
  },

  /**
   * 同步(阻塞)执行一条 git 命令,用于退出冲刷;返回 { code, out, err }
   * @param {string[]} args
   * @param {number} [timeoutMs]
   * @param {{ input?: string, maxOutputBytes?: number }} [options]
   */
  gitSync(args, timeoutMs = 15000, { input, maxOutputBytes = 1024 * 1024 } = {}) {
    if (this._transport) return this._transport.gitSync(args, timeoutMs, { input, maxOutputBytes });
    try {
      const r = spawnSync('git', args, {
        cwd: this.home,
        windowsHide: true,
        timeout: timeoutMs,
        encoding: 'utf8',
        env: this._gitEnv,
        input,
        maxBuffer: maxOutputBytes,
      });
      if (r.error) {
        const msg = String(r.error?.message || r.error);
        if (msg.includes('ENOENT')) this.gitMissing = true;
        return { code: -1, out: r.stdout || '', err: msg };
      }
      return { code: r.status ?? 1, out: r.stdout || '', err: r.stderr || '' };
    } catch (e) {
      return { code: -1, out: '', err: String(e) };
    }
  },

  ok(r) {
    return r.code === 0 && !r.timedOut && !r.outputLimit;
  },

  /** 异步执行 gh CLI(用于自动建仓/查询账号);返回 { code, out, err } */
  gh(args, timeoutMs = 60000) {
    this.applyProxyEnv(this.loadConfig());
    return this._spawn('gh', args, timeoutMs, { useGitEnv: true });
  },

  /** 当前 gh 登录账号(login);未登录/gh 缺失时返回 null,失败结果留给调用方说明原因 */
  async ghLogin() {
    const r = await this.gh(['api', 'user', '--jq', '.login']);
    this._ghLoginFailure = this.ok(r) && r.out.trim() ? null : r;
    return this.ok(r) ? r.out.trim() : null;
  },

  /** gh CLI 是否可用(缓存探测结果;用于决定凭据助手与自动建仓路径) */
  async ghAvailable() {
    if (this._ghChecked === undefined) this._ghChecked = this.ok(await this.gh(['--version']));
    return this._ghChecked;
  },

  /** Describe request failures without mistaking transport errors for repository visibility. */
  githubRequestError(result) {
    const detail = `${result.err || ''}\n${result.out || ''}`;
    if (
      result.timedOut ||
      /\bEOF\b|ECONN\w*|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|no such host|network is unreachable|connection (?:reset|refused|closed)|actively refused|forcibly closed|context deadline exceeded|timed?\s*out|timeout|TLS handshake|certificate|proxyconnect|could not resolve host|offline/i.test(
        detail,
      )
    ) {
      return '连接 GitHub 失败：网络、代理或 DNS 请求异常。请检查连接后重试；本次不会上传。';
    }
    if (/ENOENT|executable file not found|not recognized as/i.test(detail)) {
      return '未找到 GitHub CLI。请安装 GitHub CLI 并重新打开 DSH 后重试；本次不会上传。';
    }
    if (
      /HTTP 401|bad credentials|not logged into|not logged in|gh auth login|authentication (?:failed|required)|requires authentication/i.test(
        detail,
      )
    ) {
      return 'GitHub 尚未登录或登录已失效。请执行 gh auth login 后重试；本次不会上传。';
    }
    if (/rate limit|HTTP 429/i.test(detail)) {
      return 'GitHub 请求次数已达到限制。请稍后重试；本次不会上传。';
    }
    if (/HTTP 5\d\d/i.test(detail)) {
      return 'GitHub 或代理服务暂时不可用。请稍后重试；本次不会上传。';
    }
    if (
      /HTTP 40[34]|could not resolve to a repository|not found|resource not accessible|forbidden|permission denied/i.test(
        detail,
      )
    ) {
      return '无法访问 GitHub 仓库。请检查仓库地址及当前账号的访问权限；本次不会上传。';
    }
    return 'GitHub 仓库查询失败，暂时无法判断原因。请稍后重试，或在终端运行 gh repo view 仓库地址 查看具体错误；本次不会上传。';
  },

  gitInput(args, input, timeoutMs = 60000, binary = false, { maxOutputBytes = Infinity } = {}) {
    if (this._transport) return this._transport.gitInput(args, input, timeoutMs, binary, { maxOutputBytes });
    return this._spawn('git', args, timeoutMs, { input, binary, useGitEnv: true, maxOutputBytes });
  },

  /** 在影子仓库上执行 git(工作树即真实文件夹) */
  gitW(gitdir, realPath, args, timeoutMs = 120000, onProgress = null) {
    return this.git(['--git-dir=' + gitdir, '--work-tree=' + realPath, ...args], timeoutMs, onProgress);
  },

  /** 记录并(有传输时)日志输出一次 fetch/push 的传输统计;无传输(Everything up-to-date)不打扰 */
  recordTransfer(op, r, label) {
    try {
      const st = parseTransfer(r.err || '');
      if (!st.op) st.op = op; // 未输出进度行(无传输)时按调用意图补上方向
      if (st.size != null || st.totalObjects != null) {
        st.label = label;
        this._transfers.push(st);
        const line = formatTransfer(st);
        if (line) this.log('info', `${label}:${line}`);
      }
      return st;
    } catch {
      return { op };
    }
  },

  /** 实时传输统计:解析 git --progress 每段 stderr,更新 this._liveTransfer 并挂到
   *  this.progress(供 /api/progress 轮询 → 侧栏气泡/设置卡实时展示上传下载字节与速度)。
   *  无传输信息(握手/计数行)时不动现有进度。 */
  liveTransfer(op, label, chunk) {
    try {
      // Git emits carriage-return updates and may split a line between chunks.
      this._transferText = ((this._transferText || '') + String(chunk)).slice(-16384);
      const st = parseTransfer(this._transferText);
      if (st.op == null && st.size == null && st.totalObjects == null) return;
      st.op = st.op || op;
      st.label = label;
      const prev = this._liveTransfer;
      // git 未输出速度时,用字节增量/时间自行估算(滚动)
      if (st.speed == null && st.size != null && prev && prev.size != null && prev.at) {
        const dt = Date.now() - prev.at;
        if (dt > 0) st.speed = Math.max(0, Math.round(((st.size - prev.size) * 1000) / dt));
      }
      st.at = Date.now();
      this._liveTransfer = st;
      this.progress = { ...(this.progress || {}), running: true, transfer: st, at: Date.now() };
    } catch {
      /* 解析失败忽略 */
    }
  },

  async runWithRetry(op, label, args, { gitdir = null, realPath = null, timeoutMs = 180000, onProgress = null } = {}) {
    let scannedHead = null,
      uploadBranch = null;
    if (op === 'push') {
      if (this.hasPendingSessionImport())
        return { code: 1, out: '', err: '上传已暂停：恢复会话尚未读回验收，请先在恢复记录中重试。' };
      const target = args.filter(arg => !arg.startsWith('-')).at(-1);
      try {
        const report = await scanOutgoing(this, target, gitdir, realPath || this.home);
        if (report.findings.length) {
          this.recordPrivacyReport({
            ...report,
            label,
            root: realPath || this.home,
            workspaceId: gitdir ? path.basename(gitdir, '.git') : null,
          });
          return { code: 1, out: '', err: '上传已暂停：待上传内容或历史含敏感信息，或超出扫描上限。' };
        }
        const head = await this.rev(target, gitdir, realPath);
        if (!head || head !== report.head) {
          this._uploadChange = '检查期间本机提交已变化；尚未上传，请重新同步。';
          throw new Error(this._uploadChange);
        }
        const review = await reviewTransfer(this, 'upload', head, target, gitdir, realPath || this.home);
        if (review) return { code: 1, out: '', err: '同步已暂停，等待确认预览' };
        if (head)
          this._safeUploadHeads.set(gitdir || 'main', { head, remote: this._verifiedPrivateRemote, branch: target });
        scannedHead = head;
        uploadBranch = target;
      } catch (error) {
        if (error?.code === 'SYNC_CANCELLED') throw error;
        const reason =
          /^(?:无法固定待上传提交|无法枚举待上传历史|无法检查待上传文件名|无法检查待上传对象|待上传对象清单不完整|待上传对象格式不正确|待上传对象大小不正确|无法读取待上传内容|待上传内容读取不完整|待上传内容包含未检查的额外数据)$/.test(
            error?.message || '',
          )
            ? error.message
            : '检查进程异常';
        this.recordPrivacyReport({
          label,
          root: realPath || this.home,
          workspaceId: gitdir ? path.basename(gitdir, '.git') : null,
          findings: [{ file: '(检查过程)', reasons: [reason] }],
        });
        return { code: 1, out: '', err: '上传已暂停：无法完成敏感信息检查。' };
      }
    }
    const run = (a, t, p) => (gitdir ? this.gitW(gitdir, realPath, a, t, p) : this.git(a, t, p));
    const withProg = [...args, '--progress'];
    if (scannedHead) {
      const index = args.lastIndexOf(uploadBranch);
      // Push exactly what was scanned and approved, even if an external Git client
      // changes the branch while the network request or retry is underway.
      withProg[index] = scannedHead + ':refs/heads/' + uploadBranch;
    }
    const finish = async result => {
      if (this.ok(result) && scannedHead && (await this.rev(uploadBranch, gitdir, realPath)) !== scannedHead) {
        this._uploadChange = '本机提交在检查后变化；本次仅上传已检查版本，请重新同步。';
        return { ...result, code: 1, err: this._uploadChange };
      }
      return result;
    };
    const r1 = await run(withProg, timeoutMs, onProgress);
    this.recordTransfer(op, r1, label);
    if (this.ok(r1)) return finish(r1);
    if (this.isAuthError(r1.err)) {
      this.log(
        'warn',
        `${label} git ${op} 需要凭据但当前不可用(已禁用交互弹窗)。请先 gh auth login 或配置 PAT(见 README「凭据」),再点同步。${String(r1.err).trim().split('\n')[0]}`,
      );
      return r1;
    }
    await new Promise(res => setTimeout(res, 1200));
    const r2 = await run(withProg, timeoutMs, onProgress);
    this.recordTransfer(op, r2, label);
    if (this.ok(r2)) this.log('info', `${label} git ${op} 首次失败(网络抖动)后重试成功`);
    return finish(r2);
  },

  /** 阻塞版 worktree git,用于退出冲刷 */
  gitWSync(gitdir, realPath, args, timeoutMs = 20000, options = {}) {
    return this.gitSync(['--git-dir=' + gitdir, '--work-tree=' + realPath, ...args], timeoutMs, options);
  },

  /** 字节安全版 worktree git(用于读取工作区冲突双方二进制内容) */
  gitBytesW(gitdir, realPath, args, timeoutMs = 60000) {
    return this.gitBytes(['--git-dir=' + gitdir, '--work-tree=' + realPath, ...args], timeoutMs);
  },
};
