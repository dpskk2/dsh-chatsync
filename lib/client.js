/**
 * dsh-chatsync 浏览器端 bundle
 *
 * - 侧栏底部「⟳ 同步」按钮:sidebar.footer.action 槽位原生注入(宽侧栏显示图标+文字,
 *   收起侧栏自动变成纯图标);同步进行中实时显示当前阶段(取远端/提交/推送…)与耗时,
 *   按钮上方有常驻进度气泡;
 * - 设置面板「同步」分节:同步状态卡(远端 / 分支 / 模式 / 工作区数 / 上次结果,含详细
 *   错误信息)+「立即同步」胶囊按钮;
 *
 * 挂载方式:声明了 dsh.client 的依赖由 dsh 自动打包进浏览器 bundle,无需手工注入。
 */
// dsh-chatsync 浏览器端 bundle
window.__ModuleLoader__.load({
  id: '@dpskk2/dsh-chatsync',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const react = require('react');
    const e = react.createElement;
    const { useState, useEffect, useRef, useMemo, useCallback } = react;

    /* ---------- API ---------- */
    const API = {
      run: () => fetch('/dsh-sync/api/run', { method: 'POST' }).then((r) => r.json()),
      status: () => fetch('/dsh-sync/api/status').then((r) => r.json()),
      progress: () => fetch('/dsh-sync/api/progress').then((r) => r.json()),
      config: () => fetch('/dsh-sync/api/config').then((r) => r.json()),
      saveConfig: (patch) => fetch('/dsh-sync/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).then((r) => r.json()),
      conflicts: () => fetch('/dsh-sync/api/conflicts').then((r) => r.json()),
      conflictPreview: (c) => fetch('/dsh-sync/api/conflict/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: c.path, copy: c.copy }),
      }).then((r) => r.json()),
      workspacePath: (workspaceId, path) => fetch('/dsh-sync/api/workspace/path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, path }),
      }).then((r) => r.json()),
      restart: () => fetch('/dsh-sync/api/restart', { method: 'POST' }).then((r) => r.json()),
    };

    /* 气泡提示:挂在触发元素附近,结果反馈保留较长时间便于排障(8s 后淡出) */
    function bubble(anchor, text, ok) {
      try {
        const b = document.createElement('div');
        b.className = 'dss-bubble';
        if (!ok) b.classList.add('dss-bubble-err');
        b.textContent = (ok ? '✓ ' : '✗ ') + String(text || '');
        document.body.appendChild(b);
        const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
        if (r) {
          const left = Math.max(12, Math.min(r.left, window.innerWidth - b.offsetWidth - 12));
          const top = Math.max(12, r.top - b.offsetHeight - 10);
          b.style.left = left + 'px';
          b.style.top = top + 'px';
        } else {
          b.style.left = '16px';
          b.style.bottom = '16px';
        }
        setTimeout(() => { b.style.opacity = '0'; }, 8000);
        setTimeout(() => { b.remove(); }, 8600);
      } catch { /* ignore */ }
    }

    const STYLE = [
      /* 侧栏底部同步按钮(对齐原生设置功能键:hairline 圆角胶囊) */
      '.dss-foot{display:flex;align-items:center}',
      '.dss-foot-btn{display:inline-flex;align-items:center;gap:6px;flex:none;box-sizing:border-box;height:28px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.4));border-radius:14px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:12px;line-height:20px;cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s}',
      '.dss-foot-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));border-color:var(--dsw-alias-border-l4,rgba(127,127,127,.55))}',
      '.dss-foot-btn:active{background:var(--dsw-alias-interactive-bg-pressed,rgba(127,127,127,.22))}',
      '.dss-foot-btn:disabled{opacity:.5;cursor:default}',
      '@keyframes dss-spin{to{transform:rotate(360deg)}}',
      /* 结果/进度气泡 */
      '.dss-bubble{position:fixed;z-index:2147483000;max-width:340px;padding:8px 12px;border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-2,rgba(26,26,30,.95));color:var(--dsw-alias-label-primary,#e9e9ee);',
      'border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.3));font-size:12px;line-height:1.55;white-space:pre-wrap;',
      'box-shadow:var(--dsw-elevation-prominent,0 2px 8px rgba(0,0,0,.3));transition:opacity .3s}',
      '.dss-bubble-err{color:var(--dsw-alias-state-error-primary,#f2b8b8)}',
      /* 进度气泡(常驻,直到同步结束) */
      '.dss-progress{white-space:nowrap}',
      /* 实时传输行 + 百分比进度条(上传/下载字节与速度) */
      '.dss-tx{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.78));margin-top:4px;white-space:nowrap}',
      '.dss-bar{height:3px;border-radius:2px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.22));overflow:hidden;margin-top:4px;min-width:150px}',
      '.dss-bar-in{height:100%;background:var(--dsw-alias-accent-color,rgba(110,168,254,.85));transition:width .25s}',
      /* 设置分节:对齐原生设置——无框无底色,组间 hairline 分隔 */
      '.dss-wrap{display:flex;flex-direction:column;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,inherit)}',
      '.dss-sec{display:flex;flex-direction:column;padding:20px 0;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22))}',
      '.dss-sec:last-child{border-bottom:none}',
      '.dss-rowline{display:flex;align-items:center;gap:12px}',
      '.dss-rowtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}',
      '.dss-h{color:var(--dsw-alias-label-primary,inherit);font-size:14px;font-weight:400;line-height:22px}',
      '.dss-desc{color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8));font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-all}',
      '.dss-prog{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-tertiary,rgba(127,127,127,.8)));font-size:12px;line-height:18px}',
      /* pill 控件:原生设置同款 hairline 圆角胶囊 */
      '.dss-pill{display:inline-flex;align-items:center;gap:6px;flex:none;box-sizing:border-box;height:32px;padding:0 14px;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.4));border-radius:18px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px;line-height:20px;cursor:pointer}',
      '.dss-pill:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
      '.dss-pill:disabled{opacity:.5;cursor:default}',
      '.dss-select{max-width:100%;padding:6px 10px;border:1px solid var(--dsw-alias-border-l4,rgba(127,127,127,.4));border-radius:8px;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#222);font:inherit}',
      '.dss-wrap fieldset:disabled{opacity:.65}',
      '.dss-wrap a{color:var(--dsw-alias-accent-color,#3979df)}',
      '.dss-wrap a{text-decoration:underline;text-underline-offset:3px}',
      '.dss-wrap .dss-h{font-size:15px;font-weight:600}',
      '.dss-wrap .dss-desc{font-size:14px;line-height:1.7;color:var(--dsw-alias-label-secondary,inherit);word-break:normal;overflow-wrap:anywhere}',
      '.dss-wrap .dss-err,.dss-wrap .dss-confmeta{font-size:13px;line-height:1.65;overflow-wrap:anywhere}',
      '.dss-field{display:flex;flex-direction:column;gap:6px;margin-top:14px}',
      '.dss-input{box-sizing:border-box;width:100%;padding:9px 12px;border:1px solid var(--dsw-alias-border-l4,#888);border-radius:8px;background:var(--dsw-alias-bg-layer-2,transparent);color:inherit;font:inherit;min-width:0}',
      /* 数字输入(自动同步间隔)只需要窄条,不占满整行 */
      '.dss-input-num{width:88px;flex:none;padding:6px 10px}',
      '.dss-links{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:12px;font-size:14px}',
      '.dss-guide{margin:12px 0;padding:14px 18px;border:1px solid var(--dsw-alias-border-l2,#888);border-radius:12px;line-height:1.7}',
      '.dss-guide ol{margin:8px 0;padding-left:22px}.dss-guide li+li{margin-top:6px}',
      '.dss-onboarding{padding:20px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:16px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04));margin:8px 0 20px}',
      '.dss-onboarding-title{font-size:20px;line-height:1.4;font-weight:650;margin-bottom:8px}',
      '.dss-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:18px 0}',
      '.dss-step-link{display:flex;align-items:center;gap:8px;padding:10px 8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:10px;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}',
      '.dss-step-link[aria-current="step"]{border-color:var(--dsw-alias-accent-color,#3979df);background:var(--dsw-alias-interactive-bg-active,rgba(57,121,223,.1))}',
      '.dss-step-number{display:inline-flex;align-items:center;justify-content:center;flex:none;width:26px;height:26px;border-radius:50%;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));font-size:13px;font-weight:650}',
      '.dss-step-heading{display:flex;align-items:center;gap:10px;margin-bottom:10px}',
      '.dss-next{padding:12px 14px;border-left:3px solid var(--dsw-alias-accent-color,#3979df);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.06));border-radius:0 8px 8px 0}',
      '.dss-notice-label{font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary,inherit);margin-bottom:4px}',
      '.dss-primary{background:var(--dsw-alias-accent-color,#3979df);border-color:transparent;color:#fff;font-weight:600}',
      '.dss-wrap .dss-primary:hover{background:var(--dsw-alias-accent-color,#3979df);filter:brightness(.95)}',
      '.dss-tip{margin-top:12px;padding:12px 14px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.06))}',
      '.dss-command{display:block;margin:8px 0;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));font-family:monospace;user-select:text}',
      '.dss-sec[id]{scroll-margin-top:16px}.dss-complete{display:flex;flex-direction:column;gap:10px}',
      '@media(max-width:600px){.dss-steps{grid-template-columns:repeat(2,minmax(0,1fr))}.dss-onboarding{padding:16px}.dss-step-link{min-height:44px}}',
      '.dss-wrap :is(button,input,select,a,summary):focus-visible{outline:2px solid var(--dsw-alias-accent-color,#3979df);outline-offset:3px}',
      '.dss-wrap summary{cursor:pointer;margin:8px 0;font-size:14px}',
      '@media(max-width:480px){.dss-wrap .dss-rowline{flex-wrap:wrap}.dss-wrap .dss-pill{min-height:36px}.dss-wrap .dss-rowtext{flex-basis:100%}}',
      '.dss-restartrow{padding-top:10px;margin-top:2px}',
      /* switch 开关:对齐原生设置(胶囊轨道 + 滑动圆钮) */
      '.dss-switch{position:relative;flex:none;box-sizing:border-box;width:36px;height:20px;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.45));border-radius:11px;background:rgba(127,127,127,.12);cursor:pointer;transition:background .15s,border-color .15s;padding:0}',
      '.dss-switch-on{background:var(--dsw-alias-interactive-bg-active,rgba(90,160,255,.35));border-color:rgba(90,160,255,.55)}',
      '.dss-switch-knob{position:absolute;top:2.5px;left:2.5px;width:13px;height:13px;border-radius:50%;background:var(--dsw-alias-label-secondary,rgba(127,127,127,.85));transition:left .15s,background .15s}',
      '.dss-switch-on .dss-switch-knob{left:18.5px;background:var(--dsw-alias-label-primary,#fff)}',
      '.dss-err{color:var(--dsw-alias-state-error-primary,#d33);font-size:12px;margin:6px 0;white-space:pre-wrap;word-break:break-all}',
      '.dss-ok{color:var(--dsw-alias-state-success-primary,#9cd29c);font-size:12px;margin:6px 0;white-space:pre-wrap;word-break:break-all}',
      /* 冲突(「双边保留」)行 */
      '.dss-confrow{display:flex;flex-direction:column;gap:4px;padding:8px 0}',
      '.dss-confpath{color:var(--dsw-alias-label-primary,inherit);font-size:12px;word-break:break-all}',
      '.dss-confmeta{color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.7));font-size:11px;word-break:break-all}',
      '.dss-cachehint{color:var(--dsw-alias-state-warn-label,#e6b455)}',
      '.dss-confbtns{display:flex;gap:6px;flex-wrap:wrap}',
      '.dss-confbtn{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.4));border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:12px;line-height:18px;cursor:pointer}',
      '.dss-confbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
      '.dss-confbtn:disabled{opacity:.5;cursor:default}',
      '.dss-confprev{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px;border-top:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));padding-top:8px}',
      '.dss-confprev .dss-pv{max-height:320px;overflow:auto;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:10px;padding:10px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05))}',
      '.dss-prevhead{font-size:11px;font-weight:500;line-height:16px;color:var(--dsw-alias-label-secondary,rgba(127,127,127,.85));margin-bottom:6px}',
      '.dss-wsbanner{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}',
      '.dss-wsbanner:first-of-type{border-top:none}',
      '.dss-wsbanner-text{flex:1;min-width:0}',
      '.dss-wsbanner-title{font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-primary,inherit)}',
      '.dss-empty{color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.6));font-size:12px;margin:8px 0}',
      /* —— 操作按钮 —— */
      '.dss-btn{display:inline-flex;align-items:center;gap:5px;flex:none;box-sizing:border-box;height:28px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.4));border-radius:14px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s,color .12s}',
      '.dss-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
      '.dss-btn:disabled{opacity:.45;cursor:default;background:transparent}',
      '.dss-btn-del{color:var(--dsw-alias-state-error-primary,#f2b8b8);border-color:rgba(244,120,120,.35)}',
      '.dss-btn-del:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(240,90,90,.16));border-color:rgba(244,120,120,.55)}',
      /* —— 预览面板:消息气泡 —— */
      '.dss-pv{display:flex;flex-direction:column;gap:12px}',
      '.dss-pv-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}',
      '.dss-pv-title{font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-primary,inherit);max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dss-pv-count{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.75))}',
      '.dss-pv-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8));padding:2px 0}',
      '.dss-pv-list{display:flex;flex-direction:column;gap:12px}',
      '.dss-msg{display:flex;flex-direction:column;gap:3px}',
      '.dss-msg-role{font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.7))}',
      '.dss-msg-text{font-size:12px;line-height:20px;white-space:pre-wrap;word-break:break-word;border-radius:10px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}',
      '.dss-msg-user .dss-msg-text{border-color:rgba(110,168,254,.32)}',
      /* —— 重启引导浮层(shell.overlay 列表槽位,左下角常驻卡片) ——
         层级取舍:overlayLayer 自身是 z-index:20 且 pointer-events:none(条目需自行开启),
         设置面板/对话框由 createPortal 挂到 document.body 且 z-index:1000 ——
         所以卡片只取 40(仅决定 overlay 层内条目互相盖住的顺序,层本身仍在 1000 之下),
         设置面板打开时卡片被面板遮罩盖住,不会遮挡面板或对话框。
         bottom:92px 而非 16px:overlay 层浮在侧栏列之上,贴底会正好压住侧栏底部
         「设置 / ⟳ 同步」按钮区(约 80px 高),把引导自己的入口挡住;抬高到 92px 让出入口,
         视觉上仍在左下角。 */
      '.dss-rg{position:fixed;left:16px;bottom:92px;z-index:40;pointer-events:auto;box-sizing:border-box;max-width:min(320px,calc(100vw - 32px));padding:12px 14px;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.4));border-radius:14px;background:var(--dsw-alias-bg-layer-2,rgba(26,26,30,.97));color:var(--dsw-alias-label-primary,#e9e9ee);box-shadow:var(--dsw-elevation-prominent,0 2px 8px rgba(0,0,0,.3));font-size:12px;line-height:18px;text-align:left}',
      '.dss-rg-title{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:500;line-height:20px}',
      '.dss-rg-body{margin-top:6px;color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-tertiary,rgba(127,127,127,.85)))}',
      '.dss-rg-warn{margin-top:6px;color:var(--dsw-alias-state-warn-label,#e6b455)}',
      '.dss-rg-ids{margin-top:2px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.78));font-size:11px;line-height:16px;word-break:break-all}',
      '.dss-rg-acts{display:flex;align-items:center;gap:8px;margin-top:10px}',
    ].join('\n');

    /* ---------- 同步图标 ---------- */
    function SyncIcon(props) {
      const spin = props.spin
        ? { animation: 'dss-spin .9s linear infinite' }
        : undefined;
      return e('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', style: spin, 'aria-hidden': true },
        e('path', { d: 'M13.6 6.4A6 6 0 1 0 14 8', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        e('path', { d: 'M13.8 2.6v3.8h-3.8', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }));
    }

    /* ---------- 同步状态共享(含实时进度轮询) ---------- */
    const STAGE_SHORT = {
      prepare: '准备', fetch: '取远端', commit: '提交', analyze: '比对',
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
      const bar = (t.pct != null && t.total != null)
        ? e('div', { className: 'dss-bar' }, e('div', { className: 'dss-bar-in', style: { width: Math.max(0, Math.min(100, t.pct)) + '%' } }))
        : null;
      return e('div', { className: 'dss-tx' }, parts.join(' · '), bar);
    }
    function useSync() {
      const [busy, setBusy] = useState(false);
      const [status, setStatus] = useState(null);
      const [progress, setProgress] = useState(null);
      const [statusError, setStatusError] = useState('');
      const pollRef = useRef(null);
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
        }).catch((err) => setStatusError('无法读取同步状态：' + (err.message || String(err))));
      }, []);
      const run = useCallback(async (anchor) => {
        if (busy) return;
        setBusy(true);
        startPoll();
        try {
          const d = await API.run();
          bubble(anchor, (d && d.summary) || (d && d.error) || '同步完成', Boolean(d && d.ok));
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
      return { busy: busy || Boolean(progress && progress.running), status, statusError, progress, refresh, run };
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
          const width = Math.min(360, Math.max(160, String(p.label || '').length * 13 + 80));
          setPos({
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
        style: { left: pos.left + 'px', top: pos.top + 'px', transform: 'translateY(-100%)', transition: 'none' },
      }, e('span', null, '⟳ ' + (p.label || '同步中…')),
        p.startedAt ? e(ElapsedText, { startedAt: p.startedAt, prefix: ' · ' }) : null,
        p.transfer ? e(TransferLine, { t: p.transfer }) : null);
    }

    /* ---------- 侧栏底部「⟳ 同步」按钮 ---------- */
    function FootSyncButton(props) {
      const wide = props.wide !== false;
      const ref = useRef(null);
      const { busy, status, progress, run, refresh } = useSync();
      const stage = STAGE_SHORT[progress && progress.stage] || '';
      const label = busy ? (stage ? stage + '…' : '同步中…') : '同步';
      const title = (status && status.remote
        ? `一键同步 → ${status.branch}\n${status.remote}`
        : '尚未连接仓库：首次同步会尝试自动建仓。\n请先登录 GitHub，或在「设置 → 同步」填写已有仓库地址。')
        + (busy ? `\n\n同步中: ${progress ? progress.label : '…'}` : '');
      return e('div', { className: 'dss-foot', ref },
        e('button', {
          type: 'button',
          className: 'dss-foot-btn',
          'aria-label': '同步 DSH 会话数据',
          title,
          disabled: busy,
          onClick: () => { refresh(); run(ref.current); },
        },
          e(SyncIcon, { spin: busy }),
          wide ? e('span', null, label) : null),
        busy ? e(ProgressTip, { anchorRef: ref, progress }) : null);
    }

    /* ---------- 重启引导浮层(shell.overlay):不打开设置页也能看到「未分组 / 需重启」引导 ---------- */
    /* 「稍后」只记在本次浏览器会话:键 'dss-restart-guide-dismissed',
       值 = ungroupedCount / restartRequired / restartAvailable 组成的签名 ——
       同一条件下不再自动弹,条件变化(未分组数变了、需重启标记出现或消失)后卡片会重新出现。
       设置页与侧栏的手动重启入口不读这个键,不受影响。 */
    const RESTART_GUIDE_DISMISS_KEY = 'dss-restart-guide-dismissed';
    function restartGuideSignature(status) {
      if (!status) return '';
      const ungrouped = Number(status.ungroupedCount) || 0;
      const required = status.lastDetail && status.lastDetail.restartRequired === true ? 1 : 0;
      const available = status.restartAvailable === false ? 0 : 1;
      return ungrouped + '/' + required + '/' + available;
    }
    function readRestartGuideDismissed() {
      try { return window.sessionStorage.getItem(RESTART_GUIDE_DISMISS_KEY) || ''; } catch { return ''; }
    }
    function writeRestartGuideDismissed(sig) {
      try { if (sig) window.sessionStorage.setItem(RESTART_GUIDE_DISMISS_KEY, sig); } catch { /* ignore */ }
    }
    /* 会话显示名:优先接口给的真实会话名(与侧栏同名),没有就退回工作目录名,最后才用短 id。
       旧版这里直接显示 session-<uuid>,用户看不出是哪次对话。 */
    function sessionDisplayName(item) {
      if (item && typeof item === 'object' && typeof item.name === 'string' && item.name.trim()) return item.name.trim();
      const id = String((item && item.id) || item || '');
      const cwd = String((item && item.cwd) || '').replace(/[\\/]+$/, '');
      const base = cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : '';
      if (base) return base;
      const uuid = id.replace(/^session-/, '');
      return uuid ? uuid.slice(0, 8) : '未知会话';
    }
    /* 活跃会话列表:优先接口的 activeSessions(带会话名);只有 id 的旧接口退化为短 id */
    function activeSessionsOf(status) {
      const list = status && status.activeSessions;
      if (Array.isArray(list) && list.length) {
        return list.filter((x) => x && x.id).map((x) => ({ id: String(x.id), name: x.name || '', cwd: x.cwd || '' }));
      }
      const ids = Array.isArray(status && status.activeSessionIds) ? status.activeSessionIds : [];
      return ids.map((id) => ({ id: String(id), name: '', cwd: '' }));
    }
    function activeNamesText(list) {
      const all = Array.isArray(list) ? list : [];
      const shown = all.slice(0, 3).map(sessionDisplayName).filter(Boolean);
      if (!shown.length) return '';
      return shown.join('、') + (all.length > shown.length ? ' 等 ' + all.length + ' 个' : '');
    }
    /* 重启前确认文案:有会话正在生成时按**会话名**列出(最多 3 个),再说清会打断什么、重启后怎么恢复。
       浮层与设置页共用同一份文案,避免两处漂移。 */
    function restartConfirmText(status) {
      const n = Number(status && status.activeSessionCount) || 0;
      const names = activeNamesText(activeSessionsOf(status));
      const target = status && status.hostKind === 'desktop' ? '桌面端' : 'Web 端';
      if (n > 0) {
        return '正在生成 ' + n + ' 个会话：' + (names ? '\n  · ' + names : '') + '\n\n重启' + target + '会打断它们'
          + (status && status.hostKind === 'desktop' ? '，应用会关闭并重新打开' : '，浏览器会短暂断开')
          + '。\n\n确定立即重启吗？';
      }
      return '重启' + target + (status && status.hostKind === 'desktop' ? '会关闭并重新打开应用' : '会断开当前页面')
        + '，让侧栏重新加载会话分组。\n\n确定立即重启吗？';
    }
    /* 统一的 /api/restart 结果反馈:成功 / 被守卫拦下(HTTP 409,body 仍是 JSON) / 一般失败 */
    function reportRestartResult(d, anchor) {
      if (d && d.ok) { bubble(anchor, d.message || '已调度重启，页面将断开并刷新', true); return; }
      if (d && d.blockedBy === 'active-session') {
        const n = Number(d.activeCount) || 0;
        const names = activeNamesText((Array.isArray(d.activeIds) ? d.activeIds : []).map((id) => ({ id: String(id) })));
        bubble(anchor, '重启被拦下：仍有 ' + n + ' 个会话正在生成'
          + (names ? '（' + names + '）' : '') + '，请等它们结束后再试。'
          + (d.error ? '\n' + d.error : ''), false);
        return;
      }
      bubble(anchor, (d && d.error) || '重启失败', false);
    }

    function RestartGuideOverlay() {
      /* 复用侧栏/设置页同一套状态轮询(useSync 内 3s 一次 /api/status),不新增高频轮询 */
      const { busy, status, refresh } = useSync();
      const [restarting, setRestarting] = useState(false);
      const [dismissed, setDismissed] = useState(readRestartGuideDismissed);
      const ungrouped = Number(status && status.ungroupedCount) || 0;
      const restartRequired = !!(status && status.lastDetail && status.lastDetail.restartRequired === true);
      const activeCount = Number(status && status.activeSessionCount) || 0;
      const activeNames = activeNamesText(activeSessionsOf(status));
      const restartAvailable = !!status && status.restartAvailable !== false;
      const isDesktop = !!status && status.hostKind === 'desktop';
      const hostLabel = isDesktop ? '桌面应用' : 'Web 端';
      const sig = restartGuideSignature(status);
      /* 显示条件:ungroupedCount > 0 或 lastDetail.restartRequired === true;
         隐藏条件由同一份轮询状态驱动 —— 重启后新实例 ungroupedCount 归 0 / restartRequired 消失时卡片自动消失 */
      if (!status || !(ungrouped > 0 || restartRequired)) return null;
      if (dismissed && dismissed === sig) return null;
      const doRestart = (anchor) => {
        if (restarting || busy || status.restartAvailable === false) return;
        if (!window.confirm(restartConfirmText(status))) return;
        setRestarting(true);
        API.restart()
          .then((d) => { reportRestartResult(d, anchor); if (!(d && d.ok)) refresh(); })
          .catch((err) => bubble(anchor, err.message || String(err), false))
          .finally(() => setRestarting(false));
      };
      const dismiss = () => { writeRestartGuideDismissed(sig); setDismissed(sig); };
      const buttonLabel = restarting ? '调度中…'
        : activeCount > 0 ? '仍要重启（打断 ' + activeCount + ' 个会话）'
          : '立即重启并归位';
      /* 非模态:不抢焦点、不锁滚动,只作左下角提示(role=region 而非 status,避免里面的按钮文案被当状态播报)
         文案顺序按用户实际关心的问题:①有没有未分组会话 ②点重启能处理好 ③重启会打断什么(列会话名) ④怎么重启 */
      return e('div', { className: 'dss-rg', role: 'region', 'aria-label': '同步重启引导' },
        e('div', { className: 'dss-rg-title' },
          e('span', { 'aria-hidden': true }, '⟳'),
          ungrouped > 0 ? ungrouped + ' 个会话未分组' : '会话分组需要重启生效'),
        e('div', { className: 'dss-rg-body' },
          ungrouped > 0
            ? '同步已按原工作区把这些会话分好组，重启后它们就回到侧栏对应的工作区。'
            : '同步已更新会话分组，重启后侧栏才会按最新分组显示。'),
        activeCount > 0
          ? e('div', { className: 'dss-rg-warn' }, '重启会打断 ' + activeCount + ' 个正在生成的会话'
            + (activeNames ? '：' + activeNames : '') + '。')
          : null,
        restartAvailable
          ? null
          : e('div', { className: 'dss-rg-body' }, '这台电脑无法自动重启，请手动退出' + hostLabel + '后重新打开。'),
        e('div', { className: 'dss-rg-acts' },
          /* restartAvailable === false 时不显示主按钮,只给文字指引 */
          restartAvailable
            ? e('button', {
                type: 'button',
                className: 'dss-btn' + (activeCount > 0 ? ' dss-btn-del' : ''),
                disabled: restarting || busy,
                title: activeCount > 0
                  ? '仍要重启:会打断正在生成的会话（' + (activeNames || activeCount + ' 个') + '）'
                  : '立即重启' + hostLabel + '，重启后侧栏按最新分组显示',
                onClick: (ev) => doRestart(ev.currentTarget),
              }, buttonLabel)
            : null,
          e('button', { type: 'button', className: 'dss-btn', onClick: dismiss }, '稍后')));
    }

    /* ---------- 设置分节:同步状态卡(只读状态 + 立即同步) ---------- */
    /* 字节数 → 可读文本(与宿主端 humanSize 同规则) */
    function fmtBytes(b) {
      if (!b && b !== 0) return '';
      const abs = Math.abs(b);
      if (abs >= 1024 ** 3) return (b / 1024 ** 3).toFixed(2) + ' GiB';
      if (abs >= 1024 ** 2) return (b / 1024 ** 2).toFixed(2) + ' MiB';
      if (abs >= 1024) return (b / 1024).toFixed(1) + ' KiB';
      return b + ' B';
    }
    /* 把上次结果(含错误明细)渲染成一段可排障的文本 */
    function lastDetailText(lastDetail) {
      if (!lastDetail) return '';
      const lines = [];
      const act = [];
      if (lastDetail.committed) act.push('提交');
      if (lastDetail.pushed) act.push('推送');
      if (lastDetail.pulled && lastDetail.pulled !== 'reset') act.push('拉取(' + lastDetail.pulled + ')');
      if (lastDetail.pulled === 'reset') act.push('整体取回');
      if (act.length) lines.push('本次动作: ' + act.join(' / '));
      if (lastDetail.durationMs != null) lines.push('耗时: ' + (lastDetail.durationMs / 1000).toFixed(1) + 's');
      if (lastDetail.transfers && lastDetail.transfers.length) {
        lines.push('传输:');
        for (const t of lastDetail.transfers) {
          const dir = t.op === 'push' ? '上传' : '下载';
          lines.push('  - ' + (t.label || t.op) + ': ' + dir + ' ' + fmtBytes(t.size)
            + (t.speed != null ? ' @ ' + (t.speed / 1024 / 1024).toFixed(2) + ' MiB/s' : '')
            + (t.totalObjects != null ? ' (' + t.totalObjects + ' 对象' + (t.reused ? ',复用 ' + t.reused : '') + ')' : ''));
        }
      }
      if (lastDetail.repoSize != null) lines.push('仓库体积: ' + fmtBytes(lastDetail.repoSize));
      if (lastDetail.stages && lastDetail.stages.length) {
        const st = lastDetail.stages.filter((s) => s.ms >= 50);
        if (st.length) {
          lines.push('阶段耗时:');
          for (const s of st) lines.push('  - ' + s.stage + ': ' + (s.ms / 1000).toFixed(1) + 's');
        }
      }
      if (lastDetail.skipped) lines.push('跳过: ' + lastDetail.skipped);
      for (const w of lastDetail.sessionWarnings || []) lines.push('会话未混合合并: ' + w.path + '；当前保留' + (w.kept === 'remote' ? '远端' : '本机') + '；本机原件 ' + w.localHead + '；远端原件 ' + w.remoteHead);
      if (lastDetail.backupBranch) lines.push('备份分支: ' + lastDetail.backupBranch + (lastDetail.backupPushed === true ? '（已上传）' : '（仅在本机，上传失败）'));
      if (lastDetail.error) lines.push('主数据错误: ' + lastDetail.error);
      if (lastDetail.workspaces) {
        const w = lastDetail.workspaces;
        for (const b of w.backups || []) lines.push('工作区 ' + b.id + ' 备份分支: ' + b.branch + (b.pushed ? '（已上传）' : '（仅在本机，上传失败）'));
        if (w.total) lines.push('工作区: 共 ' + w.total + ',已同步 ' + w.synced + ',推送 ' + w.pushed + ',拉取 ' + w.pulled + (w.skipped ? ',跳过 ' + w.skipped : ''));
        if (w.errors && w.errors.length) {
          lines.push('工作区失败(' + w.errors.length + '):');
          for (const err of w.errors) lines.push('  - ' + (err.title || err.id || '?') + ': ' + (err.error || '未知错误'));
        }
      }
      if (lastDetail.conflictCopies && lastDetail.conflictCopies.length) {
        lines.push('遗留冲突副本(' + lastDetail.conflictCopies.length + ') 待清理:');
        for (const c of lastDetail.conflictCopies) {
          lines.push('  - ' + (c.kind === 'ws' ? '[工作区' + (c.id || '?') + '] ' : '') + c.path + (c.copy ? '\n      远端版本: ' + c.copy : ''));
        }
      }
      return lines.join('\n');
    }

    /* ---------- 遗留冲突副本(只读):新版分层合并已自动合并冲突,这里仅做审计/预览 ----------
       旧版本会为「双边保留」写 .dsh-conflict-<时间戳> 拷贝,并需用户在界面裁决保留哪一侧;
       分层合并引擎上线后同步不再生成新拷贝(见 lib/sync.js / lib/index.js 的 sync_conflicts 工具说明),
       且服务端已无 /dsh-sync/api/conflict/resolve 路由 —— 三者(保留本机/采用远端/两侧都留)点击只会 404,
       因此本组件只保留只读预览,不再提供裁决按钮。 */
    function ConflictRow(props) {
      const c = props.conflict;
      const [preview, setPreview] = useState(null); // null | 'loading' | {local, remote}
      const [showPrev, setShowPrev] = useState(false);
      const label = (c.kind === 'ws' ? '[工作区' + (c.id || '?') + '] ' : '') + (c.title || c.path);
      const onPreview = () => {
        if (showPrev) { setShowPrev(false); return; }
        setShowPrev(true);
        if (preview) return;
        setPreview('loading');
        API.conflictPreview(c)
          .then((d) => { setPreview(d && d.ok ? d : null); if (!(d && d.ok)) bubble(null, (d && d.error) || '预览失败', false); })
          .catch((err) => { setPreview(null); bubble(null, err.message || String(err), false); });
      };
      const renderMsgs = (p) => {
        if (!p || p.found === false) return e('div', { className: 'dss-pv-hint' }, p && p.found === false ? '本侧没有文件(可能已被删除)' : '无内容');
        if (p.error) return e('div', { className: 'dss-pv-hint' }, '读取失败: ' + p.error);
        if (p.binary) return e('div', { className: 'dss-pv-hint' }, '二进制文件,无法预览(大小 ' + p.bytes + 'B)');
        if (p.kind === 'text' || (p.text !== undefined && p.messages === undefined)) return e('div', { className: 'dss-pv-diff' },
          e('pre', { className: 'dss-pv-pre', style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, fontSize: '12px', lineHeight: 1.5 } }, p.text || '(空文件)'));
        return e('div', { className: 'dss-pv-list' }, p.messages.map((m, i) => e('div', { key: i, className: 'dss-msg' + (m.role === 'user' ? ' dss-msg-user' : '') },
          e('div', { className: 'dss-msg-role' }, m.role === 'user' ? '你' : '助手'),
          e('div', { className: 'dss-msg-text' }, m.text))));
      };
      return e('div', { className: 'dss-confrow' },
        e('div', { className: 'dss-confpath', title: c.path }, label),
        e('div', { className: 'dss-confmeta' }, c.copy ? ('远端版本拷贝: ' + c.copy) : '无远端版本拷贝'),
        c.cache ? e('div', { className: 'dss-confmeta dss-cachehint' }, '会话投影缓存(可再生):下次同步会自动清理,无需处理') : null,
        e('div', { className: 'dss-confbtns' },
          e('button', {
            key: 'prev', type: 'button', className: 'dss-confbtn',
            onClick: onPreview,
          }, showPrev ? '收起预览' : '预览两侧')),
        showPrev ? e('div', { className: 'dss-confprev' },
          preview === 'loading' ? e('div', { className: 'dss-pv-hint' }, '正在读取预览…')
            : preview ? (preview.kind === 'text'
              ? e('div', { key: 'd', className: 'dss-pv' }, [
                e('div', { className: 'dss-prevhead' }, '文本差异(本机 vs 远端拷贝,' + (preview.local && preview.local.bytes ? preview.local.bytes + 'B' : '?') + ' vs ' + (preview.remote && preview.remote.bytes ? preview.remote.bytes + 'B' : '?') + ')'),
                e('pre', { className: 'dss-pv-pre', style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, fontSize: '12px', lineHeight: 1.5 } }, preview.diff || '(无差异或无内容)'),
              ])
              : [
                e('div', { key: 'l', className: 'dss-pv' },
                  e('div', { className: 'dss-prevhead' }, '本机版本' + (preview.local ? ' · ' + preview.local.messageCount + ' 条消息' : '')),
                  renderMsgs(preview.local)),
                e('div', { key: 'r', className: 'dss-pv' },
                  e('div', { className: 'dss-prevhead' }, '远端版本' + (preview.remote ? ' · ' + preview.remote.messageCount + ' 条消息' : '')),
                  renderMsgs(preview.remote)),
              ]) : null) : null);
    }

    /* 常用偏好复用已有配置 API；保存后由宿主重建自动调度，无需重启。 */
    const DOCS = 'https://github.com/dpskk2/dsh-chatsync/blob/main/docs/';
    function helpLink(label, href) {
      return e('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label);
    }
    function stepHeading(number, title) {
      return e('div', { className: 'dss-step-heading' },
        e('span', { className: 'dss-step-number', 'aria-hidden': true }, number),
        e('div', { className: 'dss-h' }, title));
    }
    function notice(label, content, className = 'dss-next') {
      return e('div', { className, role: 'status', 'aria-label': label },
        e('div', { className: 'dss-notice-label' }, label), content);
    }
    function ConnectionSettings({ busy, onSaved, remote, branch }) {
      const [config, setConfig] = useState(null);
      const [error, setError] = useState('');
      const [message, setMessage] = useState('');
      const [saving, setSaving] = useState(false);
      const [attempt, setAttempt] = useState(0);
      const dirty = useRef(false);
      useEffect(() => {
        if (dirty.current) return;
        let alive = true;
        setError('');
        API.config().then((d) => {
          if (!d || !d.ok || !d.config) throw new Error((d && d.error) || '无法读取仓库配置');
          if (alive && !dirty.current) setConfig(d.config);
        }).catch((err) => { if (alive) setError(err.message || String(err)); });
        return () => { alive = false; };
      }, [attempt, remote, branch]);
      const change = (patch) => { dirty.current = true; setConfig({ ...config, ...patch }); setMessage(''); setError(''); };
      const save = async (event) => {
        event.preventDefault();
        if (!config || saving || busy) return;
        setSaving(true); setMessage(''); setError('');
        const patch = { remote: (config.remote || '').trim(), branch: (config.branch || '').trim(), autoRepo: config.autoRepo !== false };
        try {
          const d = await API.saveConfig(patch);
          if (!d || !d.ok || !d.config) throw new Error((d && d.error) || '保存失败，请重试');
          setConfig(d.config);
          dirty.current = false;
          const overridden = Object.keys(patch).some((key) => d.config[key] !== patch[key]);
          setMessage(overridden ? '已保存；部分选项由宿主指定，表单已显示实际值。' : '连接已保存，下次同步使用。保存不会验证登录；点「立即同步」检查连接并传输数据。');
          if (onSaved) onSaved();
        } catch (err) { setError(err.message || String(err)); }
        finally { setSaving(false); }
      };
      return e('form', { className: 'dss-sec', id: 'dss-connect', tabIndex: -1, onSubmit: save },
        stepHeading(1, '连接同步仓库'),
        e('div', { className: 'dss-desc' }, '仓库就是两台电脑共用的数据存放处。先按你的情况完成下面一项，再保存连接。'),
        e('div', { className: 'dss-tip' },
          e('div', { className: 'dss-h' }, '第一次使用'),
          e('ol', null,
            e('li', null, '安装 ', helpLink('Git', 'https://git-scm.com/downloads'), ' 和 ', helpLink('GitHub CLI', 'https://cli.github.com/'), '。'),
            e('li', null, '打开 Windows 终端，运行下面的命令，按提示在浏览器登录 GitHub。', e('code', { className: 'dss-command' }, 'gh auth login')),
            e('li', null, '仓库地址留空，保持「自动创建或复用私有仓库」勾选，分支保留 main。')),
          e('div', { className: 'dss-desc' }, '接入第二台电脑：使用相同的 GitHub 账号，填写原电脑的仓库地址和分支。')),
        !config && !error ? e('div', { className: 'dss-desc' }, '正在读取连接设置…') : null,
        error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null,
        !config && error ? e('button', { type: 'button', className: 'dss-pill', onClick: () => setAttempt(attempt + 1) }, '重新读取') : null,
        config ? e('fieldset', { disabled: saving || busy, style: { border: 0, margin: 0, padding: 0, minWidth: 0 } },
          e('label', { className: 'dss-field' }, 'GitHub 私有仓库地址',
            e('input', { className: 'dss-input', type: 'text', value: config.remote || '', placeholder: 'https://github.com/用户名/dsh-sync.git', autoComplete: 'off', spellCheck: false, onChange: (ev) => change({ remote: ev.target.value }) })),
          e('label', { className: 'dss-field' }, '同步分支',
            e('input', { className: 'dss-input', type: 'text', required: true, value: config.branch || '', placeholder: 'main', spellCheck: false, onChange: (ev) => change({ branch: ev.target.value }) })),
          e('label', { className: 'dss-rowline', style: { marginTop: '14px' } },
            e('input', { type: 'checkbox', checked: config.autoRepo !== false, onChange: (ev) => change({ autoRepo: ev.target.checked }) }),
            '地址留空时自动创建或复用私有仓库'),
          e('div', { className: 'dss-desc' }, '默认仓库名：dsh-sync。仅保存本地快照：清空地址，并取消此勾选。'),
          e('button', { type: 'submit', className: 'dss-pill dss-primary', style: { marginTop: '14px' } }, saving ? '保存中…' : '保存连接，继续第 2 步')) : null,
        message ? notice('保存结果', message, 'dss-tip dss-desc') : null,
        e('nav', { className: 'dss-links', 'aria-label': '仓库连接帮助' },
          helpLink('新建私有仓库', 'https://github.com/new'),
          helpLink('GitHub 登录说明', 'https://cli.github.com/manual/gh_auth_login'),
          helpLink('代理与高级配置', DOCS + 'configuration.md')));
    }
    /* 自动同步周期显示:读实际生效值(intervalSeconds,下限 30s),不再写死「每 5 分钟」 */
    function fmtInterval(seconds) {
      const s = Number(seconds);
      if (!Number.isFinite(s) || s <= 0) return '';
      if (s % 60 === 0 && s >= 60) return s / 60 + ' 分钟';
      return Math.round(s) + ' 秒';
    }
    /* 间隔输入框的初始值:秒 → 分钟(去掉多余小数位;非法值留空,保存时不改动现有值) */
    function fmtIntervalMinutes(seconds) {
      const s = Number(seconds);
      if (!Number.isFinite(s) || s <= 0) return '';
      const minutes = s / 60;
      return Number.isInteger(minutes) ? String(minutes) : String(Math.round(minutes * 100) / 100);
    }
    function SyncPreferences({ busy, onSaved }) {
      const [config, setConfig] = useState(null);
      const [error, setError] = useState('');
      const [message, setMessage] = useState('');
      const [saving, setSaving] = useState(false);
      const [attempt, setAttempt] = useState(0);
      const [intervalMinutes, setIntervalMinutes] = useState('');
      useEffect(() => {
        let alive = true;
        setError('');
        API.config().then((d) => {
          if (!alive) return;
          if (!d || !d.ok || !d.config) throw new Error((d && d.error) || '无法读取同步偏好');
          setConfig(d.config);
          setIntervalMinutes(fmtIntervalMinutes(d.config.intervalSeconds));
        }).catch((err) => { if (alive) setError(err.message || String(err)); });
        return () => { alive = false; };
      }, [attempt]);
      const save = async (event) => {
        event.preventDefault();
        if (!config || saving || busy) return;
        setSaving(true);
        setError('');
        setMessage('');
        try {
          const patch = {
            mode: config.mode,
            workspaceSync: config.workspaceSync,
            enabled: config.enabled !== false,
          };
          /* 只有自动模式才带周期:留空 = 不改动已有值 */
          const minutes = Number(intervalMinutes);
          if (config.mode === 'auto' && Number.isFinite(minutes) && minutes >= 0.5) patch.intervalSeconds = Math.round(minutes * 60);
          const d = await API.saveConfig(patch);
          if (!d || !d.ok) throw new Error((d && d.error) || '保存失败，请重试');
          const overridden = d.config && (d.config.mode !== config.mode || d.config.workspaceSync !== config.workspaceSync);
          if (d.config) {
            setConfig({ ...d.config, intervalSeconds: d.config.intervalSeconds !== undefined ? d.config.intervalSeconds : config.intervalSeconds });
            setIntervalMinutes(fmtIntervalMinutes(d.config.intervalSeconds !== undefined ? d.config.intervalSeconds : config.intervalSeconds));
          }
          setMessage(overridden ? '已保存；部分选项由宿主指定，表单已显示实际值。' : '已保存，同步方式立即生效。工作区选项从下次同步起生效。');
          if (onSaved) onSaved();
        } catch (err) { setError(err.message || String(err)); }
        finally { setSaving(false); }
      };
      return e('form', { className: 'dss-sec', id: 'dss-scope', tabIndex: -1, onSubmit: save },
        stepHeading(2, '选择同步内容和方式'),
        e('div', { className: 'dss-desc' }, '会话、附件和设置会一起同步。先决定是否带上项目文件；第一次使用可保留手动模式，确认成功后再开启自动同步。'),
        !config && !error ? e('div', { className: 'dss-desc' }, '正在读取偏好…') : null,
        error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null,
        !config && error ? e('button', { type: 'button', className: 'dss-btn', onClick: () => setAttempt(attempt + 1) }, '重新读取') : null,
        config ? e('fieldset', { disabled: saving || busy, style: { border: 0, margin: 0, padding: 0, minWidth: 0 } },
          e('label', { className: 'dss-rowline', style: { marginTop: '12px', flexWrap: 'wrap' } },
            e('span', { className: 'dss-rowtext' }, '同步方式'),
            e('select', {
              value: config.mode, 'aria-label': '同步方式', className: 'dss-select',
              onChange: (event) => {
                const mode = event.target.value;
                /* 选自动就同时打开自动同步,避免「模式是自动、却因为本机开关关着一直不跑」的困惑 */
                setConfig({ ...config, mode, enabled: mode === 'auto' ? true : config.enabled });
                setMessage('');
              },
            }, e('option', { value: 'manual' }, '手动同步'), e('option', { value: 'auto' }, '自动同步'))),
          e('label', { className: 'dss-rowline', style: { marginTop: '12px' } },
            e('input', {
              type: 'checkbox', checked: config.enabled !== false,
              'aria-label': '允许自动同步',
              onChange: (event) => { setConfig({ ...config, enabled: event.target.checked }); setMessage(''); },
            }),
            e('span', null, '允许自动同步')),
          e('div', { className: 'dss-desc' }, '关闭后暂停所有自动同步；仍可点「立即同步」。'),
          config.mode === 'auto'
            ? e('label', { className: 'dss-rowline', style: { marginTop: '12px' } },
                e('span', { className: 'dss-rowtext' }, '同步间隔'),
                e('input', {
                  type: 'number', min: '0.5', step: '0.5', inputMode: 'decimal', className: 'dss-input dss-input-num',
                  'aria-label': '自动同步间隔（分钟）', value: intervalMinutes,
                  onChange: (event) => { setIntervalMinutes(event.target.value); setMessage(''); },
                }),
                e('span', { className: 'dss-desc' }, '分钟'))
            : null,
          e('div', { className: 'dss-desc' }, config.enabled === false
            ? '当前自动同步已关闭。开启「允许自动同步」并选择自动模式后，保存即可启用。'
            : (config.mode === 'auto'
                ? '自动模式：每 ' + (fmtInterval(config.intervalSeconds) || '5 分钟') + ' 定时同步一次；会话有活动时也会触发。'
                : '手动模式：点「立即同步」时传输数据。')),
          e('details', null,
            e('summary', { className: 'dss-desc' }, '自动同步的触发时机'),
            e('div', { className: 'dss-desc' }, '自动模式且允许自动同步时：定时同步、会话活动后同步'
              + (config.autoPullOnStart !== false ? '、DSH 启动后同步' : '')
              + '，这些触发都会取回和上传数据。'
              + (config.autoPushOnExit !== false ? '正常退出时还会尝试保存并上传已有仓库的改动；强制结束进程时无法保证。' : '退出时自动上传已关闭。'))),
          e('label', { className: 'dss-rowline', style: { marginTop: '12px' } },
            e('input', { type: 'checkbox', checked: config.workspaceSync !== false, onChange: (event) => { setConfig({ ...config, workspaceSync: event.target.checked }); setMessage(''); } }),
            e('span', null, '同步工作区文件')),
          e('div', { className: 'dss-desc' }, '同步项目文件夹中的文件。关闭后暂停这些文件的上传与取回，仍同步会话、附件和设置；远端文件保留，但不再更新。'),
          e('details', null,
            e('summary', { className: 'dss-desc' }, '文件范围与排除项'),
            e('div', { className: 'dss-desc' }, '默认排除 Git 元数据、node_modules 等依赖目录；其他项目文件按忽略规则同步。首次同步前请检查敏感文件，项目中的密钥不会自动全部排除。'),
            helpLink('查看同步范围与排除规则', DOCS + 'sync-content.md')),
          e('button', { type: 'submit', className: 'dss-pill dss-primary', style: { marginTop: '12px' } }, saving ? '保存中…' : '保存选择，继续第 3 步')) : null,
        message ? notice('保存结果', message, 'dss-tip dss-desc') : null);
    }

    function Section(props) {
      const { busy, status, statusError, progress, run, refresh } = useSync();
      const runRef = useRef(null);
      const [setupStep, setSetupStep] = useState(null);
      const stepIds = ['dss-connect', 'dss-scope', 'dss-run', 'dss-result'];
      const goToStep = (number) => {
        setSetupStep(number);
        if (typeof document !== 'undefined') {
          const target = document.getElementById(stepIds[number - 1]);
          target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
          target?.focus?.({ preventScroll: true });
        }
      };
      const nextStep = setupStep || (!status?.remote ? 1 : status.lastOk === true && status.lastSyncAt ? 4 : 2);
      const nextHint = !status ? '正在读取设置…'
        : status.gitMissing ? '还缺少 Git。先完成第 1 步中的安装，再重新打开 DSH。'
        : busy ? '正在同步，请等传输完成后查看第 4 步。'
        : status?.lastOk === false ? '上次同步未完成。到第 3 步查看错误，处理后重试。'
        : nextStep === 1 ? '从第 1 步开始：登录 GitHub，准备两台电脑共用的仓库。'
        : nextStep === 2 ? '保存第 2 步的选择，再开始同步。'
        : nextStep === 3 ? '点「立即同步」，检查连接并开始传输。请先保存前两步的选择。'
        : status?.lastOk === true && status.lastSyncAt && status.remote
          ? '本机同步已完成。接下来按第 4 步，在另一台电脑验证能否接着聊。'
          : '先完成第 3 步，再按下面的步骤验证两台电脑能否互相取回数据。';
      const [conflicts, setConflicts] = useState(null);
      const [autoRestart, setAutoRestart] = useState(null); // null=加载中
      const [restarting, setRestarting] = useState(false);
      /* 正在生成的会话(用于重启前说清会打断哪几次对话;名字来自接口 activeSessions) */
      const activeCount = Number(status && status.activeSessionCount) || 0;
      const activeNames = activeNamesText(activeSessionsOf(status));
      const loadConflicts = useCallback(() => {
        API.conflicts().then((d) => setConflicts((d && d.conflicts) || [])).catch(() => {});
      }, []);
      useEffect(() => { loadConflicts(); }, [loadConflicts]);
      /* 读取/切换「同步后自动重启修复」开关 */
      useEffect(() => {
        let alive = true;
        API.config().then((d) => { if (alive && d && d.ok) setAutoRestart(d.config && d.config.autoRestartAfterRepair === true); }).catch(() => {});
        return () => { alive = false; };
      }, []);
      const toggleAutoRestart = () => {
        const next = !(autoRestart === true);
        setAutoRestart(next);
        API.saveConfig({ autoRestartAfterRepair: next })
          .then((d) => {
            if (d && d.ok) bubble(null, next ? '已开启：会话分组需要刷新时自动重启' : '已关闭：需要刷新会话分组时手动重启', true);
            else { setAutoRestart(!next); bubble(null, (d && d.error) || '设置失败', false); }
          })
          .catch((err) => { setAutoRestart(!next); bubble(null, err.message || String(err), false); });
      };
      /* 「立即重启 DSH」:同步归组/补丁套用后需重启才生效。走 schtasks 独立进程树,不能在本进程内杀服务器。 */
      const doRestart = (anchor) => {
        if (restarting || busy || status?.restartAvailable === false) return;
        /* 确认文案与左下角引导卡共用 restartConfirmText:有活跃会话时提示会打断正在生成的会话并列出会话 id */
        if (!window.confirm(restartConfirmText(status))) return;
        setRestarting(true);
        API.restart()
          .then((d) => { reportRestartResult(d, anchor); if (!(d && d.ok)) refresh(); })
          .catch((err) => bubble(anchor, err.message || String(err), false))
          .finally(() => setRestarting(false));
      };
      const onRun = () => { setSetupStep(3); refresh(); run(runRef.current).then(() => { loadConflicts(); setSetupStep(4); }); };
      const detail = useMemo(() => (status ? lastDetailText(status.lastDetail) : ''), [status]);

      const statusDesc = (() => {
        if (!status) return '正在读取同步状态…';
        if (status.gitMissing) return '未检测到 git,无法同步 —— 请先安装 git。';
        if (!status.remote) {
          if (status.autoRepo === false) return '仅本地快照：数据保存在这台电脑，未上传云端。\n要连接另一台电脑，请回第 1 步填写仓库地址，或开启自动建仓。';
          return '尚未连接同步仓库。先在这台电脑运行 gh auth login，再点「立即同步」。\n'
            + '默认会尝试创建或复用账号下的 dsh-sync 仓库；请先确认已有同名仓库为私有。\n'
            + '若只生成本地快照，数据尚未上传。已有仓库请在第 1 步填写。';
        }
        return status.remote + '\n'
          + '分支 ' + status.branch + ' · ' + (status.auto ? '自动同步已开启' : status.mode === 'auto' ? '自动同步已暂停' : '手动同步')
          + (status.workspaceCount ? ' · ' + status.workspaceCount + ' 个工作区' : '')
          + (status.ungroupedCount > 0 ? ' · ⚠ ' + status.ungroupedCount + ' 个会话未分组' : '')
          + (status.lastOk === false ? ' · 上次失败' : '')
          + (status.lastMessage ? '\n上次:' + status.lastMessage : '');
      })();

      return e('div', { className: 'dss-wrap' },
        e('style', null, STYLE),
        statusError ? e('div', { className: 'dss-err', role: 'alert' }, statusError,
          e('button', { type: 'button', className: 'dss-pill', onClick: refresh, style: { marginLeft: '8px' } }, '重新读取状态')) : null,
        e('div', { className: 'dss-onboarding' },
          e('div', { className: 'dss-onboarding-title' }, '换台电脑，接着聊'),
          e('div', { className: 'dss-desc' }, '按下面 4 步设置，数据通过你自己的 GitHub 私有仓库传输。首次建议手动同步，确认结果后再开启自动同步。'),
          e('nav', { className: 'dss-steps', 'aria-label': '同步设置步骤' },
            ['连接仓库', '选择内容', '开始同步', '换机验收'].map((label, i) => e('button', {
              key: i, type: 'button', className: 'dss-step-link',
              'aria-current': nextStep === i + 1 ? 'step' : undefined,
              onClick: () => goToStep(i + 1),
            }, e('span', { className: 'dss-step-number', 'aria-hidden': true }, i + 1), label))),
          notice(!status || busy || status.gitMissing || status.lastOk === false ? '当前状态' : '下一步引导', nextHint),
          helpLink('查看完整安装与换机指南', DOCS + 'getting-started.md')),
        e(ConnectionSettings, { remote: status && status.remote, branch: status && status.branch, busy, onSaved: () => { refresh(); goToStep(2); } }),
        e(SyncPreferences, { busy, onSaved: () => { refresh(); goToStep(3); } }),
        /* —— 同步组:状态 + 立即同步 —— */
        e('div', { className: 'dss-sec', id: 'dss-run', tabIndex: -1 },
          e('div', { className: 'dss-rowline' },
            e('div', { className: 'dss-rowtext' },
              stepHeading(3, '开始同步'),
              e('div', { className: 'dss-desc' }, '点一次「立即同步」，取回远端数据并上传本机改动。完成前保持 DSH 打开；失败后可查看下方详情并重试。'),
              busy
                ? [
                    e('div', { className: 'dss-prog' },
                      e(SyncIcon, { spin: true }),
                      (progress && progress.label) || '同步中…',
                      progress && progress.startedAt ? e(ElapsedText, { className: 'dss-desc', startedAt: progress.startedAt, prefix: '· ' }) : null),
                    progress && progress.transfer ? e(TransferLine, { t: progress.transfer }) : null,
                  ]
                : e('div', null,
                    e('div', { className: 'dss-desc' }, statusDesc),
                    /* 补丁是独立功能(web_fetch 代理回退等),不再挤进同步状态行 */
                    status && status.patches
                      ? e('details', null,
                          e('summary', { className: 'dss-desc' }, '本机补丁状态'),
                          e('div', { className: 'dss-desc' }, status.patches))
                      : null)),
            e('button', {
              type: 'button', className: 'dss-pill dss-primary', ref: runRef,
              disabled: busy || Boolean(status && status.gitMissing),
              title: '按已保存的设置同步：保存本地快照，并与远端交换数据',
              onClick: onRun,
            }, e(SyncIcon, { spin: busy }), busy ? '同步中' : '立即同步')),
          /* 未分组会话提示:同步已把它们补进所属工作区,重启后侧栏归位;给出「立即重启」入口 */
          status && status.ungroupedCount > 0
            ? e('div', { className: 'dss-wsbanner', role: 'alert' },
                e('div', { className: 'dss-wsbanner-text' },
                  e('div', { className: 'dss-wsbanner-title' }, status.ungroupedCount + ' 个会话未分组'),
                  e('div', { className: 'dss-confmeta' }, status?.hostKind === 'desktop'
                    ? '先同步修复分组，再重启桌面应用刷新侧栏；仍未归组时查看同步详情。'
                    : '先同步修复分组，再重启 DSH 刷新侧栏；仍未归组时查看同步详情。')),
                e('button', {
                  type: 'button', className: 'dss-btn', disabled: restarting || busy || status?.restartAvailable === false,
                  title: '立即重启并让侧栏归位',
                  onClick: (ev) => doRestart(ev.currentTarget),
                }, restarting ? '调度中…' : '立即重启'))
            : null,
          /* 高级选项:同步补好未分组会话后自动重启宿主,让新实例重建会话索引(否则侧栏会一直显示「未分组」) */
          /* 桌面端同样支持:重启脚本会校验桌面宿主进程,确认后关闭应用并重新打开 */
          e('details', null,
            e('summary', null, '高级：会话分组修复'),
            e('div', { className: 'dss-rowline dss-restartrow' },
            e('div', { className: 'dss-rowtext' },
              e('div', { className: 'dss-h' }, '自动重启修复会话分组'),
              e('div', { className: 'dss-desc' }, '同步检查发现会话分组需要刷新时，自动重启 DSH。检测到会话正在生成时暂不重启。默认开启，可在这里关闭。'),
            ),
            autoRestart === null
              ? e('span', { className: 'dss-desc' }, '…')
              : e('button', {
                  type: 'button', className: 'dss-switch' + (autoRestart ? ' dss-switch-on' : ''),
                  role: 'switch', 'aria-checked': autoRestart,
                  'aria-label': '自动重启修复会话分组', disabled: busy || status?.restartAvailable === false,
                  title: autoRestart ? '已开启：需要刷新会话分组时自动重启' : '已关闭：需要刷新会话分组时手动重启',
                  onClick: toggleAutoRestart,
                }, e('span', { className: 'dss-switch-knob' }))),
            e('div', { className: 'dss-rowline dss-restartrow' },
              e('div', { className: 'dss-rowtext' },
              e('div', { className: 'dss-desc' }, status?.restartAvailable === false
                ? '这台电脑缺少重启条件，请手动退出后重新打开。'
                : (activeCount > 0
                    ? '正在生成 ' + activeCount + ' 个会话' + (activeNames ? '：' + activeNames : '') + '，重启会打断它们。'
                    : (status?.hostKind === 'desktop' ? '手动重启会关闭并重新打开应用。' : '手动重启时页面会短暂断开。')))),
              e('button', {
                type: 'button', className: 'dss-btn', disabled: restarting || busy || status?.restartAvailable === false,
                title: '立即重启并让侧栏归位',
                onClick: (ev) => doRestart(ev.currentTarget),
              }, restarting ? '调度中…' : '立即重启')),
            e('div', { className: 'dss-desc' }, '检查在同步时执行；修复分组或取回新会话后可能需要重启。自动重启会等待传输全部完成；活动状态未知时请手动确认重启。')),
          /* 上次结果明细:错误保留很久便于排障 */
          detail
            ? e('details', { open: status && status.lastOk === false ? true : undefined },
                e('summary', null, '上次同步详情' + (status && status.lastSyncAt ? ' · ' + new Date(status.lastSyncAt).toLocaleString() : '')),
                e('div', { className: status && status.lastOk === false ? 'dss-err' : 'dss-desc' }, detail))
            : (status && status.lastOk === false && status.lastMessage
                ? e('div', { className: 'dss-err' }, status.lastMessage)
                : null)),
        e('div', { className: 'dss-sec dss-complete', id: 'dss-result', tabIndex: -1 },
          stepHeading(4, '确认结果，再接入另一台电脑'),
          notice('当前同步状态',
            busy ? '同步还在进行，请等待完成。'
              : status?.lastOk === false ? '本次同步未完成。请回第 3 步查看错误并重试。'
              : !status?.lastSyncAt ? '还没有本次运行的同步结果。完成第 3 步后，在这里确认。'
              : !status.remote ? '已保存本地快照，尚未上传云端；另一台电脑还无法取回这些数据。'
              : '本机同步已完成。还需在另一台电脑完成下面的验证，才能确认双向同步可用。',
            status?.lastOk === false ? 'dss-next dss-err' : 'dss-next'),
          e('ol', null,
            e('li', null, '在另一台电脑安装插件，登录同一个 GitHub 账号，填写相同仓库地址和分支。'),
            e('li', null, '点「立即同步」，确认原电脑的会话和选定的项目文件已出现。分组仍未刷新时重启 DSH。'),
            e('li', null, '在新电脑创建一条测试会话并同步，再回原电脑同步，确认也能看见这条会话。')),
          e('div', { className: 'dss-tip dss-desc' }, '换机后仍需在本机配置 API 密钥、安装插件及项目依赖。以后开工前、收工后各同步一次；熟悉流程后可在第 2 步开启自动同步。'),
          e('button', { type: 'button', className: 'dss-pill', onClick: () => goToStep(3) }, '返回第 3 步查看同步结果')),
        /* —— 本机新创建的工作区:路径已按本机主目录重映射,可换位置 —— */
        (() => {
          const created = status && status.lastDetail && status.lastDetail.workspaces && status.lastDetail.workspaces.created;
          if (!Array.isArray(created) || !created.length) return null;
          return e('div', { className: 'dss-sec' },
            e('div', { className: 'dss-h' }, '本机新创建的工作区'),
            created.map((w) => e('div', { key: w.id, className: 'dss-wsbanner' },
              e('div', { className: 'dss-wsbanner-text' },
                e('div', { className: 'dss-wsbanner-title' }, '工作区「' + (w.title || w.id) + '」已在本机创建'),
                e('div', { className: 'dss-confmeta' }, '路径: ' + w.path),
                w.recorded && String(w.recorded).toLowerCase() !== String(w.path).toLowerCase()
                  ? e('div', { className: 'dss-confmeta' }, '记录路径: ' + w.recorded + '(按本机主目录自动重映射)')
                  : null),
              e('div', { className: 'dss-confbtns' },
                e('button', {
                  type: 'button', className: 'dss-btn',
                  onClick: () => {
                    const p = window.prompt('为工作区「' + (w.title || w.id) + '」选择本机文件夹(留空则恢复按记录路径):', w.path);
                    if (p === null) return;
                    API.workspacePath(w.id, p.trim())
                      .then((d) => { if (d && d.ok) { bubble(null, d.path ? '已换位置: ' + d.path : '已恢复默认', true); refresh(); run(runRef.current); } else bubble(null, (d && d.error) || '设置失败', false); })
                      .catch((err) => bubble(null, err.message || String(err), false));
                  },
                }, '换位置'),
                e('button', {
                  type: 'button', className: 'dss-btn',
                  onClick: () => {
                    API.workspacePath(w.id, '')
                      .then((d) => { if (d && d.ok) { bubble(null, '已恢复按记录路径', true); refresh(); } else bubble(null, (d && d.error) || '设置失败', false); })
                      .catch((err) => bubble(null, err.message || String(err), false));
                  },
                }, '恢复默认')))));
        })(),
        /* —— 遗留冲突副本(只读审计):新版已自动合并,这里只列旧版本留下的 .dsh-conflict-* —— */
        e('details', { className: 'dss-sec' },
          e('summary', { className: 'dss-h' }, '高级：遗留冲突副本（只读）'),
          e('div', { className: 'dss-desc' }, '这里只显示旧版本留下的副本，可预览，不提供取舍或删除操作。'),
          e('details', null,
            e('summary', { className: 'dss-desc' }, '当前版本如何处理冲突'),
            e('div', { className: 'dss-desc' }, '会话保留可确认的完整追加历史；分叉时保留一侧，并在同步详情列出双方原件。设置与登记表按字段合并。普通文件冲突通常保留本机版本；首次接入的独立历史冲突采用远端版本。另一侧可从 Git 历史查找。')),
          conflicts === null
            ? e('div', { className: 'dss-empty' }, '正在读取遗留副本…')
            : null,
          conflicts !== null && conflicts.length === 0
            ? e('div', { className: 'dss-empty' }, '没有遗留副本，当前同步不会产生新的冲突拷贝。')
            : null,
          conflicts !== null
            ? conflicts.map((c) => e(ConflictRow, {
                key: (c.kind || 'main') + ':' + c.path + ':' + (c.conflictAt || '0'),
                conflict: c,
              }))
            : null));
    }

    /* ---------- 挂载 ---------- */
    let stylesInjected = false;
    function injectStyles() {
      if (stylesInjected || typeof document === 'undefined') return;
      stylesInjected = true;
      try {
        const el = document.createElement('style');
        el.setAttribute('data-dsh-chatsync', '');
        el.textContent = STYLE;
        document.head.appendChild(el);
      } catch { /* ignore */ }
    }
    function apply(ctx) {
      injectStyles(); // 侧栏胶囊按钮等样式全局注入,不依赖设置分节挂载
      // 侧栏底部同步按钮:原生注入不遮挡(收起侧栏自动变纯图标)
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'dsh-sync-sync',
      }, FootSyncButton));
      // 设置面板分节:同步状态卡(只读状态 + 上次结果(含错误) + 立即同步)
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-sync-manage',
        order: 400,
        label: '同步',
      }, Section));
      // 左下角重启引导浮层:未分组 / 需重启时常驻提示,不必打开设置页
      // (shell.overlay 是 click-through 列表槽位,卡片自带 pointer-events:auto 与低 z-index)
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-sync-restart-guide',
        order: 300,
      }, RestartGuideOverlay));
    }

    module.exports = {
      name: 'dsh-chatsync',
      inject: ['slots'],
      apply,
    };
    return module.exports;
  },
});
