    /* ---------- 同步状态共享(含实时进度轮询) ---------- */
    const STAGE_SHORT = {
      prepare: '准备', 'wait-lock': '等待上次同步', verify: '连接仓库', fetch: '获取远端', commit: '提交', analyze: '比对', privacy: '检查内容', apply: '应用更新', handoff: '记录交接',
      pull: '拉取', merge: '合并', push: '推送', gc: '清理', ws: '工作区', done: '', error: '',
    };
    function fmtElapsed(ms) {
      const s = Math.max(0, Math.round(ms / 100) / 10);
      if (s < 60) return (s % 1 === 0 ? String(s) : s.toFixed(1)) + 's';
      return Math.floor(s / 60) + ' 分 ' + Math.round(s % 60) + ' 秒';
    }
    function fmtSpeed(bps) {
      if (!bps && bps !== 0) return '';
      const m = bps / 1048576;
      if (m >= 1) return m.toFixed(2) + ' MiB/s';
      return (bps / 1024).toFixed(1) + ' KiB/s';
    }
    /* 已用时:独立 1s 走秒(整秒),避免 500ms 轮询重渲染时数字逐帧变化 → 视觉闪动 */
    function ElapsedText(props) {
      const startedAt = props.startedAt;
      const [now, setNow] = useState(Date.now());
      useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
      }, []);
      if (!startedAt) return null;
      return e('span', { className: props.className || null },
        (props.prefix || '') + fmtElapsed(Math.floor((now - startedAt) / 1000) * 1000));
    }

    /* 实时传输行:仓库 + 方向 + 字节 + 速度 + 百分比进度条(数据来自 /api/progress 的 transfer,
       由宿主端解析 git --progress 的 stderr 得到) */
    function TransferLine(props) {
      const t = props.t;
      if (!t) return null;
      const dir = t.op === 'push' ? '上传' : '下载';
      const parts = [];
      if (t.label) parts.push(t.label + ':');
      if (t.size != null) parts.push(dir + ' ' + fmtBytes(t.size));
      if (t.speed != null) parts.push(fmtSpeed(t.speed));
      if (t.pct != null) parts.push(t.pct + '%');
      if (t.done != null && t.total != null) parts.push(t.done + ' / ' + t.total + ' 个数据对象');
      const bar = (t.pct != null)
        ? e('div', { className: 'dss-bar', role: 'progressbar', 'aria-label': dir + '进度（当前步骤）', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.max(0, Math.min(100, t.pct)) }, e('div', { className: 'dss-bar-in', style: { width: Math.max(0, Math.min(100, t.pct)) + '%' } }))
        : null;
      return e('div', { className: 'dss-tx' }, parts.join(' · '), bar);
    }
    function useSync() {
      const [busy, setBusy] = useState(false);
      const [status, setStatus] = useState(null);
      const [progress, setProgress] = useState(null);
      const [statusError, setStatusError] = useState('');
      const [review, setReview] = useState(null);
      const pollRef = useRef(null);
      const runStartedAt = useRef(0);
      const stopPoll = useCallback(() => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }, []);
      const startPoll = useCallback(() => {
        stopPoll();
        const tick = () => API.progress().then(setProgress).catch(() => {});
        tick();
        // 1s 轮询:阶段标签/传输条本身有 CSS 过渡,1s 足够跟手;
        // 侧栏按钮与设置分节各有一份 useSync,500ms 时两边合计每秒 4 次请求
        pollRef.current = setInterval(tick, 1000);
      }, [stopPoll]);
      const refresh = useCallback(() => {
        return API.status().then((d) => {
          if (!d || !d.ok) throw new Error((d && d.error) || '无法读取同步状态');
          setStatus(d); setStatusError('');
          setReview(d.lastDetail?.needsReview && !d.lastDetail.privacy ? d.lastDetail.review : null);
        }).catch((err) => setStatusError('无法读取同步状态：' + (err.message || String(err))));
      }, []);
      const run = useCallback(async (anchor, approval) => {
        if (busy) return;
        runStartedAt.current = Date.now();
        setBusy(true);
        setProgress(null);
        startPoll();
        try {
          const d = await API.run(approval);
          setReview(d?.detail?.needsReview && !d.detail.privacy ? d.detail.review : null);
          if (d?.detail?.needsReview) {
            bubble(anchor, '等待确认同步预览，请打开“同步”查看并继续。', false); return;
          }
          bubble(anchor, (d && d.summary) || (d && d.error) || '同步完成', Boolean(d && (d.ok || d.detail?.cancelled)));
        } catch (err) {
          bubble(anchor, err.message || String(err), false);
        } finally {
          stopPoll();
          setBusy(false);
          refresh();
          API.progress().then(setProgress).catch(() => {});
        }
      }, [busy, refresh, startPoll, stopPoll]);
      useEffect(() => {
        refresh();
        // Also observe automatic syncs and runs started from the other slot.
        const timer = setInterval(() => {
          refresh();
          API.progress().then(setProgress).catch(() => {});
        }, 3000);
        return () => { clearInterval(timer); stopPoll(); };
      }, [refresh, stopPoll]);
      // The previous run's finished record can answer before the server starts this one;
      // while this slot is starting a run, time it from the click instead of that old start.
      const current = busy && !(progress && progress.running)
        ? { running: true, stage: 'prepare', label: '准备同步…', startedAt: runStartedAt.current }
        : progress;
      return { busy: busy || Boolean(progress && progress.running), status, statusError, progress: current, refresh, run,
        review: review || (status?.lastDetail?.needsReview && !status.lastDetail.privacy ? status.lastDetail.review : null) };
    }

    /* 同步进行中的常驻进度气泡:贴在锚点元素上方,实时显示阶段与耗时 */
    function ProgressTip(props) {
      const anchorRef = props.anchorRef;
      const p = props.progress || {};
      const [pos, setPos] = useState(null);
      useEffect(() => {
        const update = () => {
          const el = anchorRef && anchorRef.current;
          if (!(el && el.getBoundingClientRect)) return;
          const r = el.getBoundingClientRect();
          const width = Math.min(260, Math.max(1, window.innerWidth - 24));
          setPos({
            width,
            left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)),
            top: Math.max(12, r.top - 10),
          });
        };
        update();
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
      }, [anchorRef, p.stage, p.label]);
      if (!pos) return null;
      return e('div', {
        className: 'dss-bubble dss-progress',
        style: { width: pos.width + 'px', left: pos.left + 'px', top: pos.top + 'px', transform: 'translateY(-100%)', transition: 'none' },
      }, e('div', { className: 'dss-progress-head' },
        e('span', { className: 'dss-progress-label' }, '⟳ ' + (p.label || '同步中…')),
        p.startedAt ? e(ElapsedText, { startedAt: p.startedAt, className: 'dss-progress-time' }) : null),
        p.transfer ? e(TransferLine, { t: p.transfer }) : null);
    }

    // Shared request for the sidebar and settings; never poll alongside sync progress.
    let updateRequest = null, updateRequestExpires = 0;
    const updateShown = new Set();
    function loadUpdate() {
      if (!updateRequest || Date.now() >= updateRequestExpires) {
        updateRequestExpires = Date.now() + 6 * 60 * 60 * 1000;
        updateRequest = API.update().then((data) => {
          if (!data || !data.ok) updateRequestExpires = Date.now() + 10 * 60 * 1000;
          return data;
        }).catch(() => { updateRequestExpires = Date.now() + 10 * 60 * 1000; return null; });
      }
      return updateRequest;
    }
