// 由 scripts/build-client.mjs 从 src/client/ 生成；请修改 src/client/ 后运行 node scripts/build-client.mjs。
/**
 * dsh-chatsync 浏览器端 bundle
 *
 * - 侧栏导航「同步」入口:sidebar.panellist 与 main 原生面板,图标指示同步活动;
 *   阶段、耗时和操作反馈留在同步页内;
 * - 设置面板「同步」分节:同步速览与立即同步、同步设置、冲突内容和历史数据修复;
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
      run: approval =>
        fetch('/dsh-sync/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approval }),
        }).then(r => r.json()),
      startup: (action, approval) =>
        fetch('/dsh-sync/api/startup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, approval }),
        }).then(r => r.json()),
      maySend: sessionId =>
        fetch('/dsh-sync/api/send-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
          signal: AbortSignal.timeout(10000),
        }).then(r => {
          if (!r.ok) throw new Error('发送前检查暂时不可用');
          return r.json();
        }),
      startupState: signal =>
        fetch('/dsh-sync/api/startup', { signal: signal || AbortSignal.timeout(10000) }).then(r => {
          if (!r.ok) throw new Error('状态连接暂时中断');
          return r.json();
        }),
      status: () => fetch('/dsh-sync/api/status').then(r => r.json()),
      grouping: () => fetch('/dsh-sync/api/grouping', { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
      preview: () => fetch('/dsh-sync/api/preview').then(r => r.json()),
      workspaceHistory: (action, body) =>
        fetch('/dsh-sync/api/workspace-history/' + action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then(r => r.json()),
      recovery: () => fetch('/dsh-sync/api/recovery').then(r => r.json()),
      recoveryPreview: id =>
        fetch('/dsh-sync/api/recovery/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        }).then(r => r.json()),
      recoveryRestore: (id, side, expectedHash) =>
        fetch('/dsh-sync/api/recovery/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, side, expectedHash }),
        }).then(r => r.json()),
      recoveryArchive: (record, archived) =>
        fetch('/dsh-sync/api/recovery/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: record.id,
            archived,
            expectedVersions: Object.fromEntries(
              ['local', 'remote'].map(side => [side, record.versions[side].missing ? null : record.versions[side].sha256]),
            ),
          }),
        }).then(r => r.json()),
      recoveryImport: (id, side, expectedHash, workspaceId) =>
        fetch('/dsh-sync/api/recovery/import-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, side, expectedHash, workspaceId }),
        }).then(r => r.json()),
      preserveBranches: body =>
        fetch('/dsh-sync/api/recovery/preserve-branches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then(r => r.json()),
      dataHealth: () => fetch('/dsh-sync/api/data-health/scan').then(r => r.json()),
      localStorage: (action = 'scan', body) =>
        fetch('/dsh-sync/api/local-storage/' + action, {
          method: action === 'scan' ? 'GET' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: action === 'scan' ? undefined : JSON.stringify(body || {}),
          signal: AbortSignal.timeout(120000),
        }).then(r => r.json()),
      dataRepair: (action, body = {}) =>
        fetch('/dsh-sync/api/data-health/' + action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then(r => r.json()),
      update: () => fetch('/dsh-sync/api/update').then(r => r.json()),
      progress: () => fetch('/dsh-sync/api/progress').then(r => r.json()),
      config: () => fetch('/dsh-sync/api/config').then(r => r.json()),
      saveConnection: patch =>
        fetch('/dsh-sync/api/connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }).then(r => r.json()),
      checkConnection: () => fetch('/dsh-sync/api/connection/check').then(r => r.json()),
      remoteCleanup: () => fetch('/dsh-sync/api/remote-cleanup').then(r => r.json()),
      repoUsage: () => fetch('/dsh-sync/api/repo-usage', { signal: AbortSignal.timeout(300000) }).then(r => r.json()),
      sessions: () => fetch('/dsh-sync/api/sessions').then(r => r.json()),
      removeSessions: ids =>
        fetch('/dsh-sync/api/sessions/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        }).then(r => r.json()),
      applyRemoteCleanup: body =>
        fetch('/dsh-sync/api/remote-cleanup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then(r => r.json()),
      saveConfig: patch =>
        fetch('/dsh-sync/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }).then(r => r.json()),
      workspacePath: (workspaceId, path) =>
        fetch('/dsh-sync/api/workspace/path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId, path }),
        }).then(r => r.json()),
    };

    /* 气泡提示:挂在触发元素附近,结果反馈保留较长时间便于排障(8s 后淡出) */
    function bubble(anchor, text, ok) {
      try {
        const b = document.createElement('div');
        b.className = 'dss-bubble';
        if (!ok) b.classList.add('dss-bubble-err');
        b.textContent = (ok ? '✓ ' : '✗ ') + String(text || '');
        b.setAttribute('role', ok ? 'status' : 'alert');
        // Feedback stays in the current panel's flow, including native dialogs.
        // It cannot cover the account menu, navigation or another settings page.
        const scope = (anchor || document.activeElement)?.closest?.('.dss-wrap,dialog');
        const target = scope?.querySelector('.dss-feedback') || scope;
        if (target) {
          target.querySelectorAll('.dss-bubble').forEach(node => node.remove());
          target.appendChild(b);
        } else return; // Persisted sync results remain available in the sync page.
        setTimeout(() => {
          b.style.opacity = '0';
        }, 8000);
        setTimeout(() => {
          b.remove();
        }, 8600);
      } catch {
        /* ignore */
      }
    }

    const STYLE = [
      '.dss-update{box-sizing:border-box;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:12px;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-secondary,#666);font-size:12px;line-height:1.65}',
      '.dss-update-popup{position:fixed;z-index:40;width:min(360px,calc(100vw - 32px));max-height:calc(100dvh - 72px);overflow:auto;font-size:14px;color:var(--dsw-alias-label-primary,#202124);box-shadow:0 2px 10px rgba(0,0,0,.08);animation:dss-update-in .6s ease-out}',
      '@keyframes dss-update-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}',
      '@media(prefers-reduced-motion:reduce){.dss-update-popup{animation:none}}',
      '.dss-update-heading{display:flex;align-items:center;gap:8px;justify-content:space-between}.dss-update-heading h2{font:inherit;font-weight:600;margin:0}',
      'button.dss-update-close{display:inline-flex;align-items:center;justify-content:center;flex:none;box-sizing:border-box;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#6b7078);cursor:pointer}button.dss-update-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#202124)}button.dss-update-close:focus-visible{outline:2px solid #4d6bfe;outline-offset:2px}.dss-close-mark{position:relative;width:12px;height:12px;pointer-events:none}.dss-close-mark:before,.dss-close-mark:after{content:"";position:absolute;left:0;top:5.25px;width:12px;height:1.5px;background:currentColor;border-radius:1px;transform:rotate(45deg)}.dss-close-mark:after{transform:rotate(-45deg)}@media(pointer:coarse){button.dss-update-close{width:44px;height:44px}}',
      '.dss-update-notes{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0;max-height:150px;overflow:auto}.dss-update-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.dss-update a{color:inherit}.dss-update summary{cursor:pointer}.dss-update-feedback{margin-top:8px;overflow-wrap:anywhere}.dss-update pre{white-space:pre-wrap;user-select:text}',
      '@keyframes dss-spin{to{transform:rotate(360deg)}}',
      /* 结果/进度气泡 */
      '.dss-bubble{box-sizing:border-box;position:fixed;z-index:2147483000;max-width:min(340px,calc(100vw - 24px));padding:8px 12px;border-radius:10px;overflow-wrap:anywhere;',
      'background:var(--dsw-alias-bg-layer-2,rgba(26,26,30,.95));color:var(--dsw-alias-label-primary,#e9e9ee);',
      'border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.3));font-size:12px;line-height:1.55;white-space:pre-wrap;',
      'box-shadow:var(--dsw-elevation-prominent,0 2px 8px rgba(0,0,0,.3));transition:opacity .3s}',
      '.dss-bubble-err{color:var(--dsw-alias-state-error-primary,#f2b8b8)}',
      /* 实时传输行 + 百分比进度条(上传/下载字节与速度) */
      '.dss-tx{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.78));margin-top:4px;white-space:nowrap}',
      '.dss-bar{height:3px;border-radius:2px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.22));overflow:hidden;margin-top:4px;min-width:150px}',
      '.dss-bar-in{height:100%;background:var(--dsw-alias-accent-color,rgba(110,168,254,.85));transition:width .25s}',
      /* 设置分节:对齐原生设置——无框无底色,组间 hairline 分隔 */
      '.dss-wrap{display:flex;flex-direction:column;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,inherit)}',
      '.dss-sec{display:flex;flex-direction:column;gap:12px;padding:20px 0;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22))}',
      '.dss-sec:last-child{border-bottom:none}',
      '.dss-rowline{display:flex;align-items:center;gap:12px}',
      '.dss-rowtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}',
      '.dss-h{color:var(--dsw-alias-label-primary,inherit);font-size:14px;font-weight:400;line-height:22px}',
      '.dss-desc{color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8));font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-all}',
      '.dss-prog{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-tertiary,rgba(127,127,127,.8)));font-size:12px;line-height:18px}',
      /* pill 控件:原生设置同款 hairline 圆角胶囊 */
      '.dss-pill{display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:none;align-self:flex-start;box-sizing:border-box;width:max-content;max-width:100%;min-height:36px;height:auto;padding:7px 16px;border:1px solid var(--dsw-alias-border-l4,rgba(127,127,127,.4));border-radius:10px;background:var(--dsw-alias-bg-layer-2,Canvas);color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px;line-height:20px;white-space:normal;text-align:center;cursor:pointer}',
      '.dss-pill:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
      '.dss-pill:disabled{opacity:.5;cursor:default}',
      '.dss-recovery-list{display:flex;flex-direction:column;gap:0;padding-top:12px}.dss-recovery-item{display:flex;align-items:center;gap:16px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd)}.dss-recovery-item:last-child{border-bottom:0}.dss-recovery-file{flex:1;min-width:0}.dss-recovery-file .dss-h{overflow-wrap:anywhere}.dss-recovery-path{margin:3px 0}.dss-recovery-item>.dss-pill{align-self:center}@media(max-width:480px){.dss-recovery-item{align-items:flex-start;flex-direction:column;gap:10px}.dss-recovery-item>.dss-pill{align-self:flex-start}}',
      '.dss-recovery-dialog{box-sizing:border-box;position:fixed;--dss-dialog-top:var(--dsh-frame-overlay-top,20px);inset:var(--dss-dialog-top) 16px 16px;width:calc(100vw - 32px);max-width:none;height:calc(100dvh - var(--dss-dialog-top) - 16px);max-height:calc(100dvh - var(--dss-dialog-top) - 16px);margin:0 auto;border:1px solid var(--dsw-alias-border-l2,#888);border-radius:14px;padding:20px;background:var(--dsw-alias-bg-layer-1,Canvas);color:var(--dsw-alias-label-primary,CanvasText);font:14px/1.6 system-ui;overflow:hidden}',
      '.dss-recovery-dialog[open]{display:flex;flex-direction:column;gap:12px}.dss-recovery-dialog::backdrop{background:#0009}.dss-recovery-dialog .dss-desc{font-size:13px;line-height:1.6;overflow-wrap:anywhere}.dss-recovery-dialog .dss-pill{color:inherit}.dss-diff-header{display:flex;align-items:flex-start;gap:16px;justify-content:space-between;flex:none}.dss-diff-header>div{min-width:0}.dss-diff-header h2{font-size:19px;margin:0 0 4px}.dss-diff-header .dss-desc{max-height:64px;overflow:auto}',
      '.dss-comparison{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}.dss-diff-tools,.dss-diff-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dss-diff-tools{justify-content:space-between}.dss-diff-grid{flex:1;min-height:100px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);border:1px solid var(--dsw-alias-border-l2,#888);border-radius:8px;overflow:hidden}.dss-diff-side{display:flex;flex-direction:column;min-width:0;min-height:0}.dss-diff-side+section{border-left:1px solid var(--dsw-alias-border-l2,#888)}.dss-diff-title{flex:none;padding:8px 12px;background:var(--dsw-alias-bg-layer-2,ButtonFace);font-size:13px;overflow-wrap:anywhere;min-height:40px}',
      '.dss-diff-pane{flex:1;min-height:0;overflow:scroll;overscroll-behavior:contain;scrollbar-gutter:stable}.dss-diff-lines{width:max-content;min-width:100%;font:13px/24px Consolas,monospace;padding-bottom:12px}.dss-diff-line{height:24px;white-space:pre;padding-right:20px;box-sizing:border-box}.dss-diff-number{display:inline-block;user-select:none;width:48px;text-align:right;padding-right:8px;opacity:.6}.dss-diff-sign{display:inline-block;width:22px;font-weight:bold}.dss-diff-remove{background:light-dark(#ffe1df,#512b31)}.dss-diff-add{background:light-dark(#d9f4e4,#193e30)}.dss-diff-active{box-shadow:inset 0 0 0 2px var(--dsw-alias-accent-color,#4988ea)}.dss-recovery-dialog .dss-tip{padding:8px 12px;margin:0;font-size:13px}.dss-diff-footer{max-height:25vh;overflow:auto;flex:none;font-size:13px}.dss-diff-footer:empty{display:none}.dss-diff-footer .dss-field{margin-top:8px}',
      '@media(max-width:600px){.dss-recovery-dialog{padding:12px}.dss-diff-header h2{font-size:16px}.dss-diff-title{min-height:62px;padding:6px}.dss-diff-number{width:36px}.dss-recovery-badge{white-space:normal}.dss-diff-tools{font-size:13px}}',
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
      '.dss-connection-actions{margin-top:12px}.dss-daily-heading{display:flex;align-items:center;flex-wrap:wrap;gap:12px 20px}.dss-daily-heading .dss-onboarding-title{margin:0}.dss-sidebar-pref{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:14px}.dss-sidebar-pref .dss-err{font-size:12px}',
      '.dss-guide{margin:12px 0;padding:14px 18px;border:1px solid var(--dsw-alias-border-l2,#888);border-radius:12px;line-height:1.7}',
      '.dss-guide ol{margin:8px 0;padding-left:22px}.dss-guide li+li{margin-top:6px}',
      '.dss-onboarding{padding:20px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:16px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04));margin:8px 0 20px}',
      '.dss-onboarding-title{font-size:20px;line-height:1.4;font-weight:650;margin-bottom:8px}',
      '.dss-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:18px 0}',
      '.dss-step-link{display:flex;align-items:center;gap:8px;padding:10px 8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:10px;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}',
      '.dss-step-link[aria-current]{border-color:var(--dsw-alias-accent-color,#3979df);background:var(--dsw-alias-interactive-bg-active,rgba(57,121,223,.1))}',
      '.dss-check{display:flex;align-items:center;gap:8px;margin:10px 0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:9px;line-height:20px}',
      '.dss-check input{flex:none;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-accent-color,#3979df)}',
      '.dss-choice{display:flex;flex-direction:column;gap:2px}.dss-choice small{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit)}',
      '.dss-save-state{font-size:12px;min-height:18px;color:var(--dsw-alias-label-secondary,inherit)}',
      '.dss-step-number{display:inline-flex;align-items:center;justify-content:center;flex:none;width:26px;height:26px;border-radius:50%;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));font-size:13px;font-weight:650}',
      '.dss-step-heading{display:flex;align-items:center;gap:10px;margin-bottom:10px}',
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
      /* Shared spacing and intrinsic sizing also apply inside shell dialogs. */
      '.dss-wrap p,.dss-startup-dialog p{margin:0}.dss-stack{display:flex;flex-direction:column;gap:12px;min-width:0}.dss-actions{display:flex;align-items:center;flex-wrap:wrap;gap:12px}.dss-actions>.dss-pill{align-self:center}.dss-backup-row{display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:12px 0}.dss-backup-row>span{min-width:0;flex:1 1 240px;overflow-wrap:anywhere}.dss-backup-row>.dss-pill{align-self:center}',
      '.dss-wrap .dss-rowline>.dss-pill{align-self:center}.dss-wrap .dss-rowtext>.dss-pill{margin-top:4px}.dss-wrap details.dss-sec{display:block}.dss-wrap details.dss-sec>summary{margin:0}.dss-wrap details.dss-sec>summary~*{margin-top:12px}.dss-recovery-list{max-height:420px;overflow:auto;overscroll-behavior:contain;padding-right:8px}.dss-field,.dss-tip,.dss-guide{min-width:0}.dss-input{min-height:40px}.dss-command{overflow-wrap:anywhere}.dss-save-state:empty,.dss-feedback:empty{display:none}',
      '.dss-feedback .dss-bubble,.dss-startup-dialog .dss-bubble{position:static;max-width:100%;margin-top:12px;box-shadow:none}.dss-panel{box-sizing:border-box;height:100%;overflow:auto;padding:32px clamp(20px,5vw,64px);background:var(--dsw-alias-bg-layer-1,Canvas)}.dss-panel>.dss-wrap{max-width:1000px;margin:auto}.dss-nav-progress{display:inline-flex;align-items:center;gap:3px}.dss-nav-progress small{font-size:10px;max-width:46px;overflow:hidden;white-space:nowrap}',
      '.dss-recovery-dialog .dss-diff-footer{display:flex;flex-direction:column;gap:10px;max-height:22dvh}.dss-recovery-dialog .dss-diff-grid{min-height:0}.dss-diff-actions{gap:12px}@media(max-width:600px){.dss-recovery-dialog{inset:var(--dss-dialog-top) 8px 8px;width:calc(100vw - 16px);height:calc(100dvh - var(--dss-dialog-top) - 8px);max-height:calc(100dvh - var(--dss-dialog-top) - 8px);border-radius:12px;padding:12px}}',
      '.dss-input{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:9px}.dss-wrap :is(button,input,select,a,summary):focus-visible,.dss-recovery-dialog :is(button,input,select,a,summary):focus-visible{outline:2px solid #4d6bfe;outline-offset:3px}',
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
      '.dss-confprev .dss-pv{max-height:60dvh;overflow:auto;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:10px;padding:10px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05))}',
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
      '.dss-startup-dialog{box-sizing:border-box;width:min(480px,calc(100vw - 32px));max-height:calc(100dvh - 48px);margin:auto;padding:28px;border:1px solid var(--dsw-alias-border-l2,#d9dde3);border-radius:16px;background:var(--dsw-alias-bg-layer-2,Canvas);color:var(--dsw-alias-label-primary,CanvasText);box-shadow:0 16px 64px rgba(0,0,0,.22);font:inherit;line-height:1.65;overflow:auto;overflow-wrap:anywhere;pointer-events:auto}',
      '.dss-startup-dialog::backdrop{background:rgba(15,23,42,.38)}',
      '.dss-startup-dialog h2{margin:0 0 12px;font-size:22px;line-height:1.4}.dss-startup-dialog p{margin:0 0 20px;white-space:pre-wrap}',
      '.dss-startup-actions{display:flex;flex-wrap:wrap;gap:12px}.dss-startup-actions .dss-pill{height:auto;min-height:40px;padding:9px 16px;font-size:14px}',
      '.dss-startup-dialog :is(button,a):focus-visible{outline:2px solid var(--dsw-alias-accent-color,#3979df);outline-offset:3px}',
      '.dss-startup-dialog:focus{outline:none}.dss-startup-dialog .dss-startup-primary{background:#2563eb;border-color:#2563eb;color:#fff}.dss-startup-dialog .dss-startup-primary:hover{background:#1d4ed8;border-color:#1d4ed8;color:#fff}',
      '.dss-startup-kicker{font-size:12px;color:var(--dsw-alias-label-secondary,var(--dsw-alias-text-secondary,#687386));margin-bottom:8px}.dss-startup-dialog h2{margin-bottom:8px}.dss-startup-dialog .dss-startup-desc{margin-bottom:20px;color:var(--dsw-alias-label-secondary,var(--dsw-alias-text-secondary,#687386))}',
      '.dss-startup-panel{box-sizing:border-box;min-width:0;max-width:100%;padding:18px;border:1px solid var(--dsw-alias-border-l2,#d9dde3);border-radius:12px;margin-bottom:18px}.dss-startup-panel strong{display:block;margin-bottom:8px}.dss-startup-panel .dss-tx{font-size:14px;line-height:1.65;color:inherit;white-space:normal;overflow-wrap:anywhere;min-width:0;max-width:100%}.dss-startup-panel .dss-bar{height:8px;margin-top:12px;min-width:0;max-width:100%}.dss-startup-meta{margin-top:12px;font-size:12px;color:var(--dsw-alias-label-secondary,var(--dsw-alias-text-secondary,#687386))}',
      '.dss-startup-dialog details{margin:12px 0;font-size:12px}.dss-startup-dialog summary{cursor:pointer}.dss-startup-dialog details p{margin:10px 0 0}.dss-startup-actions{flex-direction:column}.dss-startup-actions button{width:100%;justify-content:center}',
      '.dss-issue{padding:12px 0;border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-issue code{display:block;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:6px}.dss-issue .dss-pill{margin-top:8px}',
      '.dss-bar[aria-valuenow]{overflow:hidden}.dss-bar-pending{overflow:hidden;height:8px;background:var(--dsw-alias-border-l2,#d9dde3);border-radius:8px;margin:12px 0}.dss-bar-pending:after{content:"";display:block;width:35%;height:100%;background:#3979df;border-radius:8px;animation:dss-progress-pulse 1.5s ease-in-out infinite alternate}@keyframes dss-progress-pulse{from{transform:translateX(0)}to{transform:translateX(185%)}}@media(prefers-reduced-motion:reduce){.dss-bar-pending:after{animation:none}.dss-bar-in{transition:none}}',
      '.dss-startup-dialog .dss-pill:focus-visible{outline:2px solid #2563eb;outline-offset:3px}.dss-startup-dialog .dss-pill:disabled{background:#e5e7eb;border-color:#d1d5db;color:#4b5563;opacity:1;cursor:wait}',
      /* One hierarchy and separator rule for all full-page settings groups. */
      '.dss-wrap .dss-sec{border-bottom:0}.dss-wrap>.dss-sec+.dss-sec,.dss-wrap>#dss-data-health{border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-wrap .dss-issue-list>*+*{border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-wrap .dss-issue-list>.dss-sec{padding:16px 0}.dss-wrap .dss-issue-list code{white-space:pre-wrap;overflow-wrap:anywhere}',
      /* Action buttons share DeepSeek blue, including buttons in portal dialogs. */
      'button:is(.dss-pill,.dss-btn,.dss-confbtn,.dss-step-link),.dss-startup-dialog button.dss-pill,.dss-recovery-dialog button.dss-pill{background:#4d6bfe;border-color:#4d6bfe;color:#fff;font-weight:600}button:is(.dss-pill,.dss-btn,.dss-confbtn,.dss-step-link):hover,.dss-wrap .dss-primary:hover,.dss-startup-dialog button.dss-pill:hover{background:#4059df;border-color:#4059df;color:#fff;filter:none}button:is(.dss-pill,.dss-btn,.dss-confbtn,.dss-step-link):disabled,.dss-startup-dialog button.dss-pill:disabled{background:#4d6bfe;border-color:#4d6bfe;color:#fff;opacity:.5;cursor:default}.dss-wrap .dss-switch-on{background:#4d6bfe;border-color:#4d6bfe}.dss-wrap .dss-switch-on .dss-switch-knob{background:#fff}.dss-wrap .dss-check input{accent-color:#4d6bfe}',
      '.dss-diff-legend{display:flex;gap:20px;flex-wrap:wrap;font-size:14px;line-height:1.6}.dss-diff-legend strong{font-weight:750;padding:3px 10px;border-radius:6px}.dss-diff-local{color:light-dark(#a52029,#ffb3b8);background:light-dark(#ffe1df,#512b31)}.dss-diff-remote{color:light-dark(#136c39,#8ce0ae);background:light-dark(#d9f4e4,#193e30)}.dss-recovery-dialog .dss-diff-header h2{font-size:20px}.dss-recovery-dialog :is(button,select,[tabindex]):focus-visible{outline:2px solid #4d6bfe;outline-offset:2px}',
      '.dss-recovery-list{max-height:65dvh}.dss-repair-heading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;padding-bottom:20px}.dss-repair-heading h1{margin:0;font-size:22px;line-height:1.4;font-weight:650}.dss-grouping-notice h2{margin-bottom:24px}.dss-issue-list details{font-size:13px}.dss-issue-list .dss-sec{min-width:0}.dss-guide:focus{outline:none}@media(max-width:600px){.dss-confprev{grid-template-columns:minmax(0,1fr)}.dss-startup-dialog{padding:20px;max-height:calc(100dvh - 24px)}}',
      '.dss-wrap>.dss-sec{border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-wrap>.dss-sec:first-child{border-top:0}button.dss-step-link[aria-current]{background:#4d6bfe;border-color:#4d6bfe;color:#fff}',
      /* Explicit heading levels keep status text subordinate to setting titles. */
      '.dss-wrap .dss-onboarding-title{font-size:24px;line-height:1.4;font-weight:700}.dss-wrap .dss-section-title{font-size:20px;font-weight:650;line-height:1.5;margin:0}.dss-wrap .dss-card-title{font-size:18px;font-weight:650;line-height:1.5;margin:0}.dss-wrap .dss-subtitle{font-size:16px;font-weight:600;line-height:1.5;margin:0}.dss-wrap>.dss-sec{padding-block:28px;gap:18px}.dss-daily{padding-bottom:24px}.dss-settings-body{display:flex;flex-direction:column;gap:20px}.dss-wrap .dss-setting-card{box-sizing:border-box;min-width:0;padding:22px 24px;border:1px solid var(--dsw-alias-border-l2,#d9dde3);border-radius:12px;margin:0;gap:18px}.dss-setting-card .dss-rowtext{gap:16px}.dss-setting-card>.dss-switch{align-self:flex-start;margin-top:4px}.dss-connection-status{font-size:14px;line-height:1.7;font-weight:500;color:var(--dsw-alias-label-secondary,inherit)}.dss-connection-status:before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:#4d6bfe;margin-right:8px;vertical-align:1px}.dss-wrap .dss-subsection-heading{margin-top:24px;padding-top:24px;border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-wrap details.dss-sec>summary>.dss-section-title{display:inline}.dss-utility-card{padding:18px 20px;border:1px solid var(--dsw-alias-border-l2,#d9dde3);border-radius:12px}.dss-wrap .dss-utility-card>summary{font-size:16px;font-weight:600;margin:0}.dss-utility-card[open]>summary{margin-bottom:14px}.dss-utility-card>.dss-desc{margin-top:12px}@media(max-width:600px){.dss-wrap .dss-setting-card{padding:18px 16px}.dss-settings-body{gap:16px}.dss-wrap .dss-utility-card{padding:16px}.dss-wrap .dss-section-title{font-size:20px}}',
      /* Grouped lists: one summary row per group, details folded, a sticky action bar. */
      '.dss-group{border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-group:last-of-type{border-bottom:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-group-row{display:grid;grid-template-columns:20px minmax(0,1fr) auto auto;gap:12px;align-items:center;padding:12px 0}.dss-group-row input{accent-color:#4d6bfe}.dss-group-text{display:flex;flex-direction:column;min-width:0}.dss-group-size{font-size:13px;white-space:nowrap}.dss-group-items{display:flex;flex-direction:column;gap:6px;padding:4px 0 12px 32px}.dss-filter{display:flex;gap:8px;flex-wrap:wrap}.dss-filter button[aria-pressed=true]{border-color:#4d6bfe;color:#4d6bfe}button.dss-link{border:0;background:none;padding:4px;color:#4d6bfe;font:inherit;font-size:13px;cursor:pointer}',
      '.dss-action-bar{position:sticky;bottom:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 16px;margin-top:4px;border:1px solid var(--dsw-alias-border-l2,#d9dde3);border-radius:10px;background:var(--dsw-alias-bg-layer-1,Canvas)}',
      /* Storage overview: one line per kind; dialogs hold the lists. */
      '.dss-storage-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.dss-storage-rows{display:flex;flex-direction:column;margin-top:8px}.dss-storage-row{display:grid;grid-template-columns:7em minmax(0,1fr) auto;gap:12px;align-items:baseline;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-storage-row .dss-err{margin:0}.dss-storage-title{font-weight:600}.dss-confirm-dialog.dss-dialog-wide{width:min(720px,calc(100vw - 32px))}.dss-confirm-dialog .dss-confirm-head{flex:0 1 auto;min-height:0;overflow:auto}.dss-confirm-dialog .dss-confirm-actions{flex:none}.dss-confirm-status{margin-right:auto;align-self:center;font-size:13px;color:var(--dsw-alias-label-secondary,inherit)}.dss-pick{display:flex;align-items:center;gap:8px;padding:6px 0;line-height:20px}.dss-pick input{flex:none;width:16px;height:16px;margin:0;accent-color:#4d6bfe}.dss-pick select{margin-left:auto}.dss-confirm-body .dss-subtitle{margin:12px 0 4px}.dss-confirm-body code{overflow-wrap:anywhere}@media (max-width:480px){.dss-storage-row{grid-template-columns:minmax(0,1fr) auto}.dss-storage-row>.dss-desc,.dss-storage-row>.dss-err{grid-column:1/-1;grid-row:2}}',
      /* Repository usage: a compact table that collapses to two columns on narrow panes. */
      '.dss-usage-table{display:flex;flex-direction:column;font-size:13px}.dss-usage-row{display:grid;grid-template-columns:minmax(0,2fr) repeat(3,minmax(0,1fr));gap:8px;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-usage-row span:not(:first-child){text-align:right;white-space:nowrap}.dss-usage-head{font-weight:600}.dss-usage-list{max-height:320px;overflow:auto;overscroll-behavior:contain}@media (max-width:480px){.dss-usage-row{grid-template-columns:minmax(0,1fr) auto}.dss-usage-row span:nth-child(2),.dss-usage-row span:nth-child(3){display:none}}',
      '.dss-confirm-dialog{box-sizing:border-box;width:min(520px,calc(100vw - 32px));max-height:min(80dvh,640px);padding:0;border:1px solid var(--dsw-alias-border-l2,#888);border-radius:14px;background:var(--dsw-alias-bg-layer-1,Canvas);color:var(--dsw-alias-label-primary,CanvasText);font:14px/1.6 system-ui;overflow:hidden}.dss-confirm-dialog[open]{display:flex;flex-direction:column}.dss-confirm-dialog::backdrop{background:#0009}.dss-confirm-head{padding:16px 20px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-confirm-head h2{font-size:17px;margin:0 0 4px}.dss-confirm-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 20px}.dss-confirm-row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;overflow-wrap:anywhere}.dss-confirm-actions{display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-confirm-dialog button.dss-pill{background:transparent;border-color:var(--dsw-alias-border-l4,rgba(127,127,127,.4));color:inherit;font-weight:500}.dss-confirm-dialog button.dss-primary{background:#4d6bfe;border-color:#4d6bfe;color:#fff}.dss-confirm-dialog button.dss-danger{background:#d93838;border-color:#d93838;color:#fff}',
      '.dss-wrap>.dss-settings-group{padding-top:0}.dss-wrap .dss-setting-card{border:0;border-radius:0;padding:28px 0;gap:20px}.dss-settings-body{gap:0}.dss-settings-body>.dss-setting-card+.dss-setting-card{border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-settings-body>.dss-setting-card:last-child{padding-bottom:0}.dss-scope-fields{display:flex;flex-direction:column;gap:12px;text-align:left}.dss-scope-fields>.dss-check{margin:0;gap:12px;padding:14px 16px}.dss-scope-help{margin-top:4px}.dss-scope-fields>.dss-workspace-locations{margin-top:12px;padding:18px 16px}.dss-scope-fields>.dss-subsection-heading{margin-top:12px;padding-top:24px}.dss-wrap .dss-setting-card>.dss-section-title{text-align:left}.dss-scope-fields .dss-choice{gap:4px}.dss-scope-fields .dss-choice small{font-size:13px;line-height:1.6}',
    ].join('\n');
    /* ---------- 同步图标 ---------- */
    function SyncIcon(props) {
      const size = props.size || 16;
      const style = {
        display: 'block',
        width: size,
        height: size,
        flex: 'none',
        aspectRatio: '1 / 1',
        transformBox: 'view-box',
        transformOrigin: '50% 50%',
        ...(props.spin ? { animation: 'dss-spin .9s linear infinite' } : {}),
      };
      return e(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', style, 'aria-hidden': true },
        e('path', {
          d: 'M13.196152423 5A6 6 0 1 0 14 8',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
        }),
        e('path', {
          d: 'M13.196152423 1.8V5h-3.2',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }
    /* ---------- 同步状态共享(含实时进度轮询) ---------- */
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
      return e(
        'span',
        { className: props.className || null },
        (props.prefix || '') + fmtElapsed(Math.floor((now - startedAt) / 1000) * 1000),
      );
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
      const bar =
        t.pct != null
          ? e(
              'div',
              {
                className: 'dss-bar',
                role: 'progressbar',
                'aria-label': dir + '进度（当前步骤）',
                'aria-valuemin': 0,
                'aria-valuemax': 100,
                'aria-valuenow': Math.max(0, Math.min(100, t.pct)),
              },
              e('div', { className: 'dss-bar-in', style: { width: Math.max(0, Math.min(100, t.pct)) + '%' } }),
            )
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
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, []);
      const startPoll = useCallback(() => {
        stopPoll();
        const tick = () =>
          API.progress()
            .then(setProgress)
            .catch(() => {});
        tick();
        // 1s 轮询:阶段标签/传输条本身有 CSS 过渡,1s 足够跟手;
        // 侧栏按钮与设置分节各有一份 useSync,500ms 时两边合计每秒 4 次请求
        pollRef.current = setInterval(tick, 1000);
      }, [stopPoll]);
      const refresh = useCallback(() => {
        return API.status()
          .then(d => {
            if (!d || !d.ok) throw new Error((d && d.error) || '无法读取同步状态');
            setStatus(d);
            setStatusError('');
            setReview(d.lastDetail?.needsReview && !d.lastDetail.privacy ? d.lastDetail.review : null);
          })
          .catch(err => setStatusError('无法读取同步状态：' + (err.message || String(err))));
      }, []);
      const run = useCallback(
        async (anchor, approval) => {
          if (busy) return;
          runStartedAt.current = Date.now();
          setBusy(true);
          setProgress(null);
          startPoll();
          try {
            const d = await API.run(approval);
            setReview(d?.detail?.needsReview && !d.detail.privacy ? d.detail.review : null);
            if (d?.detail?.needsReview) {
              bubble(anchor, '等待确认同步预览，请打开“同步”查看并继续。', false);
              return;
            }
            bubble(anchor, (d && d.summary) || (d && d.error) || '同步完成', Boolean(d && (d.ok || d.detail?.cancelled)));
          } catch (err) {
            bubble(anchor, err.message || String(err), false);
          } finally {
            stopPoll();
            setBusy(false);
            refresh();
            API.progress()
              .then(setProgress)
              .catch(() => {});
          }
        },
        [busy, refresh, startPoll, stopPoll],
      );
      useEffect(() => {
        refresh();
        // Also observe automatic syncs and runs started from the other slot.
        const timer = setInterval(() => {
          refresh();
          API.progress()
            .then(setProgress)
            .catch(() => {});
        }, 3000);
        return () => {
          clearInterval(timer);
          stopPoll();
        };
      }, [refresh, stopPoll]);
      // The previous run's finished record can answer before the server starts this one;
      // while this slot is starting a run, time it from the click instead of that old start.
      const current =
        busy && !(progress && progress.running)
          ? { running: true, stage: 'prepare', label: '准备同步…', startedAt: runStartedAt.current }
          : progress;
      return {
        busy: busy || Boolean(progress && progress.running),
        status,
        statusError,
        progress: current,
        refresh,
        run,
        review: review || (status?.lastDetail?.needsReview && !status.lastDetail.privacy ? status.lastDetail.review : null),
      };
    }

    // Shared request for the sidebar and settings; never poll alongside sync progress.
    let updateRequest = null,
      updateRequestExpires = 0;
    const updateShown = new Set();
    function loadUpdate() {
      if (!updateRequest || Date.now() >= updateRequestExpires) {
        updateRequestExpires = Date.now() + 6 * 60 * 60 * 1000;
        updateRequest = API.update()
          .then(data => {
            if (!data || !data.ok) updateRequestExpires = Date.now() + 10 * 60 * 1000;
            return data;
          })
          .catch(() => {
            updateRequestExpires = Date.now() + 10 * 60 * 1000;
            return null;
          });
      }
      return updateRequest;
    }
    function TransferReview({ review, busy, onConfirm }) {
      if (!review) return null;
      return e(
        'div',
        { className: 'dss-review', role: 'region', 'aria-label': '同步预览' },
        e('p', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, review.summary),
        e(
          'div',
          { className: 'dss-actions' },
          e(
            'button',
            {
              type: 'button',
              className: 'dss-pill dss-primary dss-startup-primary',
              disabled: Boolean(busy),
              onClick: () => onConfirm(review.id),
            },
            busy ? '正在继续…' : review.confirmLabel || '确认并继续',
          ),
          // Some previews offer a safe alternative answer, such as restoring instead of deleting.
          ...(review.alternatives || []).map(choice =>
            e(
              'button',
              {
                key: choice.id,
                type: 'button',
                className: 'dss-pill',
                disabled: Boolean(busy),
                onClick: () => onConfirm(choice.id),
              },
              choice.label,
            ),
          ),
        ),
      );
    }
    // Startup has a small snapshot route: do not rescan all sessions to draw a bar.
    function useStartupState() {
      const [snapshot, setSnapshot] = useState(null);
      const [connectionError, setConnectionError] = useState('');
      const pending = useRef(null);
      const refresh = useCallback(() => {
        if (pending.current) return pending.current;
        pending.current = API.startupState()
          .then(d => {
            if (!d?.ok) throw new Error(d?.error || '无法读取同步状态');
            setSnapshot(d);
            setConnectionError('');
          })
          .catch(err => setConnectionError(err.message || '状态连接暂时中断'))
          .finally(() => {
            pending.current = null;
          });
        return pending.current;
      }, []);
      useEffect(() => {
        refresh();
        const timer = setInterval(refresh, 1000);
        return () => clearInterval(timer);
      }, [refresh]);
      return { snapshot, refresh, connectionError };
    }
    function StartupProgress({ progress, phase }) {
      const p = progress || {};
      const [now, setNow] = useState(Date.now());
      useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
      }, []);
      const waiting = p.stage === 'wait-lock';
      const transferring = ['fetch', 'pull', 'push'].includes(p.stage);
      const t = transferring ? p.transfer : null;
      const title =
        phase === 'cancelling'
          ? '正在停止'
          : phase === 'restarting'
            ? '正在重新打开 DSH'
            : waiting
              ? '另一端正在同步'
              : t?.op === 'push'
                ? '正在上传本机变化'
                : t
                  ? '正在下载其他电脑的数据'
                  : p.stage === 'verify'
                    ? '正在连接同步仓库'
                    : transferring
                      ? '正在获取同步数据'
                      : '正在核对本机与远端变化';
      const quiet = now - (t?.at || p.at || p.startedAt || now) > 20000;
      return e(
        'div',
        { className: 'dss-startup-panel' },
        e('strong', { role: 'status' }, title),
        t ? e(TransferLine, { t }) : null,
        t?.pct == null
          ? e('div', {
              className: 'dss-bar-pending',
              role: 'progressbar',
              'aria-label': title,
              'aria-valuetext': '进行中，当前步骤无法计算百分比',
            })
          : null,
        !t || t.pct === 100
          ? e(
              'div',
              { className: 'dss-startup-meta' },
              waiting ? '正在等待另一端完成同步。' : t?.pct === 100 ? '正在校验收到的数据。' : p.label || '正在检查…',
            )
          : null,
        quiet ? e('div', { className: 'dss-startup-meta', role: 'status' }, '20 秒未收到新进度。') : null,
        p.startedAt
          ? e('div', { className: 'dss-startup-meta' }, e(ElapsedText, { startedAt: p.startedAt, prefix: '本轮已用时 ' }))
          : null,
      );
    }
    function WorkspaceHistoryRepair({ workspaceId }) {
      const [preview, setPreview] = useState(null),
        [message, setMessage] = useState(''),
        [busy, setBusy] = useState(false);
      const run = async () => {
        if (busy) return;
        setBusy(true);
        try {
          const result = await API.workspaceHistory(
            preview ? 'apply' : 'preview',
            preview ? { previewId: preview.previewId } : { workspaceId },
          );
          if (!result.ok) throw new Error(result.error);
          setMessage(result.message);
          setPreview(preview ? null : result);
        } catch (error) {
          setMessage(error.message);
          setPreview(null);
        } finally {
          setBusy(false);
        }
      };
      return e(
        'div',
        { className: 'dss-issue' },
        e(
          'button',
          { type: 'button', className: 'dss-pill', disabled: busy, onClick: run },
          busy ? '正在核对…' : preview ? '保留备份并重建待上传历史' : '处理项目旧历史中的大文件',
        ),
        message ? e('p', { role: 'status', className: 'dss-desc' }, message) : null,
      );
    }
    function SyncIssues({ issues, detail }) {
      const [copied, setCopied] = useState('');
      if (!issues?.length) return null;
      const copy = async issue => {
        try {
          await navigator.clipboard.writeText(issue.location || issue.file);
          setCopied(issue.location || issue.file);
        } catch {
          setCopied('复制失败，请选中文件位置复制。');
        }
      };
      return e(
        'div',
        { className: 'dss-startup-panel dss-issues', role: 'region', 'aria-label': '同步问题详情' },
        e('strong', null, '问题详情 · ' + issues.length + ' 项'),
        ...issues.map((issue, index) =>
          e(
            'div',
            { className: 'dss-issue', key: index },
            e('b', null, issue.scope || '同步'),
            e('div', null, issue.reason),
            issue.file
              ? e('code', null, issue.file + (issue.lines?.length ? ' · 第 ' + issue.lines.join('、') + ' 行' : ''))
              : null,
            e('div', { className: 'dss-startup-meta' }, issue.action),
            issue.location
              ? e(
                  'details',
                  null,
                  e('summary', null, '文件位置'),
                  e('code', null, issue.location),
                  e(
                    'button',
                    { type: 'button', className: 'dss-pill', onClick: () => copy(issue) },
                    copied === (issue.location || issue.file) ? '已复制位置' : '复制位置',
                  ),
                )
              : null,
          ),
        ),
        ...[
          ...new Set(
            (detail?.privacyReports || (detail?.privacy ? [detail.privacy] : []))
              .filter(r => r.workspaceId && r.findings?.some(f => f.reasons?.includes('内容超过单文件扫描上限')))
              .map(r => r.workspaceId),
          ),
        ].map(id => e(WorkspaceHistoryRepair, { key: id, workspaceId: id })),
        copied.startsWith('复制失败') ? e('div', { role: 'status' }, copied) : null,
        detail
          ? e(
              'details',
              { 'data-sync-technical': true },
              e('summary', null, '查看技术记录'),
              e(
                'pre',
                { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '12px' } },
                lastDetailText(detail),
              ),
            )
          : null,
      );
    }
    const sendBlockListeners = new Set();
    function showSendBlock(state) {
      for (const update of sendBlockListeners) update({ ...state, ready: false });
    }
    function installSendProtection(conversation) {
      if (typeof conversation?.sendSession !== 'function') return () => {};
      const original = conversation.sendSession;
      async function guardedSend(session, ...args) {
        let state;
        try {
          state = await API.maySend(session.sessionId);
        } catch (error) {
          state = { allowed: false, message: error.message + '，消息未发送。输入内容和附件已保留。' };
        }
        if (state.ok !== true || !state.allowed) {
          showSendBlock({ sessionId: session.sessionId, message: state.message || '这条会话尚未完成同步，消息未发送。' });
          return { kind: 'error', text: state.message || '同步完成后请再次发送。' };
        }
        const outcome = await original.call(this, session, ...args);
        // The host repeats the check at admission, so a concurrent import cannot
        // slip between preflight and prompt. A rejection restores the same draft.
        if (outcome?.kind === 'error') {
          try {
            const latest = await API.maySend(session.sessionId);
            if (!latest.allowed) showSendBlock({ ...latest, sessionId: session.sessionId });
          } catch {}
        }
        return outcome;
      }
      conversation.sendSession = guardedSend;
      return () => {
        if (conversation.sendSession === guardedSend) conversation.sendSession = original;
      };
    }
    function StartupSyncOverlay() {
      const { snapshot, refresh, connectionError } = useStartupState();
      const [attempt, setAttempt] = useState(null);
      const [feedback, setFeedback] = useState('');
      const [actionPending, setActionPending] = useState(false);
      const dialog = useRef(null);
      const s = snapshot?.startup;
      useEffect(() => {
        sendBlockListeners.add(setAttempt);
        return () => sendBlockListeners.delete(setAttempt);
      }, []);
      useEffect(() => {
        if (!attempt?.sessionId) return;
        let alive = true;
        const check = () =>
          API.maySend(attempt.sessionId)
            .then(state => {
              if (alive)
                setAttempt(previous =>
                  previous && previous.sessionId === attempt.sessionId
                    ? { ...previous, ready: state.ok === true && state.allowed === true }
                    : previous,
                );
            })
            .catch(() => {});
        check();
        const timer = setInterval(check, 1000);
        return () => {
          alive = false;
          clearInterval(timer);
        };
      }, [attempt?.sessionId]);
      useEffect(() => {
        if (!attempt || typeof document === 'undefined' || !dialog.current) return;
        const panel = dialog.current,
          previous = document.activeElement;
        if (!panel.open) panel.showModal();
        return () => {
          if (panel.open) panel.close();
          previous?.focus?.();
        };
      }, [Boolean(attempt)]);
      if (!attempt)
        return e(UpdateNotice, {
          startup: true,
          busy: !snapshot || Boolean(connectionError) || snapshot.progress?.running === true || s?.phase === 'running',
        });
      const retry = async () => {
        setActionPending(true);
        try {
          const result = await API.startup('retry');
          setFeedback(result.error || '');
          await refresh();
        } catch (error) {
          setFeedback(error.message);
        } finally {
          setActionPending(false);
        }
      };
      return e(
        'dialog',
        {
          className: 'dss-startup-dialog',
          ref: dialog,
          tabIndex: -1,
          role: 'dialog',
          'aria-modal': true,
          'aria-label': '发送前同步检查',
          onCancel: () => setAttempt(null),
          onKeyDown: event => event.stopPropagation(),
        },
        e('div', { className: 'dss-startup-kicker' }, 'ChatSync · 发送前检查'),
        e('h2', null, attempt.ready ? '这条会话已完成同步' : '这条会话还不能发送'),
        e('p', { role: 'status' }, attempt.ready ? '请先查看最新对话，再次发送。输入内容和附件已保留。' : attempt.message),
        !attempt.ready && s?.phase === 'running'
          ? e(StartupProgress, { progress: snapshot.progress, phase: s.phase })
          : null,
        !attempt.ready && s?.issues?.length ? e(SyncIssues, { issues: s.issues, detail: s.detail }) : null,
        !attempt.ready && s?.phase === 'pending'
          ? e('p', null, '这条会话正在使用中。可先使用新会话，重新打开 DSH 后继续同步旧会话。')
          : null,
        connectionError || feedback ? e('p', { role: 'alert' }, feedback || '状态连接暂时中断，正在重连。') : null,
        e(
          'div',
          { className: 'dss-startup-actions' },
          e(
            'button',
            { type: 'button', className: 'dss-pill dss-startup-primary', onClick: () => setAttempt(null) },
            attempt.ready ? '返回会话，查看更新' : '返回编辑',
          ),
          !attempt.ready && s?.phase !== 'running'
            ? e(
                'button',
                { type: 'button', className: 'dss-pill', disabled: actionPending, onClick: retry },
                actionPending ? '正在重试…' : '重试同步',
              )
            : null,
        ),
      );
    }

    /* Global startup reminder; settings retain a separate, expandable update entry. */
    function UpdateNotice(props) {
      const [data, setData] = useState(null);
      const [visible, setVisible] = useState(false);
      const [pos, setPos] = useState(null);
      const [feedback, setFeedback] = useState('');
      const [copyFailed, setCopyFailed] = useState(false);
      useEffect(() => {
        let live = true;
        loadUpdate().then(result => {
          if (!live || !result || !result.ok || !result.available) return;
          setData(result);
          const key = 'dss-update-seen-' + result.hostKind + '-' + result.latestVersion;
          let seen = updateShown.has(key);
          try {
            seen = seen || window.localStorage.getItem(key) === '1';
          } catch {
            /* in-memory fallback */
          }
          setVisible(!props.startup || !seen);
        });
        return () => {
          live = false;
        };
      }, []);
      useEffect(() => {
        if (!props.startup || !visible || !data || props.busy) return;
        const position = () => {
          const anchor = props.anchorRef && props.anchorRef.current;
          if (anchor?.getBoundingClientRect) {
            const r = anchor.getBoundingClientRect();
            const bottom = Math.min(window.innerHeight - 80, Math.max(12, window.innerHeight - r.top + 10));
            setPos({
              left: Math.max(12, Math.min(r.left, window.innerWidth - 376)),
              bottom,
              maxHeight: Math.max(60, window.innerHeight - bottom - 12),
            });
          } else {
            // The native sidebar no longer has the old footer button to anchor to.
            setPos({ right: 16, top: 56, maxHeight: Math.max(60, window.innerHeight - 72) });
          }
          const key = 'dss-update-seen-' + data.hostKind + '-' + data.latestVersion;
          updateShown.add(key);
          try {
            window.localStorage.setItem(key, '1');
          } catch {
            /* in-memory fallback */
          }
        };
        position();
        window.addEventListener('resize', position);
        return () => window.removeEventListener('resize', position);
      }, [visible, data, props.busy]);
      if (!visible || !data || (props.startup && (props.busy || !pos))) return null;
      const notes = data.notes || '此版本的更新说明暂时无法读取，请查看完整更新内容。';
      // Plain text only: remote Markdown is never injected as HTML.
      const excerpt = notes
        .replace(/^#+\s+.*$/gm, '')
        .replace(/\*\*/g, '')
        .trim();
      const copy = async () => {
        try {
          await window.navigator.clipboard.writeText(data.command);
          setCopyFailed(false);
          setFeedback(
            '已复制更新代码，请打开 PowerShell 粘贴并按回车。' +
              (data.hostKind === 'desktop'
                ? '执行前先完全退出桌面应用（含托盘），更新后重新打开。'
                : '更新后重新启动 DSH。'),
          );
        } catch {
          setCopyFailed(true);
          setFeedback(
            '复制失败，请手动复制下方代码，到 PowerShell 粘贴执行。' +
              (data.hostKind === 'desktop'
                ? '执行前先完全退出桌面应用（含托盘），更新后重新打开。'
                : '更新后重新启动 DSH。'),
          );
        }
      };
      const content = e(
        'div',
        null,
        e('div', { className: 'dss-update-notes' }, props.startup ? excerpt.slice(0, 420) : excerpt),
        e(
          'div',
          { className: 'dss-update-actions' },
          e('button', { type: 'button', className: 'dss-btn', onClick: copy }, '复制更新代码'),
          e('a', { href: data.releaseUrl, target: '_blank', rel: 'noopener noreferrer' }, '完整更新内容'),
        ),
        feedback
          ? e(
              'div',
              { className: 'dss-update-feedback', role: 'status' },
              feedback,
              copyFailed ? e('pre', null, data.command) : null,
            )
          : null,
      );
      return e(
        'aside',
        {
          className: 'dss-update' + (props.startup ? ' dss-update-popup' : ''),
          style: props.startup ? pos : { marginBottom: '16px' },
          'aria-label': 'ChatSync 更新提醒',
          onKeyDown: event => {
            if (props.startup && event.key === 'Escape') setVisible(false);
          },
        },
        props.startup
          ? e(
              'div',
              null,
              e(
                'div',
                { className: 'dss-update-heading' },
                e('h2', null, 'ChatSync 有新版本 · ' + data.latestVersion),
                e(
                  'button',
                  {
                    type: 'button',
                    className: 'dss-update-close',
                    'aria-label': '关闭更新提醒',
                    onClick: () => setVisible(false),
                  },
                  e('span', { className: 'dss-close-mark', 'aria-hidden': true }),
                ),
              ),
              content,
            )
          : e('details', null, e('summary', null, 'ChatSync 有新版本 · ' + data.latestVersion + ' · 查看更新'), content),
      );
    }
    /* ---------- 侧栏入口与页面 ---------- */
    let sidebarBinding = null,
      sidebarLoad = null;
    let sidebarState = { value: null, loading: false, saving: false, error: '' };
    const sidebarListeners = new Set();
    function publishSidebarState(patch) {
      sidebarState = { ...sidebarState, ...patch };
      for (const listener of sidebarListeners) listener(sidebarState);
    }
    function acceptSidebarConfig(data) {
      if (!data?.ok || !data.config) throw new Error(data?.error || '无法读取侧边栏设置');
      const value = data.config.showSidebarSync !== false;
      sidebarBinding?.(value);
      publishSidebarState({ value });
      return value;
    }
    function loadSidebarPreference() {
      if (sidebarLoad) return sidebarLoad;
      publishSidebarState({ loading: true, error: '' });
      sidebarLoad = API.config()
        .then(acceptSidebarConfig)
        .catch(error => {
          if (sidebarState.value === null) sidebarBinding?.(true);
          publishSidebarState({ error: error.message || '无法读取侧边栏设置' });
        })
        .finally(() => {
          sidebarLoad = null;
          publishSidebarState({ loading: false });
        });
      return sidebarLoad;
    }
    function useSidebarPreference() {
      const [state, setState] = useState(sidebarState);
      useEffect(() => {
        sidebarListeners.add(setState);
        setState(sidebarState);
        if (sidebarState.value === null) loadSidebarPreference();
        return () => sidebarListeners.delete(setState);
      }, []);
      return state;
    }
    async function toggleSidebarPreference() {
      if (sidebarState.value === null || sidebarState.saving) return;
      const next = !sidebarState.value;
      publishSidebarState({ saving: true, error: '' });
      try {
        const actual = acceptSidebarConfig(await API.saveConfig({ showSidebarSync: next }));
        if (actual !== next) publishSidebarState({ error: '受宿主设置限制，已显示实际选择。' });
      } catch (error) {
        try {
          acceptSidebarConfig(await API.config());
          publishSidebarState({ error: error.message || '保存失败，请重试' });
        } catch {
          publishSidebarState({ value: null, error: '保存状态未知，请重新读取。' });
        }
      } finally {
        publishSidebarState({ saving: false });
      }
    }
    function SidebarVisibilityProvider() {
      useSidebarPreference();
      return null;
    }
    function SidebarVisibilityToggle() {
      const state = useSidebarPreference();
      return e(
        'div',
        { className: 'dss-sidebar-pref' },
        e('span', null, '侧边栏显示同步'),
        e(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-label': '在侧边栏显示同步',
            'aria-checked': state.value === true,
            'aria-busy': state.loading || state.saving,
            disabled: state.value === null || state.saving,
            className: 'dss-switch' + (state.value === true ? ' dss-switch-on' : ''),
            onClick: toggleSidebarPreference,
          },
          e('span', { className: 'dss-switch-knob' }),
        ),
        state.error ? e('span', { role: 'alert', className: 'dss-err' }, state.error) : null,
        state.value === null && state.error
          ? e(
              'button',
              { type: 'button', className: 'dss-pill', disabled: state.loading, onClick: loadSidebarPreference },
              '重新读取',
            )
          : null,
      );
    }

    function SidebarSyncIcon(props = {}) {
      const { busy, progress, status } = useSync();
      const title = busy ? progress?.label || '同步中…' : status?.lastOk === false ? '同步需要处理，点击查看' : '打开同步';
      return e(
        'span',
        { className: 'dss-nav-progress', title, 'aria-label': title },
        e(SyncIcon, { spin: busy, size: props.size || 16 }),
      );
    }
    function SyncPanel() {
      return e('div', { className: 'dss-panel' }, e(Section));
    }
    let repairNavigation = null,
      repairRequest = { mode: 'all', sequence: 0 };
    const repairListeners = new Set();
    function openRepairPage(request = {}) {
      if (!repairNavigation) throw new Error('处理页面尚未就绪，请稍后重试');
      repairRequest = { ...request, sequence: repairRequest.sequence + 1 };
      repairNavigation.selectPanel('dsh-sync-repair');
      for (const listener of repairListeners) listener(repairRequest);
    }
    function RepairPage() {
      const [request, setRequest] = useState(repairRequest);
      const { busy, refresh } = useSync();
      useEffect(() => {
        repairListeners.add(setRequest);
        return () => repairListeners.delete(setRequest);
      }, []);
      const grouping = request.mode === 'grouping';
      return e(
        'main',
        { id: 'dss-repair-page', className: 'dss-panel', 'aria-label': grouping ? '处理未分组会话' : '修复会话问题' },
        e(
          'div',
          { className: 'dss-wrap' },
          e('style', null, STYLE),
          e(
            'header',
            { className: 'dss-repair-heading' },
            e('h1', null, grouping ? '处理未分组会话' : '修复会话问题'),
            e(
              'button',
              { type: 'button', className: 'dss-pill', onClick: () => repairNavigation.selectPanel('dsh-sync') },
              '返回同步',
            ),
          ),
          e(DataHealth, {
            key: request.sequence,
            expanded: true,
            grouping,
            initialIssueKey: request.initialIssueKey,
            busy,
            onVerified: refresh,
          }),
        ),
      );
    }

    function recoveryFileInfo(record) {
      const file = record.path.replace(/\\/g, '/');
      const project = record.kind === 'ws' || record.kind === 'restore-backup';
      const title =
        record.guide?.title ||
        (/^storages\/sync-meta\/.+\.vmap\.json$/.test(file) ? '同步内部账本' : project ? '项目文件' : '用途待确认');
      return {
        name: file.split('/').pop() + '（' + title + '）',
        location: '文件地址：' + (project ? file : '.dsh/' + file),
      };
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
        for (const finding of lastDetail.privacy.findings)
          lines.push('  ' + finding.file + '：' + finding.reasons.join('、'));
        lines.push('检查包含尚未上传的历史快照；仅删除当前文件或新增忽略规则不能移除已经提交的敏感内容。');
      }
      const act = [];
      if (lastDetail.committed) act.push('提交');
      if (lastDetail.pushed) act.push('推送');
      if (lastDetail.pulled && lastDetail.pulled !== 'reset') act.push('拉取(' + lastDetail.pulled + ')');
      if (lastDetail.pulled === 'reset') act.push('整体取回');
      if (act.length) lines.push('本次动作: ' + act.join(' / '));
      if (lastDetail.durationMs != null) lines.push('耗时: ' + (lastDetail.durationMs / 1000).toFixed(1) + 's');
      const transfers = lastDetail.transfers || [];
      for (const [op, label] of [
        ['push', '上传'],
        ['fetch', '下载'],
      ]) {
        const bytes = transfers
          .filter(t => (op === 'push' ? t.op === 'push' : t.op !== 'push'))
          .reduce((sum, t) => sum + (t.size || 0), 0);
        if (bytes) lines.push(label + ': ' + fmtBytes(bytes));
      }
      if (lastDetail.repoSize != null) lines.push('仓库体积: ' + fmtBytes(lastDetail.repoSize));
      if (lastDetail.skipped) lines.push('跳过: ' + lastDetail.skipped);
      for (const w of lastDetail.sessionWarnings || [])
        lines.push(
          '会话未混合合并: ' +
            w.path +
            '；当前保留' +
            (w.kept === 'remote' ? '远端' : '本机') +
            '；本机原件 ' +
            w.localHead +
            '；远端原件 ' +
            w.remoteHead,
        );
      for (const w of lastDetail.sessionDeferred || []) lines.push('会话等待应用: ' + w.hint + '；' + w.file);
      for (const warning of lastDetail.scopeWarnings || []) lines.push(warning);
      if (lastDetail.settingsPause) lines.push(lastDetail.settingsPause);
      if (lastDetail.backupBranch)
        lines.push(
          '备份分支: ' +
            lastDetail.backupBranch +
            (lastDetail.backupPushed === true ? '（已上传）' : '（仅在本机，上传失败）'),
        );
      if (lastDetail.error)
        lines.push(
          (lastDetail.dataVerificationPending || lastDetail.dataRepairQueued ? '待处理: ' : '主数据错误: ') +
            lastDetail.error,
        );
      if (lastDetail.workspaces) {
        const w = lastDetail.workspaces;
        for (const b of w.backups || [])
          lines.push('工作区 ' + b.id + ' 备份分支: ' + b.branch + (b.pushed ? '（已上传）' : '（仅在本机，上传失败）'));
        if (w.total)
          lines.push(
            '工作区: 共 ' +
              w.total +
              ',已同步 ' +
              (w.synced || 0) +
              ',推送 ' +
              (w.pushed || 0) +
              ',拉取 ' +
              (w.pulled || 0) +
              (w.skipped ? ',跳过 ' + w.skipped : ''),
          );
        if (w.errors && w.errors.length) {
          lines.push('工作区失败(' + w.errors.length + '):');
          for (const err of w.errors) lines.push('  - ' + (err.title || err.id || '?') + ': ' + (err.error || '未知错误'));
        }
      }
      if (lastDetail.conflictCopies && lastDetail.conflictCopies.length) {
        lines.push('遗留冲突副本(' + lastDetail.conflictCopies.length + ') 待清理:');
        for (const c of lastDetail.conflictCopies) {
          lines.push(
            '  - ' +
              (c.kind === 'ws' ? '[工作区' + (c.id || '?') + '] ' : '') +
              c.path +
              (c.copy ? '\n      远端版本: ' + c.copy : ''),
          );
        }
      }
      return lines.join('\n');
    }

    /* 常用偏好复用已有配置 API；保存后由宿主重建自动调度，无需重启。 */
    const DOCS = 'https://github.com/dpskk2/dsh-chatsync/blob/main/docs/';
    function helpLink(label, href) {
      return e('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label);
    }
    function stepHeading(number, title) {
      return e(
        'div',
        { className: 'dss-step-heading' },
        e('span', { className: 'dss-step-number', 'aria-hidden': true }, number),
        e('div', { className: 'dss-h' }, title),
      );
    }
    function ConnectionSettings({ busy, onSaved, remote, branch, setup = false }) {
      const [config, setConfig] = useState(null);
      const [draft, setDraft] = useState('');
      const [editing, setEditing] = useState(false);
      const [error, setError] = useState('');
      const [message, setMessage] = useState('');
      const [saving, setSaving] = useState(false);
      const [attempt, setAttempt] = useState(0);
      const dirty = useRef(false);
      const savingRef = useRef(false);
      useEffect(() => {
        if (dirty.current) return;
        let alive = true;
        setError('');
        API.config()
          .then(d => {
            if (!d || !d.ok || !d.config) throw new Error((d && d.error) || '无法读取仓库配置');
            if (alive && !dirty.current) {
              setConfig(d.config);
              setDraft(d.config.remote || '');
            }
          })
          .catch(err => {
            if (alive) setError(err.message || String(err));
          });
        return () => {
          alive = false;
        };
      }, [attempt, remote, branch]);
      const startEditing = () => {
        if (busy || savingRef.current) return;
        dirty.current = true;
        setDraft(config.remote || '');
        setEditing(true);
        setError('');
        setMessage('');
      };
      const cancel = () => {
        if (savingRef.current) return;
        dirty.current = false;
        setEditing(false);
        setError('');
        setDraft(config.remote || '');
        setAttempt(attempt + 1);
      };
      const save = async event => {
        event.preventDefault();
        if (!config || savingRef.current || busy || (config.remote && !editing)) return;
        savingRef.current = true;
        setSaving(true);
        setMessage('');
        setError('');
        try {
          const d = await API.saveConnection({ remote: draft.trim(), expectedRemote: config.remote || '' });
          if (!d || !d.ok || !d.config) throw new Error((d && d.error) || '保存失败，请重试');
          setConfig(d.config);
          setDraft(d.config.remote || '');
          setEditing(false);
          dirty.current = false;
          setMessage(
            d.hint ||
              (d.config.remote ? '已验证并保存备份仓库。' : '已使用默认备份；首次同步时自动创建或复用 dsh-sync 私有仓库。'),
          );
          let ready = true;
          if (!d.config.remote) {
            // The default backup connects on the first sync; check gh now so problems show immediately.
            setMessage('已使用默认备份，正在检查 GitHub 登录…');
            const check = await API.checkConnection().catch(err => ({ ok: false, message: err.message || String(err) }));
            ready = Boolean(check && check.ok);
            if (ready) setMessage(check.message);
            else {
              setMessage('已使用默认备份。');
              setError((check && check.message) || '无法检查 GitHub 登录，请稍后重试。');
            }
          }
          // In setup, stay on this step when the check failed, so the reason stays visible.
          if (onSaved && (ready || !setup)) onSaved();
        } catch (err) {
          setError(err.message || String(err));
        } finally {
          savingRef.current = false;
          setSaving(false);
        }
      };
      const showForm = config && editing;
      const parsedLink = config?.remote?.match(
        /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i,
      );
      return e(
        'form',
        { className: 'dss-sec dss-setting-card', id: 'dss-connect', tabIndex: -1, onSubmit: save },
        setup ? stepHeading(1, '设置备份地址') : e('h2', { className: 'dss-section-title' }, '备份仓库'),
        !config && !error ? e('div', { className: 'dss-desc' }, '正在读取连接设置…') : null,
        error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null,
        !config && error
          ? e('button', { type: 'button', className: 'dss-pill', onClick: () => setAttempt(attempt + 1) }, '重新读取')
          : null,
        config && !showForm
          ? e(
              'div',
              null,
              e(
                'div',
                { className: 'dss-connection-status' },
                config.remote ? (parsedLink ? '已连接备份仓库' : '请更换备份仓库') : '使用默认备份',
              ),
              !config.remote
                ? e('div', { className: 'dss-desc' }, '首次同步时，自动创建或复用当前 GitHub 账号下的 dsh-sync 私有仓库。')
                : parsedLink
                  ? null
                  : e('div', { className: 'dss-err', role: 'alert' }, '现有地址不受支持，请更换为 GitHub 私有仓库。'),
              e(
                'div',
                { className: 'dss-actions dss-connection-actions' },
                !config.remote
                  ? e(
                      'button',
                      { type: 'submit', className: 'dss-pill', disabled: busy || saving },
                      saving ? '正在保存…' : setup ? '使用默认备份并继续' : '使用默认备份',
                    )
                  : null,
                e(
                  'button',
                  { type: 'button', className: 'dss-pill', disabled: busy || saving, onClick: startEditing },
                  config.remote ? '更换备份仓库' : '使用其他仓库',
                ),
                setup && config.remote
                  ? e(
                      'button',
                      { type: 'button', className: 'dss-pill', disabled: busy || saving, onClick: () => onSaved?.() },
                      '继续选择内容',
                    )
                  : null,
              ),
              parsedLink
                ? e(
                    'nav',
                    { className: 'dss-links', 'aria-label': '备份仓库' },
                    helpLink('在 GitHub 查看备份', 'https://github.com/' + parsedLink[1]),
                  )
                : null,
            )
          : null,
        showForm
          ? e(
              'fieldset',
              { disabled: saving || busy, style: { border: 0, margin: 0, padding: 0, minWidth: 0 } },
              e(
                'div',
                { className: 'dss-desc' },
                '默认使用当前 GitHub 账号下的 dsh-sync 私有仓库，首次同步时自动创建或复用。',
              ),
              e(
                'label',
                { className: 'dss-field' },
                '自定义仓库地址（可选）',
                e('input', {
                  className: 'dss-input',
                  type: 'text',
                  value: draft,
                  placeholder: '留空使用默认备份；或填写已有私有仓库地址',
                  autoComplete: 'off',
                  spellCheck: false,
                  onChange: ev => {
                    dirty.current = true;
                    setDraft(ev.target.value);
                    setMessage('');
                    setError('');
                  },
                }),
              ),
              e(
                'div',
                { className: 'dss-desc' },
                '使用其他仓库时，请先在 GitHub 创建私有仓库，再填写地址。保存时检查仓库及写入权限。',
              ),
              editing ? e('div', { className: 'dss-desc' }, '留空并保存可改用默认仓库。原仓库中的备份会保留。') : null,
              e(
                'div',
                { className: 'dss-actions dss-connection-actions' },
                e(
                  'button',
                  { type: 'submit', className: 'dss-pill dss-primary' },
                  saving ? '正在检查并保存…' : setup ? '保存并选择内容' : '保存备份设置',
                ),
                editing ? e('button', { type: 'button', className: 'dss-pill', onClick: cancel }, '取消') : null,
              ),
            )
          : null,
        message ? e('div', { className: 'dss-save-state', role: 'status' }, message) : null,
        e(
          'details',
          { className: 'dss-tip', open: config ? !config.remote : false },
          e('summary', null, 'GitHub 登录帮助'),
          e(
            'ol',
            null,
            e(
              'li',
              null,
              '安装 ',
              helpLink('Git', 'https://git-scm.com/downloads'),
              ' 和 ',
              helpLink('GitHub CLI', 'https://cli.github.com/'),
              '。',
            ),
            e(
              'li',
              null,
              '打开 Windows 终端，运行下面的命令，按提示在浏览器完成授权。',
              e('code', { className: 'dss-command' }, 'gh auth login --hostname github.com --git-protocol https --web'),
            ),
            e('li', null, '两台电脑登录同一 GitHub 账号，即可使用同一个默认备份仓库。'),
          ),
          e(
            'nav',
            { className: 'dss-links', 'aria-label': '仓库连接帮助' },
            helpLink('GitHub 登录说明', 'https://cli.github.com/manual/gh_auth_login'),
            helpLink('代理与高级配置', DOCS + 'configuration.md'),
          ),
        ),
      );
    }
    function WorkspaceLocations({ busy }) {
      const [open, setOpen] = useState(false),
        [workspaces, setWorkspaces] = useState(null);
      const [paths, setPaths] = useState({}),
        [pending, setPending] = useState(false),
        [message, setMessage] = useState('');
      const savingRef = useRef(false);
      const load = async () => {
        setPending(true);
        setMessage('');
        try {
          const data = await API.dataHealth();
          if (!data.ok) throw new Error(data.error);
          setWorkspaces(data.workspaces || []);
        } catch (error) {
          setMessage(error.message || String(error));
        } finally {
          setPending(false);
        }
      };
      return e(
        'details',
        {
          className: 'dss-utility-card dss-workspace-locations',
          open,
          onToggle: event => {
            const next = event.currentTarget.open;
            setOpen(next);
            if (next && workspaces === null && !pending) load();
          },
        },
        e('summary', null, '项目文件保存位置'),
        open
          ? e(
              'div',
              { className: 'dss-stack' },
              e(
                'p',
                { className: 'dss-desc' },
                '选择项目文件同步到这台电脑时的保存位置。换电脑后盘符或目录不同时，可在这里调整。每个项目使用单独的文件夹。',
              ),
              pending ? e('p', { className: 'dss-desc', role: 'status' }, '正在读取…') : null,
              workspaces?.length === 0 ? e('p', { className: 'dss-desc' }, '暂无项目。') : null,
              (workspaces || []).map(ws =>
                e(
                  'label',
                  { key: ws.id, className: 'dss-field' },
                  ws.title,
                  e('input', {
                    className: 'dss-input',
                    value: paths[ws.id] ?? ws.localPath,
                    disabled: busy || pending,
                    onChange: event => setPaths({ ...paths, [ws.id]: event.target.value }),
                  }),
                  e(
                    'button',
                    {
                      type: 'button',
                      className: 'dss-pill',
                      disabled: busy || pending,
                      onClick: async () => {
                        if (busy || savingRef.current) return;
                        savingRef.current = true;
                        setPending(true);
                        setMessage('');
                        try {
                          const data = await API.dataRepair('workspace-path', {
                            workspaceId: ws.id,
                            localPath: paths[ws.id] ?? ws.localPath,
                          });
                          if (!data.ok) throw new Error(data.error);
                          setMessage(data.hint || '已保存本机位置。');
                        } catch (error) {
                          setMessage(error.message || String(error));
                        } finally {
                          savingRef.current = false;
                          setPending(false);
                        }
                      },
                    },
                    '保存本机位置',
                  ),
                ),
              ),
              message ? e('p', { role: 'status', className: 'dss-desc' }, message) : null,
              workspaces === null && !pending
                ? e('button', { type: 'button', className: 'dss-pill', onClick: load }, '重新读取')
                : null,
            )
          : null,
      );
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
      const automatic = config?.automatic ?? config?.enabled !== false;
      const accept = actual => {
        confirmed.current = actual;
        setConfig(actual);
        setUncertain(false);
      };
      useEffect(() => {
        let alive = true;
        setError('');
        API.config()
          .then(d => {
            if (!d?.ok || !d.config) throw new Error(d?.error || '无法读取同步偏好');
            if (alive) accept(d.config);
          })
          .catch(err => {
            if (alive) setError(err.message || String(err));
          });
        return () => {
          alive = false;
        };
      }, [attempt]);
      const save = async patch => {
        if (!confirmed.current || savingRef.current || busy || uncertain) return false;
        const previous = confirmed.current;
        savingRef.current = true;
        setSaving(true);
        onSavingChange?.(true);
        setError('');
        setMessage('');
        setConfig({ ...previous, ...patch });
        try {
          const d = await API.saveConfig(patch);
          if (!d?.ok || !d.config) throw new Error(d?.error || '无法确认保存结果');
          const actual = d.config;
          const overridden = Object.keys(patch).some(key =>
            key === 'contentScope'
              ? Object.keys(patch.contentScope).some(k => actual.contentScope?.[k] !== patch.contentScope[k])
              : key === 'automatic'
                ? (actual.automatic ?? actual.enabled !== false) !== patch.automatic
                : actual[key] !== patch[key],
          );
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
          setSaving(false);
          onSavingChange?.(false);
        }
      };
      return e(
        'div',
        { className: 'dss-sec dss-setting-card', id: 'dss-scope', tabIndex: -1 },
        setup ? stepHeading(2, '选择同步内容') : e('h2', { className: 'dss-section-title' }, '同步内容'),
        !config && !error ? e('div', { className: 'dss-desc' }, '正在读取偏好…') : null,
        error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null,
        (!config && error) || uncertain
          ? e('button', { type: 'button', className: 'dss-pill', onClick: () => setAttempt(attempt + 1) }, '重新读取')
          : null,
        config
          ? e(
              'fieldset',
              {
                className: 'dss-scope-fields',
                disabled: saving || busy || uncertain,
                style: { border: 0, margin: 0, padding: 0, minWidth: 0 },
              },
              [
                ['sessions', '会话', '对话记录与项目分组'],
                ['attachments', '聊天附件', '上传或附加到对话的图片、文件'],
                ['settings', '设置', '模型、界面与插件偏好；密钥、代理和本机路径各自保留'],
              ].map(([key, label, description]) =>
                e(
                  'label',
                  { key, className: 'dss-check' },
                  e('input', {
                    type: 'checkbox',
                    'aria-label': label,
                    checked: config.contentScope?.[key] !== false,
                    onChange: event =>
                      save({
                        contentScope: {
                          sessions: true,
                          attachments: true,
                          settings: true,
                          ...confirmed.current.contentScope,
                          [key]: event.target.checked,
                        },
                      }),
                  }),
                  e('span', { className: 'dss-choice' }, label, e('small', null, description)),
                ),
              ),
              e(
                'label',
                { className: 'dss-check' },
                e('input', {
                  type: 'checkbox',
                  'aria-label': '指令与技能',
                  checked: config.syncInstructions === true,
                  onChange: event => save({ syncInstructions: event.target.checked }),
                }),
                e(
                  'span',
                  { className: 'dss-choice' },
                  '指令与技能',
                  e('small', null, '同步全局 AGENTS.md 与 skills 文件夹；每台电脑各自开关'),
                ),
              ),
              e(
                'label',
                { className: 'dss-check' },
                e('input', {
                  type: 'checkbox',
                  'aria-label': '项目文件',
                  checked: config.workspaceSync !== false,
                  onChange: event => save({ workspaceSync: event.target.checked }),
                }),
                e('span', { className: 'dss-choice' }, '项目文件', e('small', null, '项目文件夹中的文件')),
              ),
              e('div', { className: 'dss-scope-help' }, helpLink('范围与排除规则', DOCS + 'sync-content.md')),
              config.workspaceSync !== false ? e(WorkspaceLocations, { busy: busy || saving || uncertain }) : null,
              e(
                'div',
                { className: 'dss-rowline dss-subsection-heading' },
                e('div', { className: 'dss-rowtext' }, e('h4', { className: 'dss-subtitle' }, '自动同步')),
                e(
                  'button',
                  {
                    type: 'button',
                    role: 'switch',
                    'aria-label': '自动同步',
                    'aria-checked': automatic,
                    className: 'dss-switch' + (automatic ? ' dss-switch-on' : ''),
                    onClick: () => save({ automatic: !automatic }),
                  },
                  e('span', { className: 'dss-switch-knob' }),
                ),
              ),
              !automatic ? e('div', { className: 'dss-desc' }, '自动操作已暂停，仍可手动同步') : null,
              e(
                'label',
                { className: 'dss-check' },
                e('input', {
                  type: 'checkbox',
                  'aria-label': '启动时自动同步',
                  checked: config.autoPullOnStart !== false,
                  onChange: event => save({ autoPullOnStart: event.target.checked }),
                }),
                e('span', { className: 'dss-choice' }, '启动时自动同步'),
              ),
              e(
                'label',
                { className: 'dss-check' },
                e('input', {
                  type: 'checkbox',
                  'aria-label': '退出时自动同步',
                  checked: config.autoPushOnExit !== false,
                  onChange: event => save({ autoPushOnExit: event.target.checked }),
                }),
                e(
                  'span',
                  { className: 'dss-choice' },
                  '退出时自动同步',
                  e('small', null, '完全退出应用后上传本机改动，下次启动显示结果'),
                ),
              ),
              setup
                ? e(
                    'button',
                    {
                      type: 'button',
                      className: 'dss-pill dss-primary',
                      style: { marginTop: '12px' },
                      'data-continue': 'true',
                      onClick: () => {
                        if (!busy && !uncertain && !savingRef.current) onSaved?.();
                      },
                    },
                    '继续',
                  )
                : null,
            )
          : null,
        e('div', { className: 'dss-save-state', role: 'status', 'aria-live': 'polite' }, saving ? '正在保存…' : message),
      );
    }

    function recoveryRows(left, right) {
      const a = left.split('\n'),
        b = right.split('\n');
      // Bound memory and work for large logs; never present positional rows as an exact diff.
      if (a.length * b.length > 400000)
        return {
          limited: true,
          clipped: Math.max(a.length, b.length) > 3000,
          rows: Array.from({ length: Math.min(3000, Math.max(a.length, b.length)) }, (_, i) => [
            a[i],
            b[i],
            a[i] === undefined ? null : i + 1,
            b[i] === undefined ? null : i + 1,
          ]),
        };
      const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
      for (let i = a.length - 1; i >= 0; i--)
        for (let j = b.length - 1; j >= 0; j--)
          table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      const rows = [];
      let i = 0,
        j = 0;
      while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
          rows.push([a[i], b[j], ++i, ++j]);
        } else if (i < a.length && (j === b.length || table[i + 1][j] >= table[i][j + 1])) {
          rows.push([a[i], undefined, ++i, null]);
        } else {
          rows.push([undefined, b[j], null, ++j]);
        }
      }
      return { limited: false, rows };
    }
    function RecoveryComparison({ preview }) {
      const panes = useRef([]),
        [active, setActive] = useState(-1);
      const display = value => (value.missing ? '' : value.text || '');
      const textual = !preview.local.binary && !preview.remote.binary;
      const comparison = useMemo(
        () => (textual ? recoveryRows(display(preview.local), display(preview.remote)) : { rows: [], limited: false }),
        [preview],
      );
      const changes = comparison.limited ? [] : comparison.rows.flatMap((r, i) => (r[0] !== r[1] ? [i] : []));
      const jump = direction => {
        if (!changes.length) return;
        const next =
          active < 0 ? (direction < 0 ? changes.length - 1 : 0) : (active + direction + changes.length) % changes.length;
        setActive(next);
        panes.current.forEach(pane => {
          if (pane) pane.scrollTop = changes[next] * 24;
        });
      };
      const scroll = side => event => {
        const other = panes.current[1 - side],
          own = event.currentTarget;
        if (!other) return;
        // Equal row heights and aligned blank rows make a line scroll exact.
        // Equality checks stop reciprocal scroll events without a timing lock.
        if (other.scrollTop !== own.scrollTop) other.scrollTop = own.scrollTop;
        if (other.scrollLeft !== own.scrollLeft) other.scrollLeft = own.scrollLeft;
      };
      const partial = preview.local.truncated || preview.remote.truncated || comparison.clipped;
      const longest = comparison.rows.reduce((max, row) => Math.max(max, row[0]?.length || 0, row[1]?.length || 0), 0);
      return e(
        'div',
        { className: 'dss-comparison' },
        e(
          'div',
          { className: 'dss-diff-tools' },
          e(
            'span',
            { role: 'status' },
            !textual
              ? '此文件不能进行文本差异比较'
              : comparison.limited
                ? '大文件 · 按行查看'
                : changes.length
                  ? '已加载内容中有 ' + changes.length + ' 行差异'
                  : !!preview.local.missing !== !!preview.remote.missing
                    ? '一侧不存在文件；请结合原件状态查看'
                    : partial
                      ? '已加载部分相同；完整原件尚未比较'
                      : '双方文本相同',
          ),
          changes.length
            ? e(
                'div',
                { className: 'dss-diff-actions' },
                e('button', { type: 'button', className: 'dss-pill', onClick: () => jump(-1) }, '上一处差异'),
                e('button', { type: 'button', className: 'dss-pill', onClick: () => jump(1) }, '下一处差异'),
              )
            : null,
        ),
        e(
          'div',
          { className: 'dss-diff-legend', 'aria-label': '差异颜色说明' },
          e('strong', { className: 'dss-diff-local' }, '− 本机独有'),
          e('strong', { className: 'dss-diff-remote' }, '＋ 远端独有'),
        ),
        comparison.limited ? e('div', { className: 'dss-tip', role: 'status' }, '大文件仅按行号展示，未计算差异。') : null,
        partial ? e('div', { className: 'dss-tip', role: 'status' }, '预览已截断，仅显示部分内容。') : null,
        e(
          'div',
          { className: 'dss-diff-grid', 'aria-label': '双方原件同步滚动比较' },
          [0, 1].map(side => {
            const value = side ? preview.remote : preview.local;
            return e(
              'section',
              { key: side, className: 'dss-diff-side' },
              e(
                'div',
                { className: 'dss-diff-title' },
                side ? '远端原件' : '当时本机原件',
                value.missing ? ' · 此版本没有文件' : value.sha256 ? ' · ' + value.sha256.slice(0, 12) : '',
              ),
              e(
                'div',
                {
                  className: 'dss-diff-pane',
                  tabIndex: 0,
                  'aria-label': side ? '远端原件内容' : '本机原件内容',
                  ref: node => {
                    panes.current[side] = node;
                  },
                  onScroll: scroll(side),
                },
                !textual
                  ? e(
                      'div',
                      { className: 'dss-guide' },
                      value.missing
                        ? '此版本不存在文件'
                        : value.binary
                          ? value.hint || '此文件不支持文本预览'
                          : '另一侧不支持文本预览',
                    )
                  : e(
                      'div',
                      { className: 'dss-diff-lines', style: { minWidth: 'max(100%, ' + (longest + 14) + 'ch)' } },
                      comparison.rows.map((row, index) => {
                        const changed = !comparison.limited && row[0] !== row[1] && row[side] !== undefined;
                        return e(
                          'div',
                          {
                            key: index,
                            className:
                              'dss-diff-line' +
                              (changed ? (side ? ' dss-diff-add' : ' dss-diff-remove') : '') +
                              (changes[active] === index ? ' dss-diff-active' : ''),
                          },
                          e('span', { className: 'dss-diff-number', 'aria-hidden': true }, row[side + 2] ?? ''),
                          e(
                            'span',
                            { className: 'dss-diff-sign', 'aria-hidden': true },
                            changed ? (side ? '+' : '−') : ' ',
                          ),
                          row[side] ?? '',
                        );
                      }),
                    ),
              ),
            );
          }),
        ),
      );
    }

    function RecoveryDialog({ record, preview, onClose, children }) {
      const dialog = useRef(null);
      const close = () => {
        if (dialog.current?.open) dialog.current.close();
        onClose();
      };
      useEffect(() => {
        const node = dialog.current;
        if (node && !node.open) node.showModal();
        return () => {
          if (node?.open) node.close();
        };
      }, []);
      return e(
        'dialog',
        {
          ref: dialog,
          className: 'dss-recovery-dialog',
          'aria-modal': true,
          'aria-label': '比较备份内容',
          onCancel: event => {
            event.preventDefault();
            close();
          },
          onClose,
          onKeyDown: event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
            if (event.key === 'Tab') {
              const node = event.currentTarget;
              const focusable = [
                ...node.querySelectorAll(
                  'button:not([disabled]),select:not([disabled]),input:not([disabled]),a[href],[tabindex="0"]',
                ),
              ].filter(item => item.getClientRects().length);
              const first = focusable[0],
                last = focusable[focusable.length - 1],
                active = node.ownerDocument.activeElement;
              if (first && (event.shiftKey ? active === first : active === last)) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
              }
            }
          },
        },
        e(
          'header',
          { className: 'dss-diff-header' },
          e(
            'div',
            null,
            e('h2', null, '比较备份内容'),
            e('div', { className: 'dss-h' }, recoveryFileInfo(record).name),
            e('div', { className: 'dss-desc' }, recoveryFileInfo(record).location),
          ),
          e('button', { type: 'button', className: 'dss-pill', onClick: close }, '关闭'),
        ),
        e(RecoveryComparison, { preview }),
        e('footer', { className: 'dss-diff-footer' }, children),
      );
    }

    function RecoveryItem({ record, busy, onRestored }) {
      const opener = useRef(null);
      const [preview, setPreview] = useState(null);
      const [workspaceId, setWorkspaceId] = useState('');
      const [message, setMessage] = useState('');
      const [loading, setLoading] = useState(false);
      const show = async () => {
        if (preview) {
          setPreview(null);
          return;
        }
        setLoading(true);
        setMessage('');
        try {
          const d = await API.recoveryPreview(record.id);
          if (!d.ok) throw new Error(d.error);
          setPreview(d);
        } catch (err) {
          setMessage(err.message || String(err));
        } finally {
          setLoading(false);
        }
      };
      const restore = async side => {
        if (!preview || loading || busy) return;
        if (
          !window.confirm(
            '将项目文件「' +
              record.path +
              '」恢复为' +
              (side === 'remote' ? '远端' : '当时本机') +
              '版本？当前文件会先备份，此修改会在下次同步时上传。',
          )
        )
          return;
        setLoading(true);
        try {
          const d = await API.recoveryRestore(record.id, side, preview.currentHash);
          if (!d.ok) throw new Error(d.error);
          setMessage('已恢复，原版本已备份。');
          setPreview(null);
          onRestored();
        } catch (err) {
          setMessage(err.message || String(err));
          setPreview(null);
        } finally {
          setLoading(false);
        }
      };
      const sideView = (side, title) => {
        const value = preview[side];
        return e(
          'div',
          { className: 'dss-diff-actions' },
          preview.canRestore && !value.missing
            ? e(
                'button',
                { type: 'button', className: 'dss-pill', disabled: busy || loading, onClick: () => restore(side) },
                '恢复' + title,
              )
            : null,
          preview.sessionImport?.available && !value.missing
            ? e(
                'button',
                {
                  type: 'button',
                  className: 'dss-pill',
                  disabled: busy || loading || !workspaceId,
                  onClick: async () => {
                    if (
                      !window.confirm(
                        '将' + title + '建立为所选项目中的独立会话？原会话保持原样，新会话会在下次同步时上传。',
                      )
                    )
                      return;
                    setLoading(true);
                    setMessage('');
                    try {
                      const d = await API.recoveryImport(record.id, side, record.versions[side].sha256, workspaceId);
                      if (!d.ok) throw new Error(d.error);
                      setMessage(d.hint + ' 新身份：' + d.sessionId);
                      onRestored?.();
                    } catch (err) {
                      setMessage(err.message || String(err));
                    } finally {
                      setLoading(false);
                    }
                  },
                },
                '另存' + title + '为会话',
              )
            : null,
        );
      };
      return e(
        'article',
        { className: 'dss-recovery-item' },
        e(
          'div',
          { className: 'dss-recovery-file' },
          e('div', { className: 'dss-h' }, recoveryFileInfo(record).name),
          e('div', { className: 'dss-desc dss-recovery-path' }, recoveryFileInfo(record).location),
          e(
            'div',
            { className: 'dss-desc' },
            new Date(record.createdAt).toLocaleString() +
              ' · ' +
              (record.kind === 'restore-backup'
                ? '恢复前备份'
                : record.kind === 'scope-backup'
                  ? '同步前备份'
                  : record.kind === 'data-repair'
                    ? record.status === 'repaired'
                      ? '已完成修复的备份'
                      : '修复预览原件'
                    : record.status !== 'merged'
                      ? '合并未完成'
                      : record.kept === 'local'
                        ? '已保留本机版本'
                        : record.kept === 'remote'
                          ? '已采用远端版本'
                          : '已合并'),
          ),
        ),
        e(
          'button',
          {
            ref: opener,
            type: 'button',
            className: 'dss-pill',
            'aria-expanded': !!preview,
            disabled: loading || (!preview && busy),
            onClick: show,
          },
          loading ? '正在读取…' : preview ? '关闭内容' : '查看内容',
        ),
        preview
          ? e(
              RecoveryDialog,
              {
                record,
                preview,
                onClose: () => {
                  setPreview(null);
                  opener.current?.focus();
                },
              },
              record.guide?.nextStep ? e('div', { className: 'dss-desc' }, record.guide.nextStep) : null,
              e(
                'div',
                { className: 'dss-tip' },
                '当前文件：' +
                  (preview.currentHash === null
                    ? '本机当前不存在此文件'
                    : preview.currentHash === preview.local?.sha256
                      ? '与当时本机版本一致'
                      : preview.currentHash === preview.remote?.sha256
                        ? '与远端原件一致'
                        : '已有后续更改'),
              ),
              preview.sessionImport?.available
                ? e(
                    'label',
                    { className: 'dss-field' },
                    '独立会话所属的本机项目',
                    e(
                      'select',
                      {
                        className: 'dss-input',
                        value: workspaceId,
                        disabled: busy || loading,
                        onChange: ev => setWorkspaceId(ev.target.value),
                      },
                      e('option', { value: '' }, '请选择项目'),
                      preview.sessionImport.workspaces.map(ws => e('option', { key: ws.id, value: ws.id }, ws.title)),
                    ),
                  )
                : null,
              preview.branches
                ? e(
                    'div',
                    { className: 'dss-tip' },
                    '共同历史 ' +
                      preview.branches.commonEvents +
                      ' 条事件；本机独有 ' +
                      (preview.branches.localEvents - preview.branches.commonEvents) +
                      ' 条，远端独有 ' +
                      (preview.branches.remoteEvents - preview.branches.commonEvents) +
                      ' 条。',
                  )
                : null,
              preview.branches?.divergent && preview.sessionImport?.available
                ? e(
                    'button',
                    {
                      type: 'button',
                      className: 'dss-pill',
                      disabled: busy || loading || !workspaceId,
                      onClick: async () => {
                        if (!window.confirm('将本机和远端独有的对话分别恢复为独立会话？')) return;
                        setLoading(true);
                        try {
                          const d = await API.preserveBranches({
                            id: record.id,
                            workspaceId,
                            expectedLocalHash: record.versions.local.sha256,
                            expectedRemoteHash: record.versions.remote.sha256,
                          });
                          if (!d.ok) throw new Error(d.error);
                          setMessage(d.hint);
                          onRestored?.();
                        } catch (err) {
                          setMessage(err.message);
                        } finally {
                          setLoading(false);
                        }
                      },
                    },
                    '保留两端会话并继续',
                  )
                : null,
              preview.canRestore || preview.sessionImport?.available
                ? e('div', { className: 'dss-diff-actions' }, sideView('local', '本机原件'), sideView('remote', '远端原件'))
                : null,
              ['merged', 'applied', 'repaired', 'restored'].includes(record.status) &&
                !Object.values(record.imports || {}).some(attempt => attempt.status !== 'verified')
                ? e(
                    'button',
                    {
                      type: 'button',
                      className: 'dss-pill',
                      disabled: busy || loading,
                      onClick: async () => {
                        setLoading(true);
                        try {
                          const d = await API.recoveryArchive(record, record.category !== 'history');
                          if (!d.ok) throw new Error(d.error);
                          setMessage(d.hint);
                          setPreview(null);
                          onRestored?.();
                        } catch (err) {
                          setMessage(err.message || String(err));
                        } finally {
                          setLoading(false);
                        }
                      },
                    },
                    record.category === 'history' ? '重新放入待核对' : '移入历史记录',
                  )
                : null,
              message ? e('div', { role: 'status' }, message) : null,
              !preview.canRestore && !preview.sessionImport?.available
                ? e('div', { className: 'dss-desc' }, '只读预览')
                : null,
            )
          : null,
        message ? e('div', { className: 'dss-desc', role: 'status' }, message) : null,
      );
    }
    function DataHealth({ busy, initialIssueKey, expanded = false, onVerified, grouping = false }) {
      const [scan, setScan] = useState(null),
        [preview, setPreview] = useState(null);
      const previewRef = useRef(null);
      const [pending, setPending] = useState(false),
        [message, setMessage] = useState('');
      const [repairRemote, setRepairRemote] = useState('');
      const [repairWorkspace, setRepairWorkspace] = useState('');
      const perform = async operation => {
        if (busy || pending) return;
        setPending(true);
        setMessage('');
        try {
          const d = await operation();
          if (!d.ok) throw new Error(d.error);
          return d;
        } catch (err) {
          setMessage(err.message || String(err));
        } finally {
          setPending(false);
        }
      };
      const inspect = async () => {
        const d = await perform(API.dataHealth);
        if (d) {
          setScan(d);
          setPreview(null);
        }
      };
      const show = async body => {
        const d = await perform(() => API.dataRepair('preview', body));
        if (d) setPreview(d);
      };
      useEffect(() => {
        if (preview) {
          previewRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
          previewRef.current?.focus?.({ preventScroll: true });
        }
      }, [preview]);
      useEffect(() => {
        if (!expanded) return;
        let alive = true;
        setPending(true);
        (async () => {
          const d = await API.dataHealth();
          if (!d.ok) throw new Error(d.error);
          if (!alive) return;
          setScan(d);
          if (d.queued) {
            setMessage('已有已确认的修复安排。请使用下方“关闭并修复”执行；若要更换方案，先取消原安排再重新检查。');
            return;
          }
          if (initialIssueKey && d.issues.some(issue => issue.key === initialIssueKey)) {
            const p = await API.dataRepair('preview', { key: initialIssueKey });
            if (!p.ok) throw new Error(p.error);
            if (alive) setPreview(p);
          }
        })()
          .catch(err => {
            if (alive) setMessage(err.message || String(err));
          })
          .finally(() => {
            if (alive) setPending(false);
          });
        return () => {
          alive = false;
        };
      }, [expanded, initialIssueKey]);
      const items = grouping ? scan?.ungroupedSessions || [] : scan?.issues || [];
      return e(
        'section',
        { className: 'dss-sec', 'aria-label': grouping ? '未分组会话处理' : '检查与修复' },
        grouping && scan && !items.length
          ? null
          : e(
              'p',
              { className: 'dss-desc' },
              grouping ? '选择会话，再选择要放入的项目。' : '检查会话未分组、消息打不开和项目归属不对的问题。',
            ),
        scan?.verificationPending
          ? e(
              'div',
              { className: 'dss-guide', role: 'region', 'aria-label': '核对修复结果' },
              e('h2', { className: 'dss-section-title' }, '检查修复结果'),
              e(
                'ol',
                null,
                e('li', null, '回到左侧项目和会话列表，找到刚修复的会话，确认它位于你预期的项目中，且没有重复或遗漏。'),
                e('li', null, '打开这些会话，查看最近几条消息，确认正文完整；有附件时，点开确认能正常查看。'),
                e('li', null, '检查无误后回到这里，点击「已检查修复结果，允许同步」，再点上方「立即同步」。'),
              ),
              e('p', { className: 'dss-desc' }, '如果消息仍有缺失或项目归属不对，可在下方继续检查，或查看撤销修复的方案。'),
              e(
                'button',
                {
                  type: 'button',
                  className: 'dss-pill',
                  disabled: busy || pending,
                  onClick: async () => {
                    const d = await perform(() => API.dataRepair('verify'));
                    if (d) {
                      setMessage(d.hint);
                      setScan({ ...scan, verificationPending: false });
                      onVerified?.();
                    }
                  },
                },
                '已检查修复结果，允许同步',
              ),
            )
          : null,
        e(
          'button',
          { type: 'button', className: 'dss-pill', disabled: busy || pending, onClick: inspect },
          pending ? '正在检查…' : scan ? '重新检查' : '检查本机数据',
        ),
        scan
          ? e(
              'div',
              { className: 'dss-stack' },
              e(
                'p',
                { className: 'dss-desc', role: 'status' },
                grouping
                  ? items.length
                    ? '有 ' + items.length + ' 个未分组会话。'
                    : '没有需要修复的未分组会话。'
                  : scan.issues.length
                    ? '发现 ' + scan.issues.length + ' 项会话问题。'
                    : '检查完成，未发现会话问题。',
              ),
              grouping && (scan.ordinaryUngroupedSessions?.length || scan.archivedUngroupedSessions?.length)
                ? e(
                    'div',
                    { className: 'dss-stack' },
                    e('p', { className: 'dss-desc' }, '删除工作区后留下的会话属于正常未分组；归档会话也不需要修复。'),
                    [
                      ['正常未分组', scan.ordinaryUngroupedSessions],
                      ['未分组中的归档会话', scan.archivedUngroupedSessions],
                    ].map(([label, sessions]) =>
                      sessions?.length
                        ? e(
                            'details',
                            { key: label, className: 'dss-utility-card' },
                            e('summary', null, label + '（' + sessions.length + '）'),
                            e(
                              'ul',
                              null,
                              sessions.map(session => e('li', { key: session.sessionId }, session.title)),
                            ),
                          )
                        : null,
                    ),
                  )
                : null,
              !grouping && scan.ungroupedSessions?.length
                ? e(
                    'button',
                    { type: 'button', className: 'dss-pill', onClick: () => openRepairPage({ mode: 'grouping' }) },
                    '处理 ' + scan.ungroupedSessions.length + ' 个未分组会话',
                  )
                : null,
              e(
                'div',
                { className: 'dss-issue-list' },
                items.map(issue =>
                  e(
                    'article',
                    { key: issue.key, className: 'dss-sec' },
                    e('div', { className: 'dss-h' }, issue.title || issue.message),
                    grouping ? e('p', { className: 'dss-desc' }, '原项目文件夹：' + issue.cwd) : null,
                    !grouping && issue.title ? e('p', { className: 'dss-desc' }, issue.message) : null,
                    e('details', null, e('summary', null, '查看记录位置'), e('code', null, issue.file || issue.sessionId)),
                    issue.kind === 'relocate'
                      ? e(
                          'p',
                          { className: 'dss-desc' },
                          '原项目文件夹在这台电脑上不可用。阅读聊天不受影响；继续处理项目文件时，请选择文件已准备好的本机项目。原目录：' +
                            issue.cwd,
                        )
                      : null,
                    issue.kind !== 'missing' || issue.file
                      ? e(
                          'button',
                          {
                            type: 'button',
                            className: 'dss-pill',
                            disabled: busy || pending,
                            onClick: () => show({ key: issue.key, ...(grouping ? { relocate: true } : {}) }),
                          },
                          grouping ? '查看处理方案' : issue.action,
                        )
                      : e('p', null, issue.action),
                    !grouping && issue.kind === 'membership' && !issue.archived
                      ? e(
                          'button',
                          {
                            type: 'button',
                            className: 'dss-pill',
                            disabled: busy || pending,
                            onClick: () => show({ key: issue.key, relocate: true }),
                          },
                          '改到其他本机项目继续',
                        )
                      : null,
                  ),
                ),
              ),
              !grouping && scan.repairBackups?.length
                ? e(
                    'details',
                    { className: 'dss-utility-card' },
                    e('summary', null, '撤销之前的修复'),
                    e(
                      'p',
                      { className: 'dss-desc' },
                      '修复结果不符合预期时，可以恢复到修复前的状态。先查看方案，再确认执行。',
                    ),
                    scan.repairBackups.map(backup =>
                      e(
                        'div',
                        { key: backup.id, className: 'dss-backup-row' },
                        e(
                          'span',
                          { className: 'dss-desc' },
                          new Date(backup.createdAt).toLocaleString() + ' · ' + backup.file,
                        ),
                        e(
                          'button',
                          {
                            type: 'button',
                            className: 'dss-pill',
                            disabled: busy || pending,
                            onClick: () => show({ backupId: backup.id }),
                          },
                          '查看撤销方案',
                        ),
                      ),
                    ),
                  )
                : null,
            )
          : null,
        preview
          ? e(
              'div',
              { className: 'dss-guide', ref: previewRef, tabIndex: -1, role: 'region', 'aria-label': '历史数据修复预览' },
              e('h2', { className: 'dss-section-title' }, '处理方案'),
              e('p', null, preview.warning),
              preview.issue?.cwd
                ? e(
                    'p',
                    { className: 'dss-desc' },
                    preview.relocation
                      ? '原会话使用的目录：' + preview.issue.cwd
                      : '当前登记：' +
                          (preview.issue.currentProjects || []).map(ws => ws.title).join('、') +
                          '；建议按原始目录归位：' +
                          preview.issue.cwd,
                  )
                : null,
              preview.relocation
                ? e(
                    'label',
                    { className: 'dss-field' },
                    '将此会话放入哪个本机项目？',
                    e(
                      'select',
                      {
                        className: 'dss-input',
                        value: repairWorkspace,
                        onChange: ev => setRepairWorkspace(ev.target.value),
                      },
                      e('option', { value: '' }, '请选择本机项目'),
                      (preview.workspaces || []).map(ws => e('option', { key: ws.id, value: ws.id }, ws.title)),
                    ),
                    e(
                      'button',
                      {
                        type: 'button',
                        className: 'dss-pill',
                        disabled: busy || pending || !repairWorkspace,
                        onClick: async () => {
                          if (!window.confirm(preview.warning)) return;
                          const d = await perform(() =>
                            API.dataRepair('import', {
                              recoveryId: preview.recoveryId,
                              expectedHash: preview.expectedHash,
                              workspaceId: repairWorkspace,
                              archiveSource: true,
                            }),
                          );
                          if (d) {
                            setMessage(d.hint);
                            setPreview(null);
                            const fresh = await API.dataHealth();
                            if (fresh.ok) setScan(fresh);
                          }
                        },
                      },
                      '确认项目并恢复会话',
                    ),
                  )
                : null,
              preview.issue?.kind === 'config' && !preview.planId
                ? e(
                    'label',
                    { className: 'dss-field' },
                    '也可重建为手动连接（先备份原配置）',
                    e('input', {
                      className: 'dss-input',
                      value: repairRemote,
                      placeholder: 'GitHub 仓库地址；留空表示暂不连接',
                      onChange: ev => setRepairRemote(ev.target.value),
                    }),
                    e(
                      'button',
                      {
                        type: 'button',
                        className: 'dss-pill',
                        disabled: busy || pending,
                        onClick: () => show({ key: preview.issue.key, replacementConfig: { remote: repairRemote } }),
                      },
                      '预览重建手动配置',
                    ),
                  )
                : null,
              (preview.candidates || []).map(candidate =>
                e(
                  'button',
                  {
                    type: 'button',
                    className: 'dss-pill',
                    key: candidate.hash,
                    disabled: busy || pending,
                    onClick: () => show({ key: preview.issue.key, candidateHash: candidate.hash }),
                  },
                  candidate.source + (candidate.records != null ? ' · ' + candidate.records + ' 行记录' : ''),
                ),
              ),
              (preview.choices || []).map(file =>
                e(
                  'button',
                  {
                    type: 'button',
                    className: 'dss-pill',
                    key: file,
                    disabled: busy || pending,
                    onClick: () => show({ key: preview.issue.key, selectedFile: file }),
                  },
                  '保留 ' + file,
                ),
              ),
              (preview.files || []).map(file => e('p', { key: file.file }, file.file)),
              preview.planId
                ? e(
                    'button',
                    {
                      type: 'button',
                      className: 'dss-pill',
                      disabled: busy || pending,
                      onClick: async () => {
                        if (!window.confirm(preview.warning + '\n\n安排这次修复？完全退出 DSH 后执行。')) return;
                        const d = await perform(() => API.dataRepair('queue', { planId: preview.planId }));
                        if (d) {
                          setMessage(d.hint);
                          setPreview(null);
                          setScan({ ...scan, queued: (scan?.queued || 0) + 1 });
                        }
                      },
                    },
                    '确认预览，安排修复',
                  )
                : !preview.relocation && !(preview.candidates?.length || preview.choices?.length)
                  ? e('p', null, '没有找到可恢复的备份。')
                  : null,
            )
          : null,
        scan?.queued > 0
          ? e(
              'div',
              { className: 'dss-actions' },
              e('p', { style: { flexBasis: '100%' } }, '修复已安排。完全退出后执行；Web 端请退出后稍候再重新打开。'),
              e(
                'button',
                {
                  type: 'button',
                  className: 'dss-pill',
                  disabled: busy || pending,
                  onClick: async () => {
                    const d = await perform(() => API.dataRepair('cancel'));
                    if (d) {
                      setMessage(d.hint);
                      setScan({ ...scan, queued: 0 });
                    }
                  },
                },
                '取消修复安排',
              ),
              e(
                'button',
                {
                  type: 'button',
                  className: 'dss-pill',
                  disabled: busy || pending,
                  onClick: async () => {
                    if (!window.confirm('现在关闭桌面应用，应用已确认的修复，再重新打开？请先结束当前对话。')) return;
                    const d = await perform(() => API.dataRepair('restart'));
                    if (d) setMessage(d.hint);
                  },
                },
                '关闭并修复（桌面端）',
              ),
            )
          : null,
        message ? e('p', { role: 'status' }, message) : null,
      );
    }

    function GroupingRepairOverlay() {
      const [notice, setNotice] = useState(null),
        [error, setError] = useState('');
      const seen = useRef({ candidate: '', dismissed: '' }),
        dialog = useRef(null);
      useEffect(() => {
        let alive = true,
          checking = false;
        const check = async () => {
          if (checking) return;
          checking = true;
          try {
            const d = await API.grouping();
            if (!alive || !d.ok) return;
            if (!d.count) {
              seen.current = { candidate: '', dismissed: '' };
              setNotice(null);
              return;
            }
            const stable = seen.current.candidate === d.signature;
            seen.current.candidate = d.signature;
            if (!d.enabled || d.busy || !stable || seen.current.dismissed === d.signature) return;
            // Defer while another native dialog is open, preserving its input.
            if (typeof document !== 'undefined' && document.querySelector('dialog[open]') && !dialog.current?.open) return;
            setNotice(d);
          } catch {
            /* Retry the local diagnosis on the next poll. */
          } finally {
            checking = false;
          }
        };
        check();
        const timer = setInterval(check, 5000);
        return () => {
          alive = false;
          clearInterval(timer);
        };
      }, []);
      useEffect(() => {
        if (!notice || !dialog.current) return;
        const panel = dialog.current,
          previous = document.activeElement;
        if (!panel.open) panel.showModal();
        return () => {
          if (panel.open) panel.close();
          previous?.focus?.();
        };
      }, [Boolean(notice)]);
      const dismiss = () => {
        seen.current.dismissed = notice.signature;
        setNotice(null);
      };
      if (!notice) return null;
      return e(
        'dialog',
        {
          className: 'dss-startup-dialog dss-grouping-notice',
          ref: dialog,
          role: 'dialog',
          'aria-modal': true,
          'aria-label': '未分组会话修复',
          onCancel: dismiss,
          onKeyDown: event => event.stopPropagation(),
        },
        e('div', { className: 'dss-startup-kicker' }, 'ChatSync'),
        e('h2', null, '发现 ' + notice.count + ' 个未分组会话'),
        error ? e('p', { className: 'dss-err', role: 'alert' }, error) : null,
        e(
          'div',
          { className: 'dss-startup-actions' },
          e(
            'button',
            {
              type: 'button',
              className: 'dss-pill dss-startup-primary',
              onClick: () => {
                try {
                  openRepairPage({ mode: 'grouping' });
                  dismiss();
                } catch (err) {
                  setError(err.message);
                }
              },
            },
            '去处理',
          ),
          e('button', { type: 'button', className: 'dss-pill', onClick: dismiss }, '稍后处理'),
        ),
      );
    }

    function RecoveryCenter({ busy, lastSyncAt }) {
      const [records, setRecords] = useState(null);
      const [error, setError] = useState('');
      const [historyOpen, setHistoryOpen] = useState(false);

      const load = () =>
        API.recovery()
          .then(d => {
            if (!d.ok) throw new Error(d.error);
            setRecords(d.records);
            setError('');
          })
          .catch(err => setError(err.message || String(err)));
      useEffect(() => {
        load();
      }, [lastSyncAt]);
      const history = records?.filter(record => record.category === 'history') || [];
      const attention = records?.filter(record => record.category !== 'history') || [];
      // Most handled records are routine copies kept before overwriting, not conflicts.
      const automatic = history.filter(record =>
        ['scope-backup', 'restore-backup', 'data-repair'].includes(record.kind),
      ).length;
      return e(
        'div',
        { className: 'dss-stack' },
        error
          ? e(
              'div',
              { className: 'dss-err', role: 'alert' },
              error,
              e('button', { type: 'button', className: 'dss-pill', onClick: load }, '重新读取'),
            )
          : null,
        records !== null
          ? e(
              'p',
              { className: 'dss-desc', role: 'status' },
              attention.length
                ? '有 ' + attention.length + ' 条记录待核对。发现消息或文件缺失时，可查看并找回。'
                : '没有待处理的冲突。',
            )
          : null,
        e(
          'div',
          { className: 'dss-recovery-list' },
          attention.map(record => e(RecoveryItem, { key: record.id, record, busy, onRestored: load })),
        ),
        history.length
          ? e(
              'details',
              { open: historyOpen, onToggle: event => setHistoryOpen(event.currentTarget.open) },
              e(
                'summary',
                null,
                '已处理记录与备份（' + history.length + '）',
                e(
                  'small',
                  { className: 'dss-desc' },
                  ' 同步前自动备份 ' + automatic + ' 条，已处理的冲突 ' + (history.length - automatic) + ' 条',
                ),
              ),
              historyOpen
                ? e(
                    'div',
                    { className: 'dss-recovery-list' },
                    history.map(record => e(RecoveryItem, { key: record.id, record, busy, onRestored: load })),
                  )
                : null,
            )
          : null,
        !error && records === null ? e('div', { className: 'dss-desc', role: 'status' }, '正在读取…') : null,
        records?.length === 0 ? e('div', { className: 'dss-desc' }, '暂无冲突记录') : null,
      );
    }
    function Section(props) {
      const { busy, status, statusError, progress, run, refresh, review } = useSync();
      // The settings.section owner passes its close action for flows leaving the modal.
      const openRepair = request => {
        openRepairPage(request);
        props?.close?.();
      };
      const runRef = useRef(null);
      const [setupStep, setSetupStep] = useState(null);
      const [page, setPage] = useState(null);
      const [settingsPending, setSettingsPending] = useState(false);
      const [recoveryOpen, setRecoveryOpen] = useState(false);
      const stepIds = ['dss-connect', 'dss-scope', 'dss-run', 'dss-result'];
      const goToStep = number => {
        setSetupStep(number);
        setPage('setup');
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
      const [autoRestart, setAutoRestart] = useState(null); // null=加载中
      /* 读取/切换「同步后自动重启修复」开关 */
      useEffect(() => {
        let alive = true;
        API.config()
          .then(d => {
            if (alive && d && d.ok) setAutoRestart(d.config && d.config.autoRestartAfterRepair === true);
          })
          .catch(() => {});
        return () => {
          alive = false;
        };
      }, []);
      const toggleAutoRestart = () => {
        const next = !(autoRestart === true);
        setAutoRestart(next);
        API.saveConfig({ autoRestartAfterRepair: next })
          .then(d => {
            if (d && d.ok) bubble(null, next ? '同步后分组检查已开启' : '同步后分组检查已关闭', true);
            else {
              setAutoRestart(!next);
              bubble(null, (d && d.error) || '设置失败', false);
            }
          })
          .catch(err => {
            setAutoRestart(!next);
            bubble(null, err.message || String(err), false);
          });
      };
      const onRun = () => {
        if (settingsPending) return Promise.resolve();
        setPage('sync');
        refresh();
        return run(runRef.current);
      };
      const detail = useMemo(() => (status ? lastDetailText(status.lastDetail) : ''), [status]);
      const verificationPending = status?.dataVerificationPending ?? status?.lastDetail?.dataVerificationPending;
      const repairQueued = status?.queuedRepairs > 0;

      const statusDesc = (() => {
        if (!status) return '正在读取同步状态…';
        if (status.gitMissing) return '未检测到 git,无法同步 —— 请先安装 git。';
        if (!status.remote) {
          if (status.autoRepo === false) return '仅本地快照 · 未上传';
          if (status.remoteNotice) return '尚未连接仓库 · ' + status.remoteNotice;
          return '尚未连接仓库 · 同步时创建或复用 dsh-sync';
        }
        const state = verificationPending
          ? '修复完成，待你核对'
          : repairQueued
            ? '有修复待应用'
            : status.lastDetail?.cancelled
              ? '已取消'
              : status.lastDetail?.needsReview
                ? '等待确认'
                : status.lastOk === false
                  ? '同步异常'
                  : status.lastDetail?.downloadPending
                    ? '有内容待取回'
                    : status.lastDetail?.settingsPause
                      ? '设置暂停同步（DSH 版本不同）'
                      : status.lastOk === true
                        ? '同步正常'
                        : '尚未同步';
        return (
          (status.auto ? '自动同步已开启' : '自动同步已关闭') +
          ' · ' +
          state +
          (status.ungroupedCount > 0 ? ' · ' + status.ungroupedCount + ' 个会话未分组' : '')
        );
      })();

      return e(
        'div',
        { className: 'dss-wrap' },
        e('style', null, STYLE),
        e(UpdateNotice, null),
        currentPage === 'loading' ? e('div', { className: 'dss-desc', role: 'status' }, '正在读取同步状态…') : null,
        statusError
          ? e(
              'div',
              { className: 'dss-err', role: 'alert' },
              statusError,
              e(
                'button',
                { type: 'button', className: 'dss-pill', onClick: refresh, style: { marginLeft: '8px' } },
                '重新读取状态',
              ),
            )
          : null,
        currentPage === 'setup'
          ? e(
              'div',
              { className: 'dss-onboarding' },
              e(
                'div',
                { className: 'dss-daily-heading' },
                e('div', { className: 'dss-onboarding-title' }, '第一次设置'),
                e(SidebarVisibilityToggle),
              ),
              e('div', { className: 'dss-desc' }, '只需设置一次，之后直接同步。'),
              e(
                'nav',
                { className: 'dss-steps', 'aria-label': '同步设置步骤' },
                ['备份地址', '选择内容', '首次同步'].map((label, i) =>
                  e(
                    'button',
                    {
                      key: i,
                      type: 'button',
                      disabled: settingsPending || busy,
                      className: 'dss-step-link',
                      'aria-current': nextStep === i + 1 ? 'step' : undefined,
                      onClick: () => goToStep(i + 1),
                    },
                    i + 1 + '. ' + label,
                  ),
                ),
              ),
            )
          : e(
              'div',
              { className: 'dss-daily' },
              e(
                'div',
                { className: 'dss-daily-heading' },
                e('h1', { className: 'dss-onboarding-title' }, '日常同步'),
                e(SidebarVisibilityToggle),
              ),
            ),
        currentPage === 'setup' && nextStep === 2
          ? e(SyncPreferences, {
              setup: true,
              busy,
              onSavingChange: setSettingsPending,
              onChanged: refresh,
              onSaved: () => goToStep(3),
            })
          : null,
        currentPage === 'setup' && nextStep === 1
          ? e(ConnectionSettings, {
              setup: true,
              remote: status?.remote,
              branch: status?.branch,
              busy,
              onSaved: () => {
                refresh();
                goToStep(2);
              },
            })
          : null,
        /* —— 同步组:状态 + 立即同步 —— */
        showRun
          ? e(
              'div',
              { className: 'dss-sec', id: 'dss-run', tabIndex: -1 },
              e(
                'div',
                { className: 'dss-rowline' },
                e(
                  'div',
                  { className: 'dss-rowtext' },
                  currentPage === 'setup'
                    ? stepHeading(3, '首次同步')
                    : e('h2', { className: 'dss-section-title' }, '同步状态'),
                  busy
                    ? [
                        e(
                          'div',
                          { className: 'dss-prog' },
                          e(SyncIcon, { spin: true }),
                          (progress && progress.label) || '同步中…',
                          progress && progress.startedAt
                            ? e(ElapsedText, { className: 'dss-desc', startedAt: progress.startedAt, prefix: '· ' })
                            : null,
                        ),
                        progress && progress.transfer ? e(TransferLine, { t: progress.transfer }) : null,
                      ]
                    : e('div', null, e('div', { className: 'dss-desc' }, statusDesc)),
                ),
                e(
                  'button',
                  {
                    type: 'button',
                    className: 'dss-pill dss-primary',
                    ref: runRef,
                    disabled: busy || settingsPending || Boolean(status && status.gitMissing),
                    title: '取回远端更新并上传本机改动',
                    onClick: onRun,
                  },
                  e(SyncIcon, { spin: busy }),
                  busy ? '同步中' : '立即同步',
                ),
              ),
              e(TransferReview, { review, busy: busy || settingsPending, onConfirm: id => run(runRef.current, id) }),
              verificationPending || repairQueued
                ? e(
                    'div',
                    { className: 'dss-guide', role: 'status' },
                    e(
                      'div',
                      { className: 'dss-h' },
                      verificationPending ? '同步已暂停：修复完成，待你核对' : '同步已暂停：有修复待执行',
                    ),
                    e(
                      'p',
                      { className: 'dss-desc' },
                      verificationPending
                        ? '先打开修复过的会话，检查消息、附件及所在项目。检查无误后，在下方确认，再点「立即同步」。本轮未上传或下载。'
                        : '修复已安排。请打开处理页执行或取消修复，再继续同步。',
                    ),
                    e(
                      'button',
                      {
                        type: 'button',
                        className: 'dss-pill',
                        disabled: busy || settingsPending,
                        'aria-controls': 'dss-repair-page',
                        onClick: () => openRepair({ mode: 'all' }),
                      },
                      verificationPending ? '前往核对修复结果' : '前往处理修复安排',
                    ),
                  )
                : null,
              !busy && status?.lastOk === false
                ? e(SyncIssues, { issues: status.lastDetail?.issues, detail: status.lastDetail })
                : null,
              /* 上次结果明细:错误保留很久便于排障 */
              detail
                ? e(
                    'details',
                    { open: status && status.lastOk === false ? true : undefined },
                    e(
                      'summary',
                      null,
                      '上次同步详情' +
                        (status && status.lastSyncAt ? ' · ' + new Date(status.lastSyncAt).toLocaleString() : ''),
                    ),
                    e('div', { className: status && status.lastOk === false ? 'dss-err' : 'dss-desc' }, detail),
                  )
                : status && status.lastOk === false && status.lastMessage
                  ? e('div', { className: 'dss-err' }, status.lastMessage)
                  : null,
            )
          : null,
        e('div', { className: 'dss-feedback', 'aria-live': 'polite' }),
        currentPage === 'sync'
          ? e(
              'div',
              { className: 'dss-sec dss-settings-group', 'data-sync-settings': true },
              e(
                'div',
                { className: 'dss-settings-body' },
                e(SyncPreferences, { busy, onSavingChange: setSettingsPending, onChanged: refresh }),
                e(
                  'div',
                  { className: 'dss-rowline dss-restartrow dss-setting-card', 'data-grouping-setting': true },
                  e(
                    'div',
                    { className: 'dss-rowtext' },
                    e('h2', { className: 'dss-section-title' }, '同步后分组检查'),
                    e(
                      'button',
                      { type: 'button', className: 'dss-pill', onClick: () => openRepair({ mode: 'grouping' }) },
                      '处理未分组会话',
                    ),
                  ),
                  autoRestart === null
                    ? e('span', { className: 'dss-desc' }, '正在读取…')
                    : e(
                        'button',
                        {
                          type: 'button',
                          className: 'dss-switch' + (autoRestart ? ' dss-switch-on' : ''),
                          role: 'switch',
                          'aria-checked': autoRestart,
                          'aria-label': '同步后分组检查',
                          disabled: settingsPending,
                          onClick: toggleAutoRestart,
                        },
                        e('span', { className: 'dss-switch-knob' }),
                      ),
                ),
                e(ConnectionSettings, {
                  remote: status?.remote,
                  branch: status?.branch,
                  busy: busy || settingsPending,
                  onSaved: refresh,
                }),
              ),
            )
          : null,
        currentPage === 'sync'
          ? e(
              'details',
              {
                className: 'dss-sec',
                open: recoveryOpen,
                onToggle: event => setRecoveryOpen(event.currentTarget.open),
                'data-sync-recovery': true,
              },
              e('summary', null, e('h2', { className: 'dss-section-title' }, '找回同步前的内容')),
              recoveryOpen
                ? e('p', { className: 'dss-desc' }, '同步后发现消息或文件缺失时，可从这里查看之前的版本。')
                : null,
              recoveryOpen ? e(RecoveryCenter, { busy: busy || settingsPending, lastSyncAt: status?.lastSyncAt }) : null,
            )
          : null,
        currentPage === 'sync'
          ? e(StorageOverview, { busy: busy || settingsPending, remote: Boolean(status?.remote) })
          : null,
        currentPage === 'sync'
          ? e(
              'section',
              { className: 'dss-sec' },
              e('h2', { className: 'dss-section-title' }, '修复会话问题'),
              e('p', { className: 'dss-desc' }, '会话未分组、消息打不开或项目归属不对时，在这里检查并修复。'),
              e(
                'button',
                { type: 'button', className: 'dss-pill', onClick: () => openRepair({ mode: 'all' }) },
                '检查会话问题',
              ),
            )
          : null,
        /* —— 本机新创建的工作区:路径已按本机主目录重映射,可换位置 —— */
        (() => {
          if (!showRun) return null;
          const created =
            status && status.lastDetail && status.lastDetail.workspaces && status.lastDetail.workspaces.created;
          if (!Array.isArray(created) || !created.length) return null;
          return e(
            'div',
            { className: 'dss-sec' },
            e('div', { className: 'dss-h' }, '本机新创建的工作区'),
            created.map(w =>
              e(
                'div',
                { key: w.id, className: 'dss-wsbanner' },
                e(
                  'div',
                  { className: 'dss-wsbanner-text' },
                  e('div', { className: 'dss-wsbanner-title' }, '工作区「' + (w.title || w.id) + '」已在本机创建'),
                  e('div', { className: 'dss-confmeta' }, '路径: ' + w.path),
                  w.recorded && String(w.recorded).toLowerCase() !== String(w.path).toLowerCase()
                    ? e('div', { className: 'dss-confmeta' }, '记录路径: ' + w.recorded + '(按本机主目录自动重映射)')
                    : null,
                ),
                e(
                  'div',
                  { className: 'dss-confbtns' },
                  e(
                    'button',
                    {
                      type: 'button',
                      className: 'dss-btn',
                      onClick: () => {
                        const p = window.prompt(
                          '为工作区「' + (w.title || w.id) + '」选择本机文件夹(留空则恢复按记录路径):',
                          w.path,
                        );
                        if (p === null) return;
                        API.workspacePath(w.id, p.trim())
                          .then(d => {
                            if (d && d.ok) {
                              bubble(null, d.path ? '已换位置: ' + d.path : '已恢复默认', true);
                              refresh();
                              run(runRef.current);
                            } else bubble(null, (d && d.error) || '设置失败', false);
                          })
                          .catch(err => bubble(null, err.message || String(err), false));
                      },
                    },
                    '换位置',
                  ),
                  e(
                    'button',
                    {
                      type: 'button',
                      className: 'dss-btn',
                      onClick: () => {
                        API.workspacePath(w.id, '')
                          .then(d => {
                            if (d && d.ok) {
                              bubble(null, '已恢复按记录路径', true);
                              refresh();
                            } else bubble(null, (d && d.error) || '设置失败', false);
                          })
                          .catch(err => bubble(null, err.message || String(err), false));
                      },
                    },
                    '恢复默认',
                  ),
                ),
              ),
            ),
          );
        })(),
      );
    }
    /* ---------- 同步仓库与本机存储 ---------- */
    // One section with a summary line per kind; lists, choices and confirmations open
    // in a dialog whose body scrolls while its buttons stay in view.
    function Modal({ title, note, wide = false, onClose, children }) {
      const dialog = useRef(null);
      useEffect(() => {
        const node = dialog.current;
        if (node && !node.open) node.showModal?.();
        return () => {
          if (node?.open) node.close();
        };
      }, []);
      return e(
        'dialog',
        {
          ref: dialog,
          className: 'dss-confirm-dialog' + (wide ? ' dss-dialog-wide' : ''),
          'aria-modal': true,
          'aria-label': title,
          onCancel: event => {
            event.preventDefault();
            onClose();
          },
          onKeyDown: event => event.stopPropagation(),
        },
        e(
          'div',
          { className: 'dss-confirm-head' },
          e('h2', null, title),
          note ? e('p', { className: 'dss-desc' }, note) : null,
        ),
        children,
      );
    }
    function dialogBody(...children) {
      return e('div', { className: 'dss-confirm-body' }, ...children);
    }
    function dialogActions(status, ...buttons) {
      return e(
        'div',
        { className: 'dss-confirm-actions' },
        e('span', { className: 'dss-confirm-status' }, status || ''),
        ...buttons,
      );
    }
    function pill(label, onClick, { disabled = false, kind = '' } = {}) {
      return e(
        'button',
        { type: 'button', className: 'dss-pill' + (kind ? ' dss-' + kind : ''), disabled, onClick },
        label,
      );
    }
    // A folded group: one row with a select-all box, a count and a toggle.
    function PickGroup({ title, note, ids, selected, disabled, open, onToggleOpen, onPick, children }) {
      const selectable = ids.filter(Boolean);
      const all = selectable.length > 0 && selectable.every(id => selected.includes(id));
      return e(
        'div',
        { className: 'dss-group' },
        e(
          'div',
          { className: 'dss-group-row' },
          e('input', {
            type: 'checkbox',
            'aria-label': '选中「' + title + '」中的全部',
            checked: all,
            disabled: disabled || !selectable.length,
            onChange: event => onPick(selectable, event.target.checked),
          }),
          e(
            'div',
            { className: 'dss-group-text' },
            e('span', null, title),
            note ? e('small', { className: 'dss-desc' }, note) : null,
          ),
          e(
            'button',
            { type: 'button', className: 'dss-link', 'aria-expanded': Boolean(open), onClick: onToggleOpen },
            open ? '收起' : '展开',
          ),
        ),
        open ? e('div', { className: 'dss-group-items' }, children) : null,
      );
    }
    function pickRow({ key, label, detail, checked, disabled, onChange }) {
      return e(
        'label',
        { key, className: 'dss-pick' },
        e('input', {
          type: 'checkbox',
          'aria-label': label,
          checked,
          disabled,
          onChange: event => onChange(event.target.checked),
        }),
        e('span', { className: 'dss-choice' }, label, detail ? e('small', null, detail) : null),
      );
    }
    const togglePick = (setSelected, ids, on) =>
      setSelected(old => (on ? [...new Set([...old, ...ids])] : old.filter(id => !ids.includes(id))));

    /* —— 同步的会话 —— */
    function sessionLabel(session) {
      return session.title || session.folder + ' · ' + session.id.slice(-8);
    }
    function sessionGroups(sessions) {
      return [
        {
          key: 'visible',
          title: '在 DSH 中可见',
          rows: sessions.filter(s => !s.archived && s.project !== null),
        },
        { key: 'archived', title: '已归档', rows: sessions.filter(s => s.archived) },
        {
          key: 'hidden',
          title: '在 DSH 中看不到',
          note: '没有登记在任何项目下',
          rows: sessions.filter(s => !s.archived && s.project === null),
        },
      ].filter(group => group.rows.length);
    }
    function sessionsSummary(data) {
      const archived = data.sessions.filter(s => s.archived).length,
        hidden = data.sessions.filter(s => !s.archived && s.project === null).length;
      const parts = [archived ? '已归档 ' + archived : '', hidden ? 'DSH 中看不到 ' + hidden : ''].filter(Boolean);
      return data.sessions.length + ' 个' + (parts.length ? '（' + parts.join('，') + '）' : '');
    }
    function SessionsDialog({ data, busy, onClose, onDone }) {
      const [selected, setSelected] = useState([]),
        [expanded, setExpanded] = useState({}),
        [confirming, setConfirming] = useState(false),
        [pending, setPending] = useState(false),
        [error, setError] = useState('');
      const blocked = busy || pending;
      const chosen = data.sessions.filter(s => selected.includes(s.id));
      const remove = async () => {
        setPending(true);
        setError('');
        try {
          const d = await API.removeSessions(selected);
          if (!d?.ok) throw new Error(d?.error || '移除失败，请重试');
          onDone('已把 ' + selected.length + ' 个会话移出同步，下次同步时从同步仓库删除。');
        } catch (err) {
          setError(err.message || String(err));
        } finally {
          setPending(false);
        }
      };
      if (confirming)
        return e(
          Modal,
          {
            title: '把 ' + chosen.length + ' 个会话移出同步',
            note: '所有电脑停止同步这些会话，下次同步时从同步仓库删除。各电脑上的副本留在原处。',
            onClose,
          },
          dialogBody(
            error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null,
            chosen.map(s =>
              e(
                'div',
                { key: s.id, className: 'dss-confirm-row' },
                e('span', null, sessionLabel(s)),
                e('span', { className: 'dss-desc' }, s.project || '未登记'),
              ),
            ),
          ),
          dialogActions(
            '',
            pill('返回', () => setConfirming(false), { disabled: pending }),
            pill(pending ? '正在处理…' : '移出同步', remove, { disabled: blocked, kind: 'danger' }),
          ),
        );
      return e(
        Modal,
        {
          title: '同步的会话',
          note:
            (data.sharedKnown ? '同步仓库与这台电脑' : '这台电脑') +
            '共有 ' +
            data.sessions.length +
            ' 个会话' +
            (data.removedCount ? '，另有 ' + data.removedCount + ' 个已移出同步' : '') +
            '。选中的会话会从同步仓库删除。',
          onClose,
        },
        dialogBody(
          ...sessionGroups(data.sessions).map(group =>
            e(
              PickGroup,
              {
                key: group.key,
                title: group.title + ' · ' + group.rows.length + ' 个',
                note: group.note,
                ids: group.rows.map(s => s.id),
                selected,
                disabled: blocked,
                open: expanded[group.key],
                onToggleOpen: () => setExpanded(old => ({ ...old, [group.key]: !old[group.key] })),
                onPick: (ids, on) => togglePick(setSelected, ids, on),
              },
              group.rows.map(session =>
                pickRow({
                  key: session.id,
                  label: sessionLabel(session),
                  detail:
                    (session.project ? session.project + ' · ' : '') +
                    (session.updatedAt ? new Date(session.updatedAt).toLocaleString() : '') +
                    (session.onThisComputer ? '' : ' · 这台电脑上没有'),
                  checked: selected.includes(session.id),
                  disabled: blocked,
                  onChange: on => togglePick(setSelected, [session.id], on),
                }),
              ),
            ),
          ),
        ),
        dialogActions(
          selected.length ? '已选 ' + selected.length + ' 个' : '',
          pill('关闭', onClose),
          pill('移出同步…', () => setConfirming(true), { disabled: blocked || !selected.length }),
        ),
      );
    }

    /* —— 同步仓库占用 —— */
    function usageSummary(data) {
      return '新电脑首次同步约下载 ' + fmtBytes(data.totalBytes) + '，其中历史版本 ' + fmtBytes(data.historyBytes);
    }
    function UsageDialog({ data, busy, onClose, onRefresh }) {
      const rows = data.groups.filter(g => g.files || g.historyBytes);
      return e(
        Modal,
        {
          title: '同步仓库占用',
          note:
            '上次同步时的同步仓库共 ' +
            data.commits +
            ' 次同步记录。当前内容 ' +
            fmtBytes(data.currentBytes) +
            '，历史版本 ' +
            fmtBytes(data.historyBytes) +
            '，目录与提交记录 ' +
            fmtBytes(data.structureBytes) +
            '。新电脑首次同步会全部下载。',
          wide: true,
          onClose,
        },
        dialogBody(
          e(
            'div',
            { className: 'dss-usage-table' },
            e(
              'div',
              { className: 'dss-usage-row dss-usage-head' },
              e('span', null, '内容'),
              e('span', null, '当前文件'),
              e('span', null, '当前占用'),
              e('span', null, '历史占用'),
            ),
            rows.map(g =>
              e(
                'div',
                { key: g.id, className: 'dss-usage-row' },
                e('span', null, g.title),
                e('span', null, g.files + ' 个'),
                e('span', null, fmtBytes(g.storedBytes)),
                e('span', null, fmtBytes(g.historyBytes)),
              ),
            ),
          ),
          data.largestHistory.length ? e('h3', { className: 'dss-subtitle' }, '历史中最大的文件') : null,
          data.largestHistory.map(item =>
            e(
              'div',
              { key: item.path, className: 'dss-confirm-row' },
              e('code', null, item.path),
              e('span', { className: 'dss-desc' }, fmtBytes(item.bytes) + ' · ' + item.versions + ' 个旧版本'),
            ),
          ),
          e(
            'p',
            { className: 'dss-desc' },
            data.branches
              ? 'GitHub 上另有项目分支 ' +
                  data.branches.project +
                  ' 个、同步前备份分支 ' +
                  data.branches.backup +
                  ' 个、电脑同步回执 ' +
                  data.branches.device +
                  ' 个' +
                  (data.branches.other ? '、其他分支 ' + data.branches.other + ' 个' : '') +
                  '。新电脑只下载同步分支和仍在用的项目分支。'
              : '连不上 GitHub，没有统计其他分支。',
          ),
        ),
        dialogActions('大小按压缩后的存储计算', pill('重新统计', onRefresh, { disabled: busy }), pill('关闭', onClose)),
      );
    }

    /* —— 本机备份 —— */
    function backupSummary(scan) {
      const free = scan.items.filter(i => !i.protected).reduce((sum, i) => sum + i.bytes, 0);
      return '共 ' + fmtBytes(scan.totalBytes) + (free ? '，可清理 ' + fmtBytes(free) : '，没有可清理的');
    }
    function BackupDialog({ scan, busy, onClose, onRescan }) {
      const [selected, setSelected] = useState([]),
        [expanded, setExpanded] = useState({}),
        [preview, setPreview] = useState(null),
        [separate, setSeparate] = useState(false),
        [result, setResult] = useState(null),
        [pending, setPending] = useState(false),
        [error, setError] = useState('');
      const blocked = busy || pending;
      const perform = async task => {
        setPending(true);
        setError('');
        try {
          const data = await task();
          if (!data?.ok) {
            if (data?.results) setResult(data);
            throw new Error(data?.error || '部分备份没有删除，请看逐项结果');
          }
          return data;
        } catch (err) {
          setError(err.message || '操作失败，请重试');
          return null;
        } finally {
          setPending(false);
        }
      };
      const errorLine = error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null;
      if (result)
        return e(
          Modal,
          { title: '本机备份', note: '已删除 ' + fmtBytes(result.removedBytes || 0) + '。', onClose },
          dialogBody(
            errorLine,
            (result.results || []).map(row =>
              e(
                'div',
                { key: row.id, className: 'dss-confirm-row' },
                e('span', null, row.name || '所选备份'),
                e(
                  'span',
                  { className: row.ok ? 'dss-desc' : 'dss-err' },
                  row.ok ? '已删除' : row.error + (row.retainedPath ? '；仍在 ' + row.retainedPath : ''),
                ),
              ),
            ),
          ),
          dialogActions('', pill('完成', onClose)),
        );
      if (preview)
        return e(
          Modal,
          {
            title: '删除 ' + preview.items.length + ' 项本机备份',
            note: '共 ' + fmtBytes(preview.bytes) + '。' + preview.warning,
            onClose,
          },
          dialogBody(
            errorLine,
            preview.items.map(item =>
              e(
                'div',
                { key: item.id, className: 'dss-confirm-row' },
                e('code', null, item.path),
                e('span', { className: 'dss-desc' }, fmtBytes(item.bytes)),
              ),
            ),
            preview.separateConfirmation
              ? pickRow({
                  key: 'separate',
                  label: '包含旧同步副本或项目旁备份，我已核对并关闭了相关编辑',
                  checked: separate,
                  disabled: blocked,
                  onChange: setSeparate,
                })
              : null,
          ),
          dialogActions(
            '',
            pill('返回', () => setPreview(null), { disabled: pending }),
            pill(
              pending ? '正在删除…' : '永久删除',
              async () => {
                const data = await perform(() =>
                  API.localStorage('apply', { token: preview.token, confirm: true, confirmSeparate: separate }),
                );
                if (data) setResult(data);
                onRescan();
              },
              { disabled: blocked || (preview.separateConfirmation && !separate), kind: 'danger' },
            ),
          ),
        );
      const bytes = scan.items.filter(i => selected.includes(i.id)).reduce((sum, i) => sum + i.bytes, 0);
      return e(
        Modal,
        {
          title: '本机备份',
          note: '同步前自动保存的原件、修复材料和旧同步副本。受保护的项会注明原因，不能选择。',
          wide: true,
          onClose,
        },
        dialogBody(
          errorLine,
          e(
            'label',
            { className: 'dss-pick' },
            '保留最近的备份',
            e(
              'select',
              {
                value: scan.policy.retentionDays,
                disabled: blocked,
                onChange: async event => {
                  const retentionDays = Number(event.target.value);
                  const saved = await perform(() => API.localStorage('policy', { retentionDays }));
                  if (saved) {
                    setSelected([]);
                    onRescan();
                  }
                },
              },
              [
                [30, '30 天'],
                [7, '7 天'],
                [90, '90 天'],
                [180, '180 天'],
                [365, '1 年'],
                [0, '不按时间保留'],
              ].map(([value, label]) => e('option', { key: value, value }, label)),
            ),
          ),
          scan.warnings?.map((warning, i) => e('p', { key: i, className: 'dss-err' }, warning)),
          ...scan.categories
            .map(category => ({ category, items: scan.items.filter(item => item.category === category.id) }))
            .filter(({ items }) => items.length)
            .map(({ category, items }) =>
              e(
                PickGroup,
                {
                  key: category.id,
                  title: category.title + ' · ' + fmtBytes(category.bytes),
                  note: category.purpose,
                  ids: items.filter(i => !i.protected).map(i => i.id),
                  selected,
                  disabled: blocked,
                  open: expanded[category.id],
                  onToggleOpen: () => setExpanded(old => ({ ...old, [category.id]: !old[category.id] })),
                  onPick: (ids, on) => togglePick(setSelected, ids, on),
                },
                items.map(item =>
                  pickRow({
                    key: item.id,
                    label: item.name + ' · ' + fmtBytes(item.bytes),
                    detail: item.protected ? '保留：' + item.reason : item.path,
                    checked: selected.includes(item.id),
                    disabled: blocked || item.protected,
                    onChange: on => togglePick(setSelected, [item.id], on),
                  }),
                ),
              ),
            ),
          e('p', { className: 'dss-desc' }, scan.note),
        ),
        dialogActions(
          selected.length ? '已选 ' + selected.length + ' 项 · ' + fmtBytes(bytes) : '',
          pill('关闭', onClose),
          pill(
            '删除…',
            async () => {
              setSeparate(false);
              const data = await perform(() => API.localStorage('preview', { ids: selected }));
              if (data) setPreview(data);
            },
            { disabled: blocked || !selected.length },
          ),
        ),
      );
    }

    /* —— 远端旧文件 —— */
    // Older versions uploaded machine-only files. They leave the shared copy only after
    // every computer in use runs a version that keeps its own copy.
    function remoteSummary(preview) {
      if (!preview.files.length) return '没有';
      return (
        preview.files.length + ' 个' + (preview.blockers.length ? '，' + preview.blockers.length + ' 台电脑需要先升级' : '')
      );
    }
    function RemoteFilesDialog({ preview, busy, onClose, onDone }) {
      const [retired, setRetired] = useState([]),
        [confirming, setConfirming] = useState(false),
        [pending, setPending] = useState(false),
        [error, setError] = useState('');
      const blocked = busy || pending;
      const waiting = preview.blockers.filter(b => !retired.includes(b.deviceId));
      const apply = async () => {
        setPending(true);
        setError('');
        try {
          const data = await API.applyRemoteCleanup({ previewId: preview.previewId, retiredDevices: retired });
          if (!data?.ok) throw new Error(data?.error || '没有完成，请重新检查');
          onDone('已从同步仓库移除 ' + data.removed + ' 个旧文件；各电脑上的这些文件留在原处。');
        } catch (err) {
          setError(err.message || String(err));
        } finally {
          setPending(false);
        }
      };
      const errorLine = error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null;
      if (confirming)
        return e(
          Modal,
          {
            title: '从同步仓库移除 ' + preview.files.length + ' 个旧文件',
            note: '同步一次，把它们从同步仓库的最新版本中删除。每台电脑上的这些文件留在原处。',
            onClose,
          },
          dialogBody(
            errorLine,
            preview.files.map(file => e('div', { key: file, className: 'dss-confirm-row' }, e('code', null, file))),
          ),
          dialogActions(
            '',
            pill('返回', () => setConfirming(false), { disabled: pending }),
            pill(pending ? '正在同步…' : '移除', apply, { disabled: blocked, kind: 'danger' }),
          ),
        );
      return e(
        Modal,
        {
          title: '远端旧文件',
          note: '旧版本上传过的插件清单、备份、脚本等本机文件，现在不再同步。',
          onClose,
        },
        dialogBody(
          errorLine,
          preview.blockers.length
            ? e(
                'div',
                { className: 'dss-stack' },
                e(
                  'p',
                  { className: 'dss-err', role: 'alert' },
                  '这些电脑还不是 ' +
                    preview.minVersion +
                    ' 或更新版本。旧版本会把远端移除当作删除本机文件，请先在它们上面升级并同步一次；不再使用的电脑可以勾选：',
                ),
                ...preview.blockers.map(b =>
                  pickRow({
                    key: b.deviceId,
                    label: b.deviceName + ' 已不再使用',
                    detail: b.reason + (b.appliedAt ? ' · 最后同步 ' + new Date(b.appliedAt).toLocaleString() : ''),
                    checked: retired.includes(b.deviceId),
                    disabled: blocked,
                    onChange: on => setRetired(old => (on ? [...old, b.deviceId] : old.filter(id => id !== b.deviceId))),
                  }),
                ),
              )
            : null,
          e('h3', { className: 'dss-subtitle' }, preview.files.length + ' 个文件'),
          preview.files.map(file => e('div', { key: file, className: 'dss-confirm-row' }, e('code', null, file))),
        ),
        dialogActions(
          waiting.length ? waiting.length + ' 台电脑需要先升级' : '',
          pill('关闭', onClose),
          pill('移除…', () => setConfirming(true), { disabled: blocked || waiting.length > 0 }),
        ),
      );
    }

    /* —— 总览 —— */
    const STORAGE_ROWS = [
      {
        key: 'sessions',
        title: '同步的会话',
        remote: true,
        action: '管理',
        load: () => API.sessions(),
        summary: sessionsSummary,
      },
      { key: 'usage', title: '同步仓库', remote: true, action: '明细', load: () => API.repoUsage(), summary: usageSummary },
      {
        key: 'backups',
        title: '本机备份',
        remote: false,
        action: '清理',
        load: () => API.localStorage(),
        summary: backupSummary,
      },
      {
        key: 'remoteFiles',
        title: '远端旧文件',
        remote: true,
        action: '清理',
        load: () => API.remoteCleanup(),
        summary: remoteSummary,
        empty: data => !data.files.length,
      },
    ];
    function StorageOverview({ busy, remote }) {
      const [results, setResults] = useState({}),
        [loading, setLoading] = useState({}),
        [open, setOpen] = useState(null),
        [message, setMessage] = useState('');
      const rows = STORAGE_ROWS.filter(row => remote || !row.remote);
      const load = async keys => {
        setLoading(old => ({ ...old, ...Object.fromEntries(keys.map(k => [k, true])) }));
        await Promise.all(
          keys.map(async key => {
            let value;
            try {
              const data = await STORAGE_ROWS.find(row => row.key === key).load();
              value = data?.ok ? { data } : { error: data?.error || '检查失败，请重试' };
            } catch (err) {
              value = { error: err.message || String(err) };
            }
            setResults(old => ({ ...old, [key]: value }));
            setLoading(old => ({ ...old, [key]: false }));
          }),
        );
      };
      const checking = rows.some(row => loading[row.key]);
      const checked = rows.some(row => results[row.key]);
      const close = () => setOpen(null);
      const done = key => text => {
        setOpen(null);
        setMessage(text);
        load([key]);
      };
      const dialogProps = { busy, onClose: close };
      const dialog = !results[open]?.data
        ? null
        : open === 'sessions'
          ? e(SessionsDialog, { ...dialogProps, data: results.sessions.data, onDone: done('sessions') })
          : open === 'usage'
            ? e(UsageDialog, { ...dialogProps, data: results.usage.data, onRefresh: () => load(['usage']) })
            : open === 'backups'
              ? e(BackupDialog, { ...dialogProps, scan: results.backups.data, onRescan: () => load(['backups']) })
              : open === 'remoteFiles'
                ? e(RemoteFilesDialog, { ...dialogProps, preview: results.remoteFiles.data, onDone: done('remoteFiles') })
                : null;
      return e(
        'section',
        { className: 'dss-sec', 'data-storage-overview': true },
        e('h2', { className: 'dss-section-title' }, '同步仓库与本机存储'),
        e(
          'div',
          { className: 'dss-storage-head' },
          e('p', { className: 'dss-desc' }, '看看同步了什么、占了多少，清理用不上的。'),
          pill(checking ? '正在检查…' : checked ? '重新检查' : '检查', () => load(rows.map(row => row.key)), {
            disabled: busy || checking,
          }),
        ),
        message ? e('div', { className: 'dss-save-state', role: 'status' }, message) : null,
        checked || checking
          ? e(
              'div',
              { className: 'dss-storage-rows' },
              rows.map(row => {
                const result = results[row.key];
                const ready = result?.data && !loading[row.key];
                return e(
                  'div',
                  { key: row.key, className: 'dss-storage-row', 'data-storage-row': row.key },
                  e('span', { className: 'dss-storage-title' }, row.title),
                  loading[row.key]
                    ? e('span', { className: 'dss-desc' }, '正在检查…')
                    : result?.error
                      ? e('span', { className: 'dss-err', role: 'alert' }, result.error)
                      : e('span', { className: 'dss-desc' }, ready ? row.summary(result.data) : ''),
                  ready && !row.empty?.(result.data)
                    ? e(
                        'button',
                        { type: 'button', className: 'dss-link', disabled: busy, onClick: () => setOpen(row.key) },
                        row.action,
                      )
                    : e('span'),
                );
              }),
            )
          : null,
        dialog,
      );
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
      } catch {
        /* ignore */
      }
    }
    function apply(ctx) {
      if (typeof ctx.inject === 'function')
        ctx.inject(['layout'], guarded => {
          repairNavigation = guarded.layout;
          guarded.effect(() => () => {
            if (repairNavigation === guarded.layout) repairNavigation = null;
          });
        });
      if (typeof ctx.inject === 'function')
        ctx.inject(['conversation'], guarded => {
          const restore = installSendProtection(guarded.conversation);
          guarded.effect(() => restore);
        });
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          { name: 'shell.overlay', id: 'dsh-sync-sidebar-preference', order: 90 },
          SidebarVisibilityProvider,
        ),
      );
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'dsh-sync-startup', order: 100 }, StartupSyncOverlay),
      );
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'dsh-sync-grouping', order: 110 }, GroupingRepairOverlay),
      );
      injectStyles(); // 侧栏胶囊按钮等样式全局注入,不依赖设置分节挂载
      // Same native panel contract as dshmarket; opening it never starts an upload.
      ctx.slots.inject('sidebar.panellist', () => {
        const main = ctx.slots.register({ name: 'main', key: 'dsh-sync', id: 'dsh-sync-panel' }, SyncPanel);
        const repair = ctx.slots.register(
          { name: 'main', key: 'dsh-sync-repair', id: 'dsh-sync-repair-panel' },
          RepairPage,
        );
        let removeEntry = null;
        const show = visible => {
          if (visible && !removeEntry)
            removeEntry = ctx.slots.register(
              { name: 'sidebar.panellist', id: 'dsh-sync', order: 450, label: '同步' },
              SidebarSyncIcon,
            );
          else if (!visible && removeEntry) {
            removeEntry();
            removeEntry = null;
          }
        };
        sidebarBinding = show;
        if (sidebarState.value !== null) show(sidebarState.value);
        return () => {
          if (sidebarBinding === show) sidebarBinding = null;
          removeEntry?.();
          main?.();
          repair?.();
        };
      });
      // 设置面板分节:同步状态卡(只读状态 + 上次结果(含错误) + 立即同步)
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'dsh-sync-manage',
            order: 400,
            label: '同步',
          },
          Section,
        ),
      );
    }

    module.exports = {
      name: 'dsh-chatsync',
      inject: ['slots'],
      apply,
    };
    return module.exports;
  },
});
