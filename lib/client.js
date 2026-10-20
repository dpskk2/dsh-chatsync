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
      run: (approval) => fetch('/dsh-sync/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approval }) }).then((r) => r.json()),
      cancel: runId => fetch('/dsh-sync/api/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId }) }).then(r => r.json()),
      startup: (action, approval) => fetch('/dsh-sync/api/startup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, approval }) }).then(r => r.json()),
      status: () => fetch('/dsh-sync/api/status').then((r) => r.json()),
      preview: () => fetch('/dsh-sync/api/preview').then((r) => r.json()),
      recovery: () => fetch('/dsh-sync/api/recovery').then((r) => r.json()),
      recoveryPreview: (id) => fetch('/dsh-sync/api/recovery/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).then((r) => r.json()),
      recoveryRestore: (id, side, expectedHash) => fetch('/dsh-sync/api/recovery/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, side, expectedHash }) }).then((r) => r.json()),
      recoveryImport: (id, side, expectedHash, workspaceId) => fetch('/dsh-sync/api/recovery/import-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, side, expectedHash, workspaceId }) }).then((r) => r.json()),
      update: () => fetch('/dsh-sync/api/update').then((r) => r.json()),
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
      '.dss-update{box-sizing:border-box;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:12px;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-secondary,#666);font-size:12px;line-height:1.65}',
      '.dss-update-popup{position:fixed;z-index:40;width:min(310px,calc(100vw - 24px));max-height:calc(100vh - 100px);overflow:auto;box-shadow:0 2px 10px rgba(0,0,0,.08);animation:dss-update-in .6s ease-out}',
      '@keyframes dss-update-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}',
      '@media(prefers-reduced-motion:reduce){.dss-update-popup{animation:none}}',
      '.dss-update-heading{display:flex;align-items:center;gap:8px;justify-content:space-between}.dss-update-heading h2{font:inherit;font-weight:600;margin:0}',
      '.dss-update-notes{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0;max-height:150px;overflow:auto}.dss-update-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.dss-update a{color:inherit}.dss-update summary{cursor:pointer}.dss-update-feedback{margin-top:8px;overflow-wrap:anywhere}.dss-update pre{white-space:pre-wrap;user-select:text}',
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
      '.dss-step-link[aria-current]{border-color:var(--dsw-alias-accent-color,#3979df);background:var(--dsw-alias-interactive-bg-active,rgba(57,121,223,.1))}',
      '.dss-check{display:flex;align-items:center;gap:8px;margin:10px 0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:9px;line-height:20px}',
      '.dss-check input{flex:none;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-accent-color,#3979df)}',
      '.dss-choice{display:flex;flex-direction:column;gap:2px}.dss-choice small{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit)}',
      '.dss-save-state{font-size:12px;min-height:18px;color:var(--dsw-alias-label-secondary,inherit)}',
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
      '.dss-startup-dialog{box-sizing:border-box;width:min(480px,calc(100vw - 32px));max-height:calc(100dvh - 48px);margin:auto;padding:28px;border:1px solid var(--dsw-alias-border-l2,#d9dde3);border-radius:16px;background:var(--dsw-alias-bg-layer-2,Canvas);color:var(--dsw-alias-label-primary,CanvasText);box-shadow:0 16px 64px rgba(0,0,0,.22);font:inherit;line-height:1.65;overflow:auto;overflow-wrap:anywhere;pointer-events:auto}',
      '.dss-startup-dialog::backdrop{background:rgba(15,23,42,.38)}',
      '.dss-startup-dialog h2{margin:0 0 12px;font-size:22px;line-height:1.4}.dss-startup-dialog p{margin:0 0 20px;white-space:pre-wrap}',
      '.dss-startup-actions{display:flex;flex-wrap:wrap;gap:12px}.dss-startup-actions .dss-pill{height:auto;min-height:40px;padding:9px 16px;font-size:14px}',
      '.dss-startup-dialog :is(button,a):focus-visible{outline:2px solid var(--dsw-alias-accent-color,#3979df);outline-offset:3px}',
      '.dss-startup-dialog:focus{outline:none}.dss-startup-dialog .dss-startup-primary{background:#2563eb;border-color:#2563eb;color:#fff}.dss-startup-dialog .dss-startup-primary:hover{background:#1d4ed8;border-color:#1d4ed8;color:#fff}',
      '.dss-startup-dialog .dss-pill:focus-visible{outline:2px solid #2563eb;outline-offset:3px}.dss-startup-dialog .dss-pill:disabled{background:#e5e7eb;border-color:#d1d5db;color:#4b5563;opacity:1;cursor:wait}',
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
      const [review, setReview] = useState(null);
      const [cancelPending, setCancelPending] = useState(false);
      const cancelRef = useRef(false);
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
          setReview(d.lastDetail?.needsReview && !d.lastDetail.privacy ? d.lastDetail.review : null);
        }).catch((err) => setStatusError('无法读取同步状态：' + (err.message || String(err))));
      }, []);
      const run = useCallback(async (anchor, approval) => {
        if (busy) return;
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
      const cancel = useCallback(async anchor => {
        if (cancelRef.current || !progress?.runId || !progress.canCancel) return;
        cancelRef.current = true; setCancelPending(true);
        try {
          const d = await API.cancel(progress.runId);
          bubble(anchor, d.error || d.message || '已停止本轮同步', Boolean(d.ok));
        } catch (err) { bubble(anchor, '未确认停止结果：' + (err.message || String(err)) + '，请查看最新状态。', false); }
        finally {
          cancelRef.current = false; setCancelPending(false);
          await refresh(); API.progress().then(setProgress).catch(() => {});
        }
      }, [progress, refresh]);
      useEffect(() => {
        refresh();
        // Also observe automatic syncs and runs started from the other slot.
        const timer = setInterval(() => {
          refresh();
          API.progress().then(setProgress).catch(() => {});
        }, 3000);
        return () => { clearInterval(timer); stopPoll(); };
      }, [refresh, stopPoll]);
      return { busy: busy || cancelPending || Boolean(progress && progress.running), status, statusError, progress, refresh, run, cancel,
        cancelling: cancelPending || Boolean(progress?.cancelling),
        review: review || (status?.lastDetail?.needsReview && !status.lastDetail.privacy ? status.lastDetail.review : null) };
    }

    function CancelSyncButton({ progress, cancelling, onCancel, compact }) {
      return e('button', { type: 'button', className: compact ? 'dss-foot-btn' : 'dss-pill',
        disabled: Boolean(cancelling) || !progress?.canCancel || !progress?.runId,
        title: '停止本轮同步；本地写入会先安全完成，已完成的保存或上传保留，下次继续核对。',
        onClick: event => onCancel(event.currentTarget) }, cancelling ? '正在停止…' : '取消同步');
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
    function TransferReview({ review, busy, onConfirm }) {
      if (!review) return null;
      return e('div', { className: 'dss-review', role: 'region', 'aria-label': '同步预览' },
        e('p', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, review.summary),
        e('button', { type: 'button', className: 'dss-pill dss-primary dss-startup-primary',
          disabled: Boolean(busy), onClick: () => onConfirm(review.id) }, busy ? '正在继续…' : '确认并继续'));
    }
    function StartupSyncOverlay() {
      const { status, progress, refresh } = useSync();
      const [feedback, setFeedback] = useState('');
      const [actionPending, setActionPending] = useState('');
      const dialog = useRef(null);
      const s = status && status.startup;
      const blocked = Boolean(s && s.required && s.phase !== 'ready' && s.phase !== 'offline');
      useEffect(() => {
        if (!blocked || typeof document === 'undefined') return;
        const panel = dialog.current;
        if (!panel) return;
        const previous = document.activeElement;
        // showModal lifts the panel out of shell.overlay's stacking context and
        // makes the underlying host inert. Escape must not bypass startup sync.
        if (!panel.open) panel.showModal();
        (panel.querySelector('button') || panel).focus();
        return () => {
          if (panel.open) panel.close();
          previous && previous.focus && previous.focus();
        };
      }, [blocked]);
      if (!blocked) return null;
      const act = async action => {
        setActionPending(action);
        try { const d = await API.startup(action, action === 'confirm' ? s.review?.id : undefined); setFeedback(d.error || ''); await refresh(); }
        catch (err) { setFeedback(err.message || String(err)); }
        finally { setActionPending(''); }
      };
      return e('dialog', { className: 'dss-startup-dialog', ref: dialog, tabIndex: -1,
        role: 'dialog', 'aria-modal': true, 'aria-label': '启动同步',
        onCancel: event => event.preventDefault(), onKeyDown: event => event.stopPropagation() },
          e('h2', null, '启动同步'),
          e('p', { role: 'status' }, s.phase === 'running' && progress?.running ? progress.label : s.message || '正在确认其他电脑的最新数据，请稍候…'),
          s.phase === 'running' && progress?.startedAt ? e('p', null, e(ElapsedText, { startedAt: progress.startedAt, prefix: '已等待 ' }),
            progress.transfer ? e(TransferLine, { t: progress.transfer }) : null) : null,
          s.phase === 'review' ? e(TransferReview, { review: s.review, busy: Boolean(actionPending), onConfirm: () => act('confirm') }) : null,
          feedback ? e('p', { role: 'alert' }, feedback) : null,
          e('div', { className: 'dss-startup-actions' },
            s.phase === 'error' ? e('button', { type: 'button', className: 'dss-pill dss-startup-primary', disabled: Boolean(actionPending), onClick: () => act('retry') }, actionPending === 'retry' ? '正在重试…' : '重试同步') : null,
            ['running', 'review', 'error', 'cancelling'].includes(s.phase) ? e('button', { type: 'button', className: 'dss-pill', disabled: Boolean(actionPending) || s.phase === 'cancelling', onClick: () => act('offline') },
              s.phase === 'cancelling' || actionPending === 'offline' ? '正在停止…' : s.phase === 'running' ? '取消同步，离线进入' : '本次离线使用') : null));
    }

    /* 同步进行中的常驻进度气泡:贴在锚点元素上方,实时显示阶段与耗时 */
    function UpdateNotice(props) {
      const [data, setData] = useState(null);
      const [visible, setVisible] = useState(false);
      const [pos, setPos] = useState(null);
      const [feedback, setFeedback] = useState('');
      const [copyFailed, setCopyFailed] = useState(false);
      useEffect(() => {
        let live = true;
        loadUpdate().then((result) => {
          if (!live || !result || !result.ok || !result.available) return;
          setData(result);
          const key = 'dss-update-seen-' + result.hostKind + '-' + result.latestVersion;
          let seen = updateShown.has(key);
          try { seen = seen || window.localStorage.getItem(key) === '1'; } catch { /* in-memory fallback */ }
          setVisible(!props.startup || !seen);
        });
        return () => { live = false; };
      }, []);
      useEffect(() => {
        if (!props.startup || !visible || !data || props.busy) return;
        const position = () => {
          const anchor = props.anchorRef && props.anchorRef.current;
          if (!anchor || !anchor.getBoundingClientRect) return;
          const r = anchor.getBoundingClientRect();
          const bottom = Math.min(window.innerHeight - 80, Math.max(12, window.innerHeight - r.top + 10));
          setPos({ left: Math.max(12, Math.min(r.left, window.innerWidth - 322)), bottom,
            maxHeight: Math.max(60, window.innerHeight - bottom - 12) });
          const key = 'dss-update-seen-' + data.hostKind + '-' + data.latestVersion;
          updateShown.add(key);
          try { window.localStorage.setItem(key, '1'); } catch { /* in-memory fallback */ }
        };
        position();
        window.addEventListener('resize', position);
        return () => window.removeEventListener('resize', position);
      }, [visible, data, props.busy]);
      if (!visible || !data || (props.startup && (props.busy || !pos))) return null;
      const notes = data.notes || '此版本的更新说明暂时无法读取，请查看完整更新内容。';
      // Plain text only: remote Markdown is never injected as HTML.
      const excerpt = notes.replace(/^#+\s+.*$/gm, '').replace(/\*\*/g, '').trim();
      const copy = async () => {
        try {
          await window.navigator.clipboard.writeText(data.command);
          setCopyFailed(false);
          setFeedback('已复制更新代码，请打开 PowerShell 粘贴并按回车。' +
            (data.hostKind === 'desktop' ? '执行前先完全退出桌面应用（含托盘），更新后重新打开。' : '更新后重新启动 DSH。'));
        } catch {
          setCopyFailed(true);
          setFeedback('复制失败，请手动复制下方代码，到 PowerShell 粘贴执行。' +
            (data.hostKind === 'desktop' ? '执行前先完全退出桌面应用（含托盘），更新后重新打开。' : '更新后重新启动 DSH。'));
        }
      };
      const content = e('div', null,
        e('div', { className: 'dss-update-notes' }, props.startup ? excerpt.slice(0, 420) : excerpt),
        e('div', { className: 'dss-update-actions' },
          e('button', { type: 'button', className: 'dss-btn', onClick: copy }, '复制更新代码'),
          e('a', { href: data.releaseUrl, target: '_blank', rel: 'noopener noreferrer' }, '完整更新内容')),
        feedback ? e('div', { className: 'dss-update-feedback', role: 'status' }, feedback,
          copyFailed ? e('pre', null, data.command) : null) : null);
      return e('aside', { className: 'dss-update' + (props.startup ? ' dss-update-popup' : ''),
        style: props.startup ? pos : { marginBottom: '16px' }, 'aria-label': 'ChatSync 更新提醒',
        onKeyDown: (event) => { if (props.startup && event.key === 'Escape') setVisible(false); } },
        props.startup ? e('div', null,
          e('div', { className: 'dss-update-heading' },
            e('h2', null, 'ChatSync 有新版本 · ' + data.latestVersion),
            e('button', { type: 'button', className: 'dss-btn', 'aria-label': '关闭更新提醒', onClick: () => setVisible(false) }, '×')),
          content)
          : e('details', null, e('summary', null, 'ChatSync 有新版本 · ' + data.latestVersion + ' · 查看更新'), content));
    }

    /* ---------- 侧栏底部「⟳ 同步」按钮 ---------- */
    function FootSyncButton(props) {
      const wide = props.wide !== false;
      const ref = useRef(null);
      const { busy, status, progress, run, refresh, cancel, cancelling } = useSync();
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
        busy ? e(CancelSyncButton, { progress, cancelling, onCancel: cancel, compact: true }) : null,
        busy ? e(ProgressTip, { anchorRef: ref, progress }) : null,
        e(UpdateNotice, { startup: true, anchorRef: ref, busy }));
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
      if (lastDetail.privacy?.findings?.length) {
        lines.push('上传前检查已暂停：');
        for (const finding of lastDetail.privacy.findings) lines.push('  ' + finding.file + '：' + finding.reasons.join('、'));
        lines.push('检查包含尚未上传的历史快照；仅删除当前文件或新增忽略规则不能移除已经提交的敏感内容。');
      }
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
      for (const w of lastDetail.sessionDeferred || []) lines.push('会话等待应用: ' + w.hint + '；' + w.file);
      for (const warning of lastDetail.scopeWarnings || []) lines.push(warning);
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
    function ConnectionSettings({ busy, onSaved, remote, branch, setup = false }) {
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
          setMessage(overridden ? '连接受宿主配置限制，已显示实际值。' : '连接已保存');
          if (onSaved) onSaved();
        } catch (err) { setError(err.message || String(err)); }
        finally { setSaving(false); }
      };
      return e('form', { className: 'dss-sec', id: 'dss-connect', tabIndex: -1, onSubmit: save },
        setup ? stepHeading(1, '连接同步仓库') : e('div', { className: 'dss-h' }, 'GitHub 私有仓库'),
        e('details', { className: 'dss-tip' },
          e('summary', null, 'GitHub 登录与建仓'),
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
          e('div', { className: 'dss-desc' }, '默认仓库：dsh-sync'),
          config.remote && !/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)/i.test(config.remote) ? e('div', { className: 'dss-err', role: 'alert' }, '现有地址不受支持。本版仅连接 GitHub；原配置保留，请填写 GitHub 私有仓库后保存。同步不会向此地址上传。') : null,
          e('button', { type: 'submit', className: 'dss-pill dss-primary', style: { marginTop: '14px' } }, saving ? '保存中…' : setup ? '保存连接，选择内容' : '保存仓库设置')) : null,
        message ? e('div', { className: 'dss-save-state', role: 'status' }, message) : null,
        e('nav', { className: 'dss-links', 'aria-label': '仓库连接帮助' },
          helpLink('新建私有仓库', 'https://github.com/new'),
          helpLink('GitHub 登录说明', 'https://cli.github.com/manual/gh_auth_login'),
          helpLink('代理与高级配置', DOCS + 'configuration.md')));
    }
    function SyncPreferences({ busy, onSaved, onChanged, onSavingChange, setup = false }) {
      const [config, setConfig] = useState(null);
      const [error, setError] = useState('');
      const [message, setMessage] = useState('');
      const [saving, setSaving] = useState(false);
      const [attempt, setAttempt] = useState(0);
      const [uncertain, setUncertain] = useState(false);
      const savingRef = useRef(false);
      const confirmed = useRef(null);
      const automatic = config?.automatic ?? (config?.enabled !== false);
      const accept = actual => {
        confirmed.current = actual;
        setConfig(actual);
        setUncertain(false);
      };
      useEffect(() => {
        let alive = true;
        setError('');
        API.config().then(d => {
          if (!d?.ok || !d.config) throw new Error(d?.error || '无法读取同步偏好');
          if (alive) accept(d.config);
        }).catch(err => { if (alive) setError(err.message || String(err)); });
        return () => { alive = false; };
      }, [attempt]);
      const save = async patch => {
        if (!confirmed.current || savingRef.current || busy || uncertain) return false;
        const previous = confirmed.current;
        savingRef.current = true;
        setSaving(true); onSavingChange?.(true); setError(''); setMessage('');
        setConfig({ ...previous, ...patch });
        try {
          const d = await API.saveConfig(patch);
          if (!d?.ok || !d.config) throw new Error(d?.error || '无法确认保存结果');
          const actual = d.config;
          const overridden = Object.keys(patch).some(key => key === 'contentScope'
            ? Object.keys(patch.contentScope).some(k => actual.contentScope?.[k] !== patch.contentScope[k])
            : key === 'automatic' ? (actual.automatic ?? (actual.enabled !== false)) !== patch.automatic
              : actual[key] !== patch[key]);
          accept(actual);
          setMessage(overridden ? '受宿主配置限制，已显示实际值' : '已保存');
          onChanged?.();
          return true;
        } catch (err) {
          // A lost response can follow a committed write. Read back before presenting a value.
          try {
            const d = await API.config();
            if (!d?.ok || !d.config) throw new Error('readback failed');
            accept(d.config);
            setError(err.message || String(err));
          } catch {
            setConfig(previous);
            setUncertain(true);
            setError('保存状态未知，请重新读取设置。');
          }
          onChanged?.();
          return false;
        } finally {
          savingRef.current = false;
          setSaving(false); onSavingChange?.(false);
        }
      };
      return e('div', { className: 'dss-sec', id: 'dss-scope', tabIndex: -1 },
        setup ? stepHeading(2, '选择同步内容') : e('div', { className: 'dss-h' }, '同步内容'),
        !config && !error ? e('div', { className: 'dss-desc' }, '正在读取偏好…') : null,
        error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null,
        (!config && error) || uncertain ? e('button', { type: 'button', className: 'dss-pill', onClick: () => setAttempt(attempt + 1) }, '重新读取') : null,
        config ? e('fieldset', { disabled: saving || busy || uncertain, style: { border: 0, margin: 0, padding: 0, minWidth: 0 } },
          [['sessions', '会话', '对话记录与项目分组'],
            ['attachments', '聊天附件', '上传或附加到对话的图片、文件'],
            ['settings', '设置', '模型、界面与插件配置']].map(([key, label, description]) =>
            e('label', { key, className: 'dss-check' }, e('input', { type: 'checkbox', 'aria-label': label,
              checked: config.contentScope?.[key] !== false,
              onChange: event => save({ contentScope: { sessions: true, attachments: true, settings: true, ...confirmed.current.contentScope, [key]: event.target.checked } }) }),
              e('span', { className: 'dss-choice' }, label, e('small', null, description)))),
          e('label', { className: 'dss-check' }, e('input', { type: 'checkbox', 'aria-label': '项目文件', checked: config.workspaceSync !== false,
            onChange: event => save({ workspaceSync: event.target.checked }) }),
            e('span', { className: 'dss-choice' }, '项目文件', e('small', null, '项目文件夹中的文件，含生成到此处的 Word、Excel'))),
          helpLink('范围与排除规则', DOCS + 'sync-content.md'),
          e('div', { className: 'dss-rowline', style: { marginTop: '20px' } },
            e('div', { className: 'dss-rowtext' }, e('div', { className: 'dss-h' }, '自动同步')),
            e('button', { type: 'button', role: 'switch', 'aria-label': '自动同步', 'aria-checked': automatic,
              className: 'dss-switch' + (automatic ? ' dss-switch-on' : ''), onClick: () => save({ automatic: !automatic }) }, e('span', { className: 'dss-switch-knob' }))),
          !automatic ? e('div', { className: 'dss-desc' }, '自动操作已暂停，仍可手动同步') : null,
          e('label', { className: 'dss-check' }, e('input', { type: 'checkbox', 'aria-label': '启动时先同步', checked: config.autoPullOnStart !== false, onChange: event => save({ autoPullOnStart: event.target.checked }) }), e('span', { className: 'dss-choice' }, '启动时先同步')),
          e('label', { className: 'dss-check' }, e('input', { type: 'checkbox', 'aria-label': '退出时保存上传', checked: config.autoPushOnExit !== false, onChange: event => save({ autoPushOnExit: event.target.checked }) }), e('span', { className: 'dss-choice' }, '退出时保存上传', e('small', null, '从菜单完全退出 DSH 后上传，下次启动显示结果'))),
          setup ? e('button', { type: 'button', className: 'dss-pill dss-primary', style: { marginTop: '12px' },
            'data-continue': 'true',
            onClick: () => { if (!busy && !uncertain && !savingRef.current) onSaved?.(); } }, '继续') : null) : null,
        e('div', { className: 'dss-save-state', role: 'status', 'aria-live': 'polite' }, saving ? '正在保存…' : message));
    }

    function HandoffCard({ handoff }) {
      if (!handoff) return null;
      const short = sha => String(sha || '').slice(0, 10);
      return e('div', { className: 'dss-tip', role: 'region', 'aria-label': '设备交接记录' },
        e('div', { className: 'dss-h' }, '设备交接 · ' + handoff.deviceName),
        handoff.uploaded ? e('div', { className: 'dss-desc' }, '最后上传：' + short(handoff.uploaded.scope.main)) : null,
        handoff.received ? e('div', { className: 'dss-desc' }, '最后取回：' + short(handoff.received.scope.main)) : null,
        handoff.uploaded && !handoff.peers?.length ? e('div', { className: 'dss-desc' }, '尚未收到另一台电脑取回这次上传的回执。') : null,
        (handoff.peers || []).map(peer => e('div', { key: peer.deviceId, className: 'dss-desc' }, peer.deviceName + (peer.exactMain ? ' 已取回你的最后上传' : ' 已将你的最后上传并入自己的版本')
          + (peer.mainComplete === false ? '（部分主数据范围未确认）' : '')
          + (peer.workspaceComplete ? '（含对应项目文件）' : '（主数据；项目文件尚未全部确认）') + ' · ' + new Date(peer.appliedAt).toLocaleString())),
        handoff.warning ? e('div', { className: 'dss-desc' }, handoff.warning) : null,
        handoff.meaning ? e('details', null, e('summary', null, '回执说明'), e('div', { className: 'dss-desc' }, handoff.meaning)) : null);
    }

    function RecoveryItem({ record, busy, onRestored }) {
      const [preview, setPreview] = useState(null);
      const [workspaceId, setWorkspaceId] = useState('');
      const [message, setMessage] = useState('');
      const [loading, setLoading] = useState(false);
      const show = async () => {
        setLoading(true); setMessage('');
        try { const d = await API.recoveryPreview(record.id); if (!d.ok) throw new Error(d.error); setPreview(d); }
        catch (err) { setMessage(err.message || String(err)); }
        finally { setLoading(false); }
      };
      const restore = async side => {
        if (!preview || loading || busy) return;
        if (!window.confirm('将项目文件「' + record.path + '」恢复为' + (side === 'remote' ? '远端' : '当时本机') + '版本？当前文件会先备份，此修改会在下次同步时上传。')) return;
        setLoading(true);
        try {
          const d = await API.recoveryRestore(record.id, side, preview.currentHash);
          if (!d.ok) throw new Error(d.error);
          setMessage('已恢复；恢复前版本已备份。下次同步会传输此修改。'); setPreview(null); onRestored();
        } catch (err) { setMessage(err.message || String(err)); setPreview(null); }
        finally { setLoading(false); }
      };
      const sideView = (side, title) => {
        const value = preview[side];
        return e('div', null, e('div', { className: 'dss-desc' }, title + (value.sha256 ? ' · SHA-256 ' + value.sha256.slice(0, 12) : '')),
          e('pre', { className: 'dss-pv-pre', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '240px', overflow: 'auto' } },
            value.missing ? '此版本不存在文件' : value.binary ? (value.hint || '二进制原件 · ' + value.bytes + ' 字节') : value.text || '（空文件）'),
          value.truncated ? e('div', { className: 'dss-desc' }, '预览已截断；恢复使用完整原件。') : null,
          preview.canRestore && !value.missing ? e('button', { type: 'button', className: 'dss-pill', disabled: busy || loading, onClick: () => restore(side) }, '恢复' + title) : null,
          preview.sessionImport?.available && !value.missing ? e('button', { type: 'button', className: 'dss-pill', disabled: busy || loading || !workspaceId,
            onClick: async () => {
              if (!window.confirm('将' + title + '建立为所选项目中的独立会话？原会话保持原样，新会话会在下次同步时上传。')) return;
              setLoading(true); setMessage('');
              try { const d = await API.recoveryImport(record.id, side, record.versions[side].sha256, workspaceId);
                if (!d.ok) throw new Error(d.error); setMessage(d.hint + ' 新身份：' + d.sessionId); onRestored?.(); }
              catch (err) { setMessage(err.message || String(err)); }
              finally { setLoading(false); }
            } }, '建立独立会话：' + title) : null);
      };
      return e('div', { className: 'dss-sec' },
        e('div', { className: 'dss-desc' }, (record.kind === 'restore-backup' ? '恢复前备份 · ' : record.kind === 'ws' ? '项目文件 · ' : '主数据 · ') + record.path),
        e('div', { className: 'dss-desc' }, new Date(record.createdAt).toLocaleString() + ' · '
          + (record.kind === 'restore-backup' ? '恢复前版本已保存' : record.status !== 'merged' ? '合并未完成，原件已保存' : record.kept === 'local' ? '合并时保留本机版本' : record.kept === 'remote' ? '合并时采用远端版本' : '合并时生成合并版本')),
        e('button', { type: 'button', className: 'dss-pill', disabled: loading || busy, onClick: show }, loading ? '正在读取…' : '预览双方原件'),
        preview ? e('div', null,
          e('div', { className: 'dss-tip' }, '当前文件：' + (preview.currentHash === preview.local?.sha256 ? '与当时本机版本一致' : preview.currentHash === preview.remote?.sha256 ? '与远端原件一致' : '已修改或已合并；请核对原件后选择')),
          preview.sessionImport?.available ? e('label', { className: 'dss-field' }, '独立会话所属的本机项目',
            e('select', { className: 'dss-input', value: workspaceId, disabled: busy || loading, onChange: ev => setWorkspaceId(ev.target.value) },
              e('option', { value: '' }, '请选择项目'), preview.sessionImport.workspaces.map(ws => e('option', { key: ws.id, value: ws.id }, ws.title)))) : null,
          sideView('local', '当时本机版本'), sideView('remote', '远端版本'),
          !preview.canRestore && !preview.sessionImport?.available ? e('div', { className: 'dss-desc' }, preview.sessionImport?.hint || '此主数据记录仅供预览。') : null) : null,
        message ? e('div', { className: 'dss-desc', role: 'status' }, message) : null);
    }

    function LocalPreview({ busy }) {
      const [preview, setPreview] = useState(null), [error, setError] = useState('');
      const inspect = () => API.preview().then(d => { if (!d.ok) throw new Error(d.error); setPreview(d); setError(''); }).catch(err => setError(err.message || String(err)));
      return e('details', { className: 'dss-sec' }, e('summary', { className: 'dss-h' }, '本机待同步内容'),
        e('div', { className: 'dss-desc' }, '仅本机，未连接远端'),
        e('button', { type: 'button', className: 'dss-pill', disabled: busy, onClick: inspect }, '预览本机改动'),
        error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null,
        preview ? e('div', null, e('div', { className: 'dss-desc' }, preview.hint), (preview.scopes || []).map((scope, i) =>
          e('div', { key: i, className: 'dss-desc' }, (scope.kind === 'main' ? '会话、附件与设置' : '项目文件') + '：新增 ' + scope.added + '，修改 ' + scope.modified + '，删除 ' + scope.deleted))) : null);
    }

    function RecoveryCenter({ busy, lastSyncAt }) {
      const [records, setRecords] = useState([]);
      const [error, setError] = useState('');

      const load = () => API.recovery().then(d => { if (!d.ok) throw new Error(d.error); setRecords(d.records); setError(''); }).catch(err => setError(err.message || String(err)));
      useEffect(() => { load(); }, [lastSyncAt]);
      return e('div', { className: 'dss-sec' },
        e('div', { className: 'dss-h' }, '冲突恢复' + (records.length ? '（' + records.length + '）' : '')),
        e('div', { className: 'dss-desc' }, '本机冲突原件与恢复前备份'),
        e('div', { className: 'dss-desc' }, helpLink('导入中断后的停机修复步骤', DOCS + 'configuration.md#开发源码未完成会话导入的停机修复')),
        error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null,
        records.map(record => e(RecoveryItem, { key: record.id, record, busy, onRestored: load })),
        !records.length ? e('div', { className: 'dss-desc' }, '暂无记录') : null);
    }

    function Section(props) {
      const { busy, status, statusError, progress, run, refresh, review, cancel, cancelling } = useSync();
      const runRef = useRef(null);
      const [setupStep, setSetupStep] = useState(null);
      const [page, setPage] = useState(null);
      const [settingsPending, setSettingsPending] = useState(false);
      const [settingsOpen, setSettingsOpen] = useState(false);
      const [recoveryOpen, setRecoveryOpen] = useState(false);
      const [handoffOpen, setHandoffOpen] = useState(false);
      const stepIds = ['dss-connect', 'dss-scope', 'dss-run', 'dss-result'];
      const goToStep = (number) => {
        setSetupStep(number); setPage('setup');
        if (typeof document !== 'undefined') {
          const target = document.getElementById(stepIds[number - 1]);
          target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
          target?.focus?.({ preventScroll: true });
        }
      };
      const configured = Boolean(status?.remote);
      const currentPage = page || (!status ? 'loading' : configured ? 'sync' : 'setup');
      const nextStep = setupStep || 1;
      const showRun = currentPage === 'sync' || (currentPage === 'setup' && nextStep === 3);
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
      const onRun = () => { if (settingsPending) return Promise.resolve(); setPage('sync'); refresh(); return run(runRef.current).then(() => { loadConflicts(); }); };
      const detail = useMemo(() => (status ? lastDetailText(status.lastDetail) : ''), [status]);

      const statusDesc = (() => {
        if (!status) return '正在读取同步状态…';
        if (status.gitMissing) return '未检测到 git,无法同步 —— 请先安装 git。';
        if (!status.remote) {
          if (status.autoRepo === false) return '仅本地快照 · 未上传';
          return '尚未连接仓库 · 同步时创建或复用 dsh-sync';
        }
        return status.remote + '\n'
          + '分支 ' + status.branch + ' · ' + (status.auto ? '自动同步已开启' : '自动同步已关闭')
          + (status.workspaceCount ? ' · ' + status.workspaceCount + ' 个工作区' : '')
          + (status.ungroupedCount > 0 ? ' · ⚠ ' + status.ungroupedCount + ' 个会话未分组' : '')
          + (status.lastDetail?.cancelled ? ' · 已取消，待下次同步核对' : status.lastDetail?.needsReview && !status.lastDetail.privacy ? ' · 等待确认预览' : status.lastOk === false ? ' · 上次失败' : '')
          + (status.lastMessage ? '\n上次:' + status.lastMessage : '');
      })();

      return e('div', { className: 'dss-wrap' },
        e('style', null, STYLE),
        e(UpdateNotice, null),
        currentPage === 'loading' ? e('div', { className: 'dss-desc', role: 'status' }, '正在读取同步状态…') : null,
        statusError ? e('div', { className: 'dss-err', role: 'alert' }, statusError,
          e('button', { type: 'button', className: 'dss-pill', onClick: refresh, style: { marginLeft: '8px' } }, '重新读取状态')) : null,
        currentPage === 'setup' ? e('div', { className: 'dss-onboarding' },
          e('div', { className: 'dss-onboarding-title' }, '第一次设置'),
          e('div', { className: 'dss-desc' }, '只需设置一次，之后直接同步。'),
          e('nav', { className: 'dss-steps', 'aria-label': '同步设置步骤' },
            ['连接仓库', '选择内容', '首次同步'].map((label,i) => e('button', { key:i, type:'button', disabled: settingsPending || busy, className:'dss-step-link', 'aria-current': nextStep === i+1 ? 'step' : undefined, onClick: () => goToStep(i+1) }, (i+1)+'. '+label))))
          : e('div', { className: 'dss-daily' },
              e('div', { className: 'dss-onboarding-title' }, '日常同步'),
              e('div', { className: 'dss-desc' }, '按已保存的选择在启动与正常退出时同步，也可以随时手动同步。')),
        currentPage === 'setup' && nextStep === 2
          ? e(SyncPreferences, { setup: true, busy, onSavingChange: setSettingsPending, onChanged: refresh, onSaved: () => goToStep(3) }) : null,
        currentPage === 'setup' && nextStep === 1
          ? e(ConnectionSettings, { setup: true, remote: status?.remote, branch: status?.branch, busy, onSaved: () => { refresh(); goToStep(2); } }) : null,
        /* —— 同步组:状态 + 立即同步 —— */
        showRun ? e('div', { className: 'dss-sec', id: 'dss-run', tabIndex: -1 },
          e('div', { className: 'dss-rowline' },
            e('div', { className: 'dss-rowtext' },
              currentPage === 'setup' ? stepHeading(3, '首次同步') : e('div', { className: 'dss-h' }, '同步状态'),
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
              disabled: busy || settingsPending || Boolean(status && status.gitMissing),
              title: '取回远端更新并上传本机改动',
              onClick: onRun,
            }, e(SyncIcon, { spin: busy }), busy ? '同步中' : '立即同步'),
            busy ? e(CancelSyncButton, { progress, cancelling, onCancel: cancel }) : null),
          busy ? e('div', { className: 'dss-desc' }, '取消会保留已完成的保存或上传，剩余内容下次同步继续核对。') : null,
          e(TransferReview, { review, busy: busy || settingsPending, onConfirm: id => run(runRef.current, id) }),
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
              e('div', { className: 'dss-desc' }, '修复分组后重启；有会话正在生成时等待。'),
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
            e('div', { className: 'dss-desc' }, '活动状态未知时需手动重启。')),
          /* 上次结果明细:错误保留很久便于排障 */
          detail
            ? e('details', { open: status && status.lastOk === false ? true : undefined },
                e('summary', null, '上次同步详情' + (status && status.lastSyncAt ? ' · ' + new Date(status.lastSyncAt).toLocaleString() : '')),
                e('div', { className: status && status.lastOk === false ? 'dss-err' : 'dss-desc' }, detail))
            : (status && status.lastOk === false && status.lastMessage
                ? e('div', { className: 'dss-err' }, status.lastMessage)
                : null)) : null,
        currentPage === 'sync' ? e('details', { className: 'dss-sec', open: settingsOpen, onToggle: event => setSettingsOpen(event.currentTarget.open), 'data-sync-settings': true },
          e('summary', { className: 'dss-h' }, '同步设置'),
          settingsOpen ? e('div', null,
            e(SyncPreferences, { busy, onSavingChange: setSettingsPending, onChanged: refresh }),
            e('details', null, e('summary', null, '连接与高级选项'),
              e(ConnectionSettings, { remote: status?.remote, branch: status?.branch, busy: busy || settingsPending, onSaved: refresh }))) : null) : null,
        currentPage === 'sync' ? e('details', { className: 'dss-sec', open: recoveryOpen, onToggle: event => setRecoveryOpen(event.currentTarget.open), 'data-sync-recovery': true },
          e('summary', { className: 'dss-h' }, '需要找回冲突内容？'),
          recoveryOpen ? e(RecoveryCenter, { busy: busy || settingsPending, lastSyncAt: status?.lastSyncAt }) : null) : null,
        currentPage === 'sync' ? e('details', { className: 'dss-sec', open: handoffOpen, onToggle: event => setHandoffOpen(event.currentTarget.open), 'data-sync-handoff': true },
          e('summary', { className: 'dss-h' }, '交接与换机检查'),
          handoffOpen ? e('div', null,
            e(HandoffCard, { handoff: status?.handoff }),
            e('details', null, e('summary', null, '本机变化与诊断'), e(LocalPreview, { busy })),
            notice('当前同步状态',
              busy ? '同步还在进行，请等待完成。'
                : status?.lastOk === false ? '本次同步未完成，请查看同步详情并重试。'
                : !status?.lastSyncAt ? '尚无同步结果。'
                : !status.remote ? '已保存本地快照，尚未上传云端。'
                : '本机同步已完成，仍需在另一台电脑打开会话和附件核对。'),
            e('ol', null,
              e('li', null, '另一台电脑安装插件，连接同一个 GitHub 私有仓库和分支。'),
              e('li', null, '同步后打开已有会话，核对内容、附件与项目文件。'),
              e('li', null, '新增一条测试对话并同步，再回这台电脑取回检查。')),
            e('div', { className: 'dss-desc' }, 'API 密钥、插件与项目依赖需在新电脑单独配置。')) : null) : null,
        /* —— 本机新创建的工作区:路径已按本机主目录重映射,可换位置 —— */
        (() => {
          if (!showRun) return null;
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
        currentPage === 'sync' && recoveryOpen ? e('details', { className: 'dss-sec' },
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
            : null) : null);
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
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-sync-startup', order: 100 }, StartupSyncOverlay));
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
