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
    const { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } = react;
    /* ---------- API ---------- */
    const API = {
      run: (approval, expectedConnection) =>
        fetch('/dsh-sync/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approval, expectedConnection }),
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
      recovery: () => fetch('/dsh-sync/api/recovery').then(r => r.json()),
      recoveryPreview: (id, offsets) =>
        fetch('/dsh-sync/api/recovery/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, offsets }),
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
      recoveryKeepCurrent: (record, keep) =>
        fetch('/dsh-sync/api/recovery/resolve-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: record.id,
            keep,
            expectedVersions: Object.fromEntries(['local', 'remote'].map(side => [side, record.versions[side].sha256])),
          }),
        }).then(r => r.json()),
      recoveryImport: (id, side, expectedHash, workspaceId, sourceProjectOnly = false) =>
        fetch('/dsh-sync/api/recovery/import-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            side,
            expectedHash,
            workspaceId,
            ...(sourceProjectOnly ? { sourceProjectOnly } : {}),
          }),
        }).then(r => r.json()),
      dataHealth: () => fetch('/dsh-sync/api/data-health/scan').then(r => r.json()),
      workspaceLocations: () => fetch('/dsh-sync/api/data-health/workspaces').then(r => r.json()),
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
      resetSettingsVersion: expectedVersion =>
        fetch('/dsh-sync/api/settings-version/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedVersion }),
        }).then(r => r.json()),
      githubAccount: () =>
        fetch('/dsh-sync/api/connection/account', { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
      checkConnection: () => fetch('/dsh-sync/api/connection/check').then(r => r.json()),
      network: () => fetch('/dsh-sync/api/network', { signal: AbortSignal.timeout(40000) }).then(r => r.json()),
      remoteCleanup: () => fetch('/dsh-sync/api/remote-cleanup').then(r => r.json()),
      repoUsage: () => fetch('/dsh-sync/api/repo-usage', { signal: AbortSignal.timeout(300000) }).then(r => r.json()),
      sessions: () => fetch('/dsh-sync/api/sessions').then(r => r.json()),
      sessionPreview: id =>
        fetch('/dsh-sync/api/sessions/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        }).then(r => r.json()),
      historyRebuild: () =>
        fetch('/dsh-sync/api/history-rebuild', { signal: AbortSignal.timeout(125000) }).then(r => r.json()),
      applyHistoryRebuild: body =>
        fetch('/dsh-sync/api/history-rebuild', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then(r => r.json()),
      localHistory: () => fetch('/dsh-sync/api/local-history', { signal: AbortSignal.timeout(300000) }).then(r => r.json()),
      reclaimLocalHistory: body =>
        fetch('/dsh-sync/api/local-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then(r => r.json()),
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
    };

    function isCurrentSyncMessage(message) {
      return /^(?:当前)?已是最新\s*[,，]?\s*无需(?:变更|同步)[。.!！]?$/.test(String(message || '').trim());
    }
    function syncMessagePresentation(message, ok, detail) {
      const problem =
        detail &&
        (detail.error ||
          detail.deferred ||
          detail.needsReview ||
          detail.downloadPending ||
          detail.dataVerificationPending ||
          detail.dataRepairQueued ||
          detail.workspaces?.errors?.length);
      const current = isCurrentSyncMessage(message) && !problem;
      return { current, ok: Boolean(!problem && (ok || current)) };
    }

    const STYLE = [
      '.dss-update{box-sizing:border-box;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:12px;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-secondary,#666);font-size:12px;line-height:1.65}',
      '.dss-update-popup{position:fixed;z-index:40;width:min(360px,calc(100vw - 32px));max-height:calc(100dvh - 72px);overflow:auto;font-size:14px;color:var(--dsw-alias-label-primary,#202124);box-shadow:0 2px 10px rgba(0,0,0,.08);animation:dss-update-in .6s ease-out}',
      '@keyframes dss-update-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}',
      '@media(prefers-reduced-motion:reduce){.dss-update-popup{animation:none}}',
      '.dss-update-heading{display:flex;align-items:center;gap:8px;justify-content:space-between}.dss-update-heading h2{font:inherit;font-weight:600;margin:0}',
      'button.dss-update-close{display:inline-flex;align-items:center;justify-content:center;flex:none;box-sizing:border-box;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#6b7078);cursor:pointer}button.dss-update-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#202124)}button.dss-update-close:focus-visible{outline:2px solid #4d6bfe;outline-offset:2px}.dss-close-mark{position:relative;width:12px;height:12px;pointer-events:none}.dss-close-mark:before,.dss-close-mark:after{content:"";position:absolute;left:0;top:5.25px;width:12px;height:1.5px;background:currentColor;border-radius:1px;transform:rotate(45deg)}.dss-close-mark:after{transform:rotate(-45deg)}@media(pointer:coarse){button.dss-update-close{width:44px;height:44px}}',
      '.dss-update-requirement{overflow-wrap:anywhere;margin:8px 0}.dss-update-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.dss-update summary{cursor:pointer}.dss-update-feedback{margin-top:8px;overflow-wrap:anywhere}.dss-update pre{white-space:pre-wrap;user-select:text}',
      '@keyframes dss-spin{to{transform:rotate(360deg)}}',
      /* 结果/进度气泡 */
      '.dss-auto-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px}.dss-auto-options>.dss-check{margin:0;gap:12px;padding:14px 16px}',
      /* 实时传输行 + 百分比进度条(上传/下载字节与速度) */
      '.dss-tx{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.78));margin-top:4px;white-space:nowrap}',
      '.dss-bar{height:3px;border-radius:2px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.22));overflow:hidden;margin-top:4px;min-width:150px}',
      '.dss-bar-in{height:100%;background:var(--dsw-alias-accent-color,rgba(110,168,254,.85));transition:width .25s}',
      /* 设置分节:对齐原生设置——无框无底色,组间 hairline 分隔 */
      '.dss-wrap{--dss-title-size:20px;display:flex;flex-direction:column;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,inherit)}',
      '.dss-sec{display:flex;flex-direction:column;gap:12px;padding:20px 0;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22))}',
      '.dss-sec:last-child{border-bottom:none}',
      '.dss-rowline{display:flex;align-items:center;gap:12px}',
      '.dss-rowtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}',
      '.dss-h{color:var(--dsw-alias-label-primary,inherit);font-size:14px;font-weight:400;line-height:22px}',
      '.dss-desc{color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8));font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-all}',
      /* pill 控件:原生设置同款 hairline 圆角胶囊 */
      '.dss-pill{display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:none;align-self:flex-start;box-sizing:border-box;width:max-content;max-width:100%;min-height:36px;height:auto;padding:7px 16px;border:1px solid var(--dsw-alias-border-l4,rgba(127,127,127,.4));border-radius:10px;background:var(--dsw-alias-bg-layer-2,Canvas);color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px;line-height:20px;white-space:normal;text-align:center;cursor:pointer}',
      '.dss-pill:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
      '.dss-pill:disabled{opacity:.5;cursor:default}',
      '.dss-recovery-list{display:flex;flex-direction:column;gap:0;padding-top:12px}.dss-recovery-item{display:flex;align-items:center;gap:16px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd)}.dss-recovery-item:last-child{border-bottom:0}.dss-recovery-file{flex:1;min-width:0}.dss-recovery-file .dss-h{overflow-wrap:anywhere}.dss-recovery-path{margin:3px 0}.dss-recovery-item>.dss-pill{align-self:center}@media(max-width:480px){.dss-recovery-item{align-items:flex-start;flex-direction:column;gap:10px}.dss-recovery-item>.dss-pill{align-self:flex-start}}',
      '.dss-comparison{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}.dss-diff-tools,.dss-diff-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dss-diff-tools{justify-content:space-between}.dss-diff-grid{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);border:1px solid var(--dsw-alias-border-l2,#888);border-radius:8px;overflow:hidden}.dss-diff-side{display:flex;flex-direction:column;min-width:0;min-height:0}.dss-diff-side+section{border-left:1px solid var(--dsw-alias-border-l2,#888)}.dss-diff-title{flex:none;padding:6px 10px;background:var(--dsw-alias-bg-layer-2,ButtonFace);font-size:13px;overflow-wrap:anywhere}',
      '.dss-diff-pane{flex:1;min-height:0;overflow:scroll;overscroll-behavior:contain;scrollbar-gutter:stable}.dss-diff-lines{width:max-content;min-width:100%;font:13px/24px Consolas,monospace;padding-bottom:12px}.dss-diff-line{height:24px;white-space:pre;padding-right:20px;box-sizing:border-box}.dss-diff-number{display:inline-block;user-select:none;width:48px;text-align:right;padding-right:8px;opacity:.6}.dss-diff-sign{display:inline-block;width:22px;font-weight:bold}.dss-diff-remove{background:light-dark(#ffe1df,#512b31)}.dss-diff-add{background:light-dark(#d9f4e4,#193e30)}.dss-diff-active{box-shadow:inset 0 0 0 2px var(--dsw-alias-accent-color,#4988ea)}.dss-recovery-dialog .dss-tip{padding:8px 12px;margin:0;font-size:13px}',
      '.dss-select{max-width:100%;padding:6px 10px;border:1px solid var(--dsw-alias-border-l4,rgba(127,127,127,.4));border-radius:8px;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#222);font:inherit}',
      '.dss-wrap fieldset:disabled{opacity:.65}',
      '.dss-readable-comparison{flex:1;min-height:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;overflow:hidden}.dss-readable-side{display:flex;flex-direction:column;min-height:0;min-width:0}.dss-readable-heading{padding:8px 0;font-size:13px;color:var(--dsw-alias-label-secondary,#666)}.dss-readable-scroll{flex:1;min-height:0;overflow:auto;padding:12px 16px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px}.dss-transcript{width:min(100%,748px);margin:auto;display:flex;flex-direction:column;gap:28px;padding:12px 0}.dss-message{display:flex;min-width:0}.dss-message-user{justify-content:flex-end}.dss-message-user>.dss-message-body{max-width:82%;padding:10px 16px;border-radius:var(--dsw-radius-xl,18px);background:var(--dsw-specific-bubble,#edf2fa)}.dss-message-assistant>.dss-message-body{width:100%;min-width:0;line-height:1.75}.dss-readable-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.75}.dss-readable-fields dl{margin:0}.dss-readable-field{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,2fr);gap:16px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd)}.dss-readable-field dt{color:var(--dsw-alias-label-secondary,#666);overflow-wrap:anywhere}.dss-readable-field dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.dss-readable-projects article{padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd);overflow-wrap:anywhere}.dss-readable-image{margin:0}.dss-readable-image img{display:block;max-width:100%;max-height:65vh;object-fit:contain}.dss-readable-image figcaption{font-size:12px;color:var(--dsw-alias-label-secondary,#666);margin-top:8px}.dss-file-preview{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:14px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px;overflow-wrap:anywhere}.dss-message-body>p:first-child{margin-top:0}.dss-message-body>p:last-child{margin-bottom:0}@media(max-width:650px){.dss-readable-comparison{grid-template-columns:1fr;overflow:auto}.dss-readable-side{min-height:250px}.dss-readable-field{grid-template-columns:1fr;gap:4px}}',
      '.dss-wrap a{color:var(--dsw-alias-accent-color,#3979df)}',
      '.dss-wrap a{text-decoration:underline;text-underline-offset:3px}',
      '.dss-wrap .dss-h{font-size:15px;font-weight:600}',
      '.dss-wrap .dss-desc{font-size:14px;line-height:1.7;color:var(--dsw-alias-label-secondary,inherit);word-break:normal;overflow-wrap:anywhere}',
      '.dss-wrap .dss-err,.dss-wrap .dss-confmeta{font-size:13px;line-height:1.65;overflow-wrap:anywhere}',
      '.dss-wrap .dss-form-error{font-size:inherit;line-height:inherit;word-break:normal}.dss-sync-page .dss-step-link,.dss-setup-connect .dss-connection-actions .dss-pill,.dss-login-help .dss-help-tab{font-size:14px}.dss-workspace-locations{display:grid;gap:8px;padding-block:8px}.dss-workspace-locations .dss-field{margin-top:0}.dss-workspace-locations>.dss-stack{gap:8px}.dss-connection-form .dss-desc p{margin:0}.dss-connection-form .dss-desc p+p{margin-top:4px}.dss-workspace-location-field{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;min-width:0}.dss-workspace-location-field .dss-field{grid-area:1/1;min-width:0}.dss-workspace-location-buttons{grid-area:1/2;align-self:end;display:flex;gap:8px}.dss-workspace-location-buttons>.dss-pill{min-height:42px}.dss-workspace-location-row{min-height:42px;flex-wrap:nowrap}.dss-wrap .dss-workspace-location-row .dss-rowtext{gap:4px;min-width:0}.dss-workspace-location-row .dss-desc{overflow-wrap:anywhere}.dss-workspace-location-field p{grid-column:1/-1;margin:0;overflow-wrap:anywhere}@media(max-width:480px){.dss-workspace-location-field{display:flex;flex-direction:column}.dss-workspace-location-buttons{align-self:start}.dss-workspace-location-buttons>.dss-pill{min-height:36px}}',
      '.dss-field{display:flex;flex-direction:column;gap:6px;margin-top:14px}',
      '.dss-input{box-sizing:border-box;width:100%;padding:9px 12px;border:1px solid var(--dsw-alias-border-l4,#888);border-radius:8px;background:var(--dsw-alias-bg-layer-2,transparent);color:inherit;font:inherit;min-width:0}',
      /* 数字输入(自动同步间隔)只需要窄条,不占满整行 */
      '.dss-input-num{width:88px;flex:none;padding:6px 10px}',
      '.dss-links{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:12px;font-size:14px}',
      '.dss-sync-backups .dss-input{width:min(100%,350px);margin:12px 0}.dss-sync-backups [aria-pressed=true]{background:var(--dsw-alias-accent-color,#4d6bfe);color:white}.dss-backup-record{display:flex;gap:8px;align-items:center;border-top:1px solid var(--dsw-alias-border-l2);padding:6px 0}.dss-backup-record .dss-recovery-item{flex:1;min-width:0;border:0}.dss-backup-record>.dss-pill{align-self:center}',
      '.dss-connection-actions{margin-top:12px}.dss-setup-heading{display:flex;align-items:center;flex-wrap:wrap;gap:12px 20px}.dss-setup-heading .dss-onboarding-title{margin:0}.dss-plugin-prefs .dss-rowline{justify-content:space-between;min-height:52px;border-bottom:1px solid var(--dsw-alias-border-l2);padding:16px 0;gap:16px;flex-wrap:nowrap}.dss-plugin-prefs .dss-rowtext{gap:4px;line-height:1.5}.dss-plugin-prefs small{color:var(--dsw-alias-label-secondary);font-size:14px}',
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
      '.dss-help-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}.dss-help-tab{flex:0 1 auto;min-width:0;max-width:100%;min-height:32px;padding:5px 12px;border:1px solid var(--dsw-alias-border-l4,rgba(127,127,127,.4));border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:1.4;text-align:center;white-space:normal;overflow-wrap:anywhere;cursor:pointer}.dss-help-tab[aria-selected=true]{background:var(--dsw-alias-accent-color,#3979df);border-color:transparent;color:#fff;font-weight:600}.dss-help-panel{min-width:0}.dss-help-panel>ol{margin-top:8px}.dss-help-alt{margin-top:6px}',
      '.dss-gh-diagram{margin:4px 0 8px;min-width:0}.dss-gh-proxy{display:block;font-weight:700}.dss-gh-term{border-radius:10px;background:#0f1115;color:#d7dae0;font:12.5px/1.6 Consolas,"Cascadia Mono",monospace;padding:10px 0;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25))}.dss-gh-bar{padding:0 12px 8px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:6px;color:#8a8f98;font:11px system-ui,sans-serif}',
      '.dss-gh-row{display:grid;grid-template-columns:26px minmax(0,1fr);gap:0 8px;padding:3px 12px}.dss-gh-act{background:rgba(110,168,254,.12)}.dss-gh-t{white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}.dss-gh-n{grid-row:span 2}.dss-gh-note{grid-column:2;font:12px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#9ec3ff}.dss-gh-dim .dss-gh-t{color:#6c717b}.dss-gh-dim .dss-gh-note{color:#8a8f98}',
      '.dss-gh-badge{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;border-radius:50%;background:#6ea8fe;color:#0f1115;font:600 12px/1 system-ui,sans-serif;margin-top:1px}.dss-gh-you{color:#6ea8fe;font-weight:600}.dss-gh-ok{color:#5bd17a}.dss-gh-warn{color:#e5c07b}.dss-gh-code{background:#d7dae0;color:#0f1115;border-radius:3px;padding:0 4px}',
      '.dss-sec[id]{scroll-margin-top:16px}.dss-complete{display:flex;flex-direction:column;gap:10px}',
      '@media(max-width:600px){.dss-steps{grid-template-columns:repeat(2,minmax(0,1fr))}.dss-onboarding{padding:16px}.dss-step-link{min-height:44px}}',
      '.dss-wrap :is(button,input,select,a,summary):focus-visible{outline:2px solid var(--dsw-alias-accent-color,#3979df);outline-offset:3px}',
      '.dss-wrap summary{cursor:pointer;margin:8px 0;font-size:14px}',
      '@media(max-width:480px){.dss-wrap .dss-rowline{flex-wrap:wrap}.dss-wrap .dss-pill{min-height:36px}.dss-wrap .dss-rowtext{flex-basis:100%}}',
      '.dss-restartrow{padding-top:10px;margin-top:2px}',
      /* Shared spacing and intrinsic sizing also apply inside shell dialogs. */
      '.dss-wrap p{margin:0}.dss-stack{display:flex;flex-direction:column;gap:12px;min-width:0}.dss-actions{display:flex;align-items:center;flex-wrap:wrap;gap:12px}.dss-actions>.dss-pill{align-self:center}.dss-backup-row{display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:12px 0}.dss-backup-row>span{min-width:0;flex:1 1 240px;overflow-wrap:anywhere}.dss-backup-row>.dss-pill{align-self:center}',
      '.dss-wrap .dss-rowline>.dss-pill{align-self:center}.dss-wrap .dss-rowtext>.dss-pill{margin-top:4px}.dss-wrap details.dss-sec{display:block}.dss-wrap details.dss-sec>summary{margin:0}.dss-wrap details.dss-sec>summary~*{margin-top:12px}.dss-recovery-list{max-height:420px;overflow:auto;overscroll-behavior:contain;padding-right:8px}.dss-field,.dss-tip,.dss-guide{min-width:0}.dss-input{min-height:40px}.dss-command{overflow-wrap:anywhere}.dss-save-state:empty{display:none}',
      '.dss-panel{box-sizing:border-box;height:100%;overflow:auto;scrollbar-gutter:stable;padding:32px clamp(20px,5vw,64px);background:var(--dsw-alias-bg-layer-1,Canvas)}.dss-panel>.dss-wrap{max-width:1000px;margin:auto}.dss-nav-progress{display:inline-flex;align-items:center;gap:3px}.dss-nav-progress small{font-size:10px;max-width:46px;overflow:hidden;white-space:nowrap}',
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
      '.dss-startup-actions{display:flex;flex-wrap:wrap;gap:12px}.dss-startup-actions .dss-pill{height:auto;min-height:40px;padding:9px 16px;font-size:14px}',
      '.dss-startup-kicker{font-size:12px;color:var(--dsw-alias-label-secondary,var(--dsw-alias-text-secondary,#687386));margin-bottom:8px}.dss-startup-dialog h2{margin-bottom:8px}.dss-startup-dialog .dss-startup-desc{margin-bottom:20px;color:var(--dsw-alias-label-secondary,var(--dsw-alias-text-secondary,#687386))}',
      '.dss-startup-panel{box-sizing:border-box;min-width:0;max-width:100%;padding:18px;border:1px solid var(--dsw-alias-border-l2,#d9dde3);border-radius:12px;margin-bottom:18px}.dss-startup-panel strong{display:block;margin-bottom:8px}.dss-startup-panel .dss-tx{font-size:14px;line-height:1.65;color:inherit;white-space:normal;overflow-wrap:anywhere;min-width:0;max-width:100%}.dss-startup-panel .dss-bar{height:8px;margin-top:12px;min-width:0;max-width:100%}.dss-startup-meta{margin-top:12px;font-size:12px;color:var(--dsw-alias-label-secondary,var(--dsw-alias-text-secondary,#687386))}',
      '.dss-net{margin:0;font-size:13px;line-height:1.65}.dss-net-row{display:flex;align-items:center;gap:10px;min-height:42px}.dss-net-trigger{display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px 10px;padding:6px 0;min-height:36px;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer} .dss-net-text{position:relative;display:inline-flex;align-items:baseline;flex-wrap:wrap;gap:2px 10px}.dss-net-trigger:is(:hover,:focus-visible):not(:disabled)>.dss-net-text::after{content:"";position:absolute;inset-inline:0;bottom:-2px;border-bottom:1px solid var(--dsw-alias-label-secondary,#687386);pointer-events:none}.dss-net-trigger:disabled{cursor:default}.dss-net-text>.dss-err{margin:0}.dss-net-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-border-l2,#c4c9d4)}.dss-net-dot[data-route=proxy]{background:#16a34a}.dss-net-dot[data-route=direct]{background:#d97706}.dss-net-command{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;margin:8px 0 0}.dss-net-label{font-size:12px;color:var(--dsw-alias-label-secondary,#687386)}.dss-net-command code{min-width:0;font-size:12px;padding:6px 8px;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--dsw-alias-bg-l2,rgba(127,127,127,.12))}',
      '.dss-issue{padding:12px 0;border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-issue code{display:block;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:6px}.dss-issue .dss-pill{margin-top:8px}',
      '.dss-bar[aria-valuenow]{overflow:hidden}.dss-bar-pending{overflow:hidden;height:8px;background:var(--dsw-alias-border-l2,#d9dde3);border-radius:8px;margin:12px 0}.dss-bar-pending:after{content:"";display:block;width:35%;height:100%;background:#3979df;border-radius:8px;animation:dss-progress-pulse 1.5s ease-in-out infinite alternate}@keyframes dss-progress-pulse{from{transform:translateX(0)}to{transform:translateX(185%)}}@media(prefers-reduced-motion:reduce){.dss-bar-pending:after{animation:none}.dss-bar-in{transition:none}}',
      /* One hierarchy and separator rule for all full-page settings groups. */
      '.dss-wrap .dss-sec{border-bottom:0}.dss-wrap>.dss-sec+.dss-sec,.dss-wrap>#dss-data-health{border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-wrap .dss-issue-list>*+*{border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-wrap .dss-issue-list>.dss-sec{padding:16px 0}.dss-wrap .dss-issue-list code{white-space:pre-wrap;overflow-wrap:anywhere}',
      /* Action buttons share DeepSeek blue, including buttons in portal dialogs. */
      'button.dss-primary{background:#4d6bfe;border-color:#4d6bfe;color:#fff;font-weight:600}button.dss-primary:hover:not(:disabled){background:#4059df;border-color:#4059df;color:#fff}button.dss-danger{background:#b42318;border-color:#b42318;color:#fff}button.dss-danger:hover:not(:disabled){background:#912018;border-color:#912018;color:#fff}.dss-wrap .dss-switch-on{background:#4d6bfe;border-color:#4d6bfe}.dss-wrap .dss-switch-on .dss-switch-knob{background:#fff}.dss-wrap .dss-check input{accent-color:#4d6bfe}',
      '.dss-recovery-list{max-height:65dvh}.dss-issue-list details{font-size:13px}.dss-issue-list .dss-sec{min-width:0}.dss-guide:focus{outline:none}@media(max-width:600px){.dss-confprev{grid-template-columns:minmax(0,1fr)}}',
      '.dss-wrap>.dss-sec{border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-wrap>.dss-sec:first-child{border-top:0}button.dss-step-link[aria-current]{background:#4d6bfe;border-color:#4d6bfe;color:#fff}',
      /* Explicit heading levels keep status text subordinate to setting titles. */
      '.dss-wrap .dss-onboarding-title{font-size:var(--dss-title-size);line-height:1.4;font-weight:700}.dss-wrap .dss-section-title{font-size:var(--dss-title-size);font-weight:650;line-height:1.5;margin:0}.dss-wrap .dss-card-title{font-size:18px;font-weight:650;line-height:1.5;margin:0}.dss-wrap .dss-subtitle{font-size:16px;font-weight:600;line-height:1.5;margin:0}.dss-wrap>.dss-sec{padding-block:28px;gap:18px}.dss-settings-body{display:flex;flex-direction:column;gap:20px}.dss-wrap .dss-setting-card{box-sizing:border-box;min-width:0;padding:22px 24px;border:1px solid var(--dsw-alias-border-l2,#d9dde3);border-radius:12px;margin:0;gap:18px}.dss-setting-card .dss-rowtext{gap:16px}.dss-setting-card>.dss-switch{align-self:flex-start;margin-top:4px}.dss-title-status{display:flex;align-items:center;flex-wrap:wrap;gap:4px 12px}.dss-status-light{display:inline-flex;align-items:center;gap:7px;font-size:14px;font-weight:500;color:var(--dsw-alias-label-secondary,inherit)}.dss-status-light:before{content:"";flex:0 0 7px;height:7px;border-radius:50%;background:var(--dss-status-color,#858d9a)}.dss-status-light[data-tone=blue]{--dss-status-color:#4d6bfe}.dss-status-light[data-tone=warning]{--dss-status-color:#d97706}.dss-status-light[data-tone=error]{--dss-status-color:#b42318}.dss-wrap .dss-subsection-heading{margin-top:24px;padding-top:24px;border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-wrap details.dss-sec>summary>.dss-section-title{display:inline}.dss-utility-card{padding:18px 20px;border:1px solid var(--dsw-alias-border-l2,#d9dde3);border-radius:12px}.dss-wrap .dss-utility-card>summary{font-size:16px;font-weight:600;margin:0}.dss-utility-card[open]>summary{margin-bottom:14px}.dss-utility-card>.dss-desc{margin-top:12px}@media(max-width:600px){.dss-wrap .dss-setting-card{padding:18px 16px}.dss-settings-body{gap:16px}.dss-wrap .dss-utility-card{padding:16px}.dss-wrap .dss-section-title{font-size:20px}}',
      /* Grouped lists: one summary row per group, details folded, a sticky action bar. */
      '.dss-group{border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-group:last-of-type{border-bottom:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-group-row{display:grid;grid-template-columns:20px minmax(0,1fr) auto auto;gap:12px;align-items:center;padding:12px 0}.dss-group-row input{accent-color:#4d6bfe}.dss-group-text{display:flex;flex-direction:column;min-width:0}.dss-group-size{font-size:13px;white-space:nowrap}.dss-group-items{display:flex;flex-direction:column;gap:6px;padding:4px 0 12px 32px}.dss-filter{display:flex;gap:8px;flex-wrap:wrap}.dss-filter button[aria-pressed=true]{border-color:#4d6bfe;color:#4d6bfe}button.dss-link{border:0;background:none;padding:4px;color:#4d6bfe;font:inherit;font-size:13px;cursor:pointer}',
      '.dss-action-bar{position:sticky;bottom:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 16px;margin-top:4px;border:1px solid var(--dsw-alias-border-l2,#d9dde3);border-radius:10px;background:var(--dsw-alias-bg-layer-1,Canvas)}',
      /* Storage overview: one line per kind; dialogs hold the lists. */
      '.dss-storage-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.dss-storage-rows{display:flex;flex-direction:column;margin-top:8px}.dss-storage-row{display:grid;grid-template-columns:7em minmax(0,1fr) auto;gap:12px;align-items:baseline;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-storage-row .dss-err{margin:0}.dss-storage-title{font-weight:600}.dss-confirm-dialog.dss-dialog-wide{width:min(720px,calc(100vw - 32px))}.dss-confirm-dialog .dss-confirm-head{flex:none;max-height:40vh;overflow:auto}.dss-confirm-dialog .dss-confirm-actions{flex:none}.dss-confirm-status{margin-right:auto;align-self:center;font-size:13px;color:var(--dsw-alias-label-secondary,inherit)}.dss-pick{display:flex;align-items:center;gap:8px;padding:6px 0;line-height:20px}.dss-pick input{flex:none;width:16px;height:16px;margin:0;accent-color:#4d6bfe}.dss-pick select{margin-left:auto}.dss-confirm-body .dss-subtitle{margin:12px 0 4px}.dss-confirm-body code{overflow-wrap:anywhere}@media (max-width:480px){.dss-storage-row{grid-template-columns:minmax(0,1fr) auto}.dss-storage-row>.dss-desc,.dss-storage-row>.dss-err{grid-column:1/-1;grid-row:2}}',
      /* Repository usage: a compact table that collapses to two columns on narrow panes. */
      '.dss-usage-table{display:flex;flex-direction:column;font-size:13px}.dss-usage-row{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1.3fr) minmax(0,1fr) 5em;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-usage-row>:not(:first-child){text-align:right;white-space:nowrap}.dss-usage-head{font-weight:600}.dss-history-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:12px 0;padding:12px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}.dss-history-bar .dss-group-text{flex:1 1 240px}.dss-session-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0 8px}.dss-session-row>.dss-pick{flex:1 1 0;min-width:0}.dss-session-preview{flex:1 0 100%;margin:0 0 8px 24px;padding:8px 12px;border-left:2px solid var(--dsw-alias-border-l2,#d9dde3);font-size:13px}.dss-session-preview p{margin:4px 0;overflow-wrap:anywhere}.dss-steps{margin:0;padding-left:20px}.dss-steps li{margin:6px 0}@media (max-width:480px){.dss-usage-row{grid-template-columns:minmax(0,1fr) auto auto auto;font-size:12px}}',
      '.dss-confirm-dialog{box-sizing:border-box;width:min(520px,calc(100vw - 32px));max-height:min(80dvh,640px);padding:0;border:1px solid var(--dsw-alias-border-l2,#888);border-radius:14px;background:var(--dsw-alias-bg-layer-1,Canvas);color:var(--dsw-alias-label-primary,CanvasText);font:14px/1.6 system-ui;overflow:hidden}.dss-confirm-dialog[open]{display:flex;flex-direction:column}.dss-confirm-dialog::backdrop{background:#0009}.dss-confirm-head{padding:16px 20px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-confirm-head h2{font-size:17px;margin:0 0 4px}.dss-confirm-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 20px}.dss-confirm-row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;overflow-wrap:anywhere}.dss-confirm-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-confirm-dialog button.dss-pill{background:transparent;border-color:var(--dsw-alias-border-l4,rgba(127,127,127,.4));color:inherit;font-weight:500}.dss-confirm-dialog button.dss-primary{background:#4d6bfe;border-color:#4d6bfe;color:#fff}.dss-confirm-dialog button.dss-danger{background:#b42318;border-color:#b42318;color:#fff}.dss-confirm-dialog button.dss-danger:hover:not(:disabled){background:#912018;border-color:#912018;color:#fff}.dss-confirm-dialog button.dss-primary:hover:not(:disabled){background:#4059df;border-color:#4059df;color:#fff}',
      '.dss-login-help h3,.dss-review h3{margin:0 0 8px;font-size:15px}.dss-grouping-notice{right:16px;bottom:16px;z-index:41}.dss-grouping-notice h2,.dss-usage-detail h3{margin:0;font-size:16px}.dss-grouping-notice .dss-diff-actions{margin-top:12px}.dss-usage-detail{margin-top:14px;border-top:1px solid var(--dsw-alias-border-l2,#ddd);padding-top:12px}.dss-usage-detail>.dss-confirm-body{padding:8px 0}.dss-usage-detail>.dss-confirm-actions{padding:8px 0 0}',
      '.dss-confirm-dialog.dss-recovery-dialog{--dss-dialog-top:var(--dsh-frame-overlay-top,20px);--dss-recovery-height:min(760px,calc(100dvh - var(--dss-dialog-top) - 12px));position:fixed;inset:calc((100dvh + var(--dss-dialog-top) - 12px - var(--dss-recovery-height))/2) 12px auto;width:calc(100% - 24px);height:var(--dss-recovery-height);max-width:1240px;max-height:none;min-height:0;margin:0 auto;padding:0}.dss-recovery-dialog .dss-confirm-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 12px;padding:10px 14px;max-height:none}.dss-recovery-dialog .dss-confirm-head>div:first-child{min-width:0;overflow-wrap:anywhere}.dss-recovery-dialog .dss-confirm-head h2{margin:0}.dss-recovery-dialog .dss-confirm-head p{margin:0}.dss-recovery-dialog>.dss-comparison,.dss-recovery-dialog>.dss-readable-comparison,.dss-recovery-dialog>.dss-transcript-comparison{margin:0 12px 10px}.dss-recovery-dialog .dss-pill{min-height:32px;padding:5px 10px}.dss-diff-tools{gap:4px 10px;padding:6px 0;font-size:13px}.dss-diff-footer{display:grid;flex:none;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l2,#ddd);font-size:13px}.dss-diff-footer:not(:has(button,[role=status])){display:none}.dss-recovery-actions{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;min-width:0}.dss-conflict-actions:not([hidden]){min-height:3.2em}.dss-recovery-actions[hidden]{display:none}.dss-recovery-actions[inert]{visibility:hidden}.dss-recovery-complete{grid-area:1/1;align-self:center;max-height:3.2em}.dss-recovery-actions:has(~.dss-recovery-complete){grid-area:1/1}.dss-recovery-project{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}.dss-recovery-project select{max-width:min(220px,100%)}.dss-recovery-archive{margin-left:auto}.dss-recovery-feedback{flex-basis:100%;overflow-wrap:anywhere;max-height:3.3em;overflow:auto}.dss-recovery-dialog :is(button,select,[tabindex]):focus-visible{outline:2px solid #4d6bfe;outline-offset:-2px}',
      '.dss-transcript-comparison{display:flex;flex:1;flex-direction:column;min-height:0}.dss-transcript-headings,.dss-transcript-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.dss-transcript-headings>div{padding:6px 10px;overflow-wrap:anywhere}.dss-transcript-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:8px}.dss-transcript-cell{min-width:0;padding:4px 8px}.dss-transcript-cell:nth-child(even){border-left:1px solid var(--dsw-alias-border-l2,#ddd)}.dss-message-different>.dss-message-body{box-shadow:inset 3px 0 var(--dss-message-diff);padding-inline-start:8px}.dss-message-diff-remove{--dss-message-diff:light-dark(#a52029,#ffb3b8)}.dss-message-diff-add{--dss-message-diff:light-dark(#136c39,#8ce0ae)}.dss-message-user.dss-message-different>.dss-message-body{padding-inline-start:16px}.dss-transcript-cell .dss-message-user>.dss-message-body{max-width:100%}.dss-transcript-scroll>.dss-pill,.dss-transcript-scroll>p{margin:8px}',
      '@media(max-height:360px){.dss-confirm-dialog.dss-recovery-dialog{overflow:auto}.dss-recovery-dialog>.dss-comparison,.dss-recovery-dialog>.dss-readable-comparison,.dss-recovery-dialog>.dss-transcript-comparison{flex:none;height:110px}}',
      '.dss-sync-page{--dss-sync-row-height:42px;--dss-sync-section-space:20px;--dss-sync-border:var(--dsw-alias-border-l2,#d9dde3)}.dss-sync-page>.dss-sec{padding-block:var(--dss-sync-section-space);gap:12px}.dss-sync-page>#dss-run{gap:4px}.dss-sync-page>#dss-run:first-of-type{border-top:0}',
      '.dss-conflict-comparison{height:calc(100dvh - var(--dss-conflict-reserved-height,78px));min-height:320px;display:flex;flex-direction:column}.dss-conflict-heading{flex:none}.dss-conflict-comparison>.dss-diff-footer{margin-inline:12px;padding-inline:0;border-top:0}.dss-conflict-comparison .dss-conflict-actions:not([hidden]){display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0}.dss-conflict-action-side{display:flex;justify-content:center;padding-inline:4px}.dss-conflict-comparison>.dss-comparison{min-height:0}',
      '.dss-page-heading{display:flex;align-items:center;justify-content:space-between;gap:8px 16px;min-height:46px;margin-bottom:14px}.dss-page-heading h1{margin:0;font-size:var(--dss-title-size,20px);font-weight:650;line-height:1.5;overflow-wrap:anywhere}.dss-page-heading>.dss-pill,.dss-page-heading .dss-diff-actions>.dss-pill{align-self:center}.dss-page-heading>.dss-pill{min-width:88px}.dss-page-heading .dss-diff-actions{flex:none;justify-content:flex-end}.dss-manage-page:focus,#dss-repair-page:focus{outline:none}.dss-wrap.dss-manage-page>.dss-sec{border-top:0;padding-top:0}.dss-manage-page .dss-storage-rows{margin-top:0}.dss-manage-page .dss-storage-row:first-child{border-top:0}@media(max-width:480px){.dss-page-heading .dss-diff-actions{flex-direction:column;align-items:stretch}.dss-page-heading .dss-diff-actions>.dss-pill{align-self:stretch}}',
      '.dss-panel.dss-management-panel{padding-block:32px 28px}.dss-panel:has(>.dss-sync-page){padding-block:12px 28px}.dss-sync-page .dss-sync-title{display:flex;align-items:center;flex-wrap:nowrap;gap:4px 12px;min-width:0}.dss-sync-title>h2{flex:none}.dss-sync-title .dss-status-light{min-width:0;white-space:nowrap}.dss-sync-stage{min-width:0;overflow:hidden;text-overflow:ellipsis}.dss-sync-title .dss-status-light>span:not(.dss-sync-stage){flex:none}.dss-sync-page #dss-run>.dss-rowline{position:relative;flex-wrap:nowrap}.dss-sync-page .dss-run-button{min-width:108px;order:2}.dss-sync-page .dss-connection-heading{min-height:var(--dss-sync-row-height);flex-wrap:nowrap}.dss-connection-heading>.dss-pill{min-width:112px;align-self:center}',
      '.dss-live-progress{position:relative;flex:none;order:1;z-index:2}.dss-sync-page .dss-live-progress>summary{display:block;width:max-content;margin:0;padding:2px 6px;border:1px solid var(--dss-sync-border);border-radius:6px;background:var(--dsw-alias-bg-layer-1,Canvas);color:var(--dsw-alias-label-secondary,inherit);font-size:12px;line-height:18px}.dss-live-progress-body{box-sizing:border-box;position:absolute;right:0;top:100%;width:min(320px,calc(100vw - 48px));padding:10px 12px;border:1px solid var(--dss-sync-border);border-radius:8px;background:var(--dsw-alias-bg-layer-1,Canvas);box-shadow:0 4px 12px #0002;overflow-wrap:anywhere}.dss-live-progress-body .dss-tx{white-space:normal}.dss-sync-page .dss-review details>summary{margin:0;padding-block:10px;line-height:22px}.dss-sync-page .dss-review details>ul{margin-top:0}.dss-sync-stage-short{display:none}@media(max-width:600px){.dss-live-progress{position:static}.dss-live-progress-body{width:min(320px,100%)}.dss-sync-page .dss-sync-title{gap:4px 8px}.dss-sync-title .dss-status-light{gap:4px}.dss-sync-page #dss-run>.dss-rowline{gap:7px}.dss-sync-page .dss-run-button{min-width:90px;padding-inline:6px}.dss-sync-stage-full{display:none}.dss-sync-stage-short{display:block;overflow:hidden;text-overflow:ellipsis}.dss-live-progress>summary{padding-inline:4px}}.dss-connection-form{display:flex;flex-direction:column;gap:10px}.dss-connection-form>.dss-field,.dss-connection-form>.dss-connection-actions{margin:0}',
      '.dss-sync-page #dss-run>.dss-rowline{min-height:46px;justify-content:space-between}.dss-sync-page #dss-run .dss-rowtext{flex:1 1 auto}.dss-conflict-notice button.dss-pill{min-width:108px}@media(max-width:600px){.dss-conflict-notice button.dss-pill{min-width:90px;padding-inline:6px}}',
      '.dss-sync-page #dss-run>details>summary{box-sizing:border-box;min-height:var(--dss-sync-row-height);margin:0;padding-block:10px;line-height:22px}.dss-sync-detail-content,.dss-net-detail{margin:0;padding:10px 0 12px 16px;border-top:1px solid var(--dss-sync-border)}.dss-net-detail{display:flex;flex-direction:column;gap:10px}.dss-net-detail .dss-net-command,.dss-net-detail .dss-err{margin:0}',
      '.dss-sync-page .dss-conflict-notice .dss-recovery-list{margin:4px 0 0 16px;padding:0;border-top:1px solid var(--dss-sync-border)}.dss-sync-page .dss-conflict-notice .dss-recovery-item{min-height:var(--dss-sync-row-height);flex-direction:row;align-items:center;gap:12px;padding:6px 0}.dss-sync-page .dss-conflict-notice .dss-recovery-file{overflow-wrap:anywhere}',
      '.dss-sync-page .dss-settings-body{gap:0}.dss-wrap.dss-sync-page .dss-setting-card{padding-block:var(--dss-sync-section-space);gap:12px}.dss-sync-page .dss-scope-fields>.dss-subsection-heading{margin-top:6px;padding-top:16px}.dss-sync-page>.dss-settings-group{padding-top:0}',
      '.dss-wrap>.dss-settings-group{padding-top:0}.dss-wrap .dss-setting-card{border:0;border-radius:0;padding:28px 0;gap:20px}.dss-settings-body{gap:0}.dss-settings-body>.dss-setting-card+.dss-setting-card{border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-settings-body>.dss-setting-card:last-child{padding-bottom:0}.dss-scope-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px;text-align:left}.dss-scope-fields>.dss-span-all{grid-column:1/-1}.dss-scope-fields>.dss-check{margin:0;gap:12px;padding:14px 16px}.dss-scope-fields>.dss-subsection-heading{margin-top:12px;padding-top:24px}.dss-wrap .dss-setting-card>.dss-section-title{text-align:left}.dss-scope-fields .dss-choice{gap:4px}.dss-scope-fields .dss-choice small{font-size:13px;line-height:1.6}',
      '.dss-onboarding nav.dss-steps{padding-left:0;margin:16px 0 0}.dss-onboarding button.dss-step-link{background:transparent;color:inherit;border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.4));font-weight:500}.dss-onboarding button.dss-step-link:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:inherit}.dss-onboarding button.dss-step-link:disabled{opacity:1;color:var(--dsw-alias-label-secondary,CanvasText);cursor:default}.dss-onboarding button.dss-step-link[aria-current=step]{opacity:1;background:light-dark(#edf1ff,#242e54);color:light-dark(#263b9c,#dee5ff);border-color:light-dark(#6176cb,#a4b3ef);font-weight:650}.dss-step-heading>h2:focus-visible,.dss-onboarding button:focus-visible{outline:2px solid light-dark(#4059df,#a4b3ef);outline-offset:3px}',
      '.dss-wrap .dss-setup-connect button.dss-pill:not(.dss-primary),.dss-wrap .dss-review button.dss-review-dismiss{background:transparent;color:inherit;border-color:var(--dsw-alias-border-l4,rgba(127,127,127,.4))}.dss-wrap .dss-setup-connect button.dss-pill:not(.dss-primary):not(:disabled):hover,.dss-wrap .dss-review button.dss-review-dismiss:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}.dss-review .dss-actions,.dss-review details{margin-top:10px}.dss-review ul{overflow-wrap:anywhere}',
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
      const [runError, setRunError] = useState(null);
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
            const notice = syncMessagePresentation(d.lastMessage, d.lastOk, d.lastDetail);
            setStatus(notice.current ? { ...d, lastOk: true } : d);
            setStatusError('');
            setReview(d.lastDetail?.needsReview && !d.lastDetail.privacy ? d.lastDetail.review : null);
          })
          .catch(err => setStatusError('无法读取同步状态：' + (err.message || String(err))));
      }, []);
      const run = useCallback(
        async (approval, expectedConnection) => {
          if (busy) return;
          runStartedAt.current = Date.now();
          setBusy(true);
          setRunError(null);
          setProgress(null);
          startPoll();
          try {
            const d = await API.run(approval, expectedConnection);
            setReview(d?.detail?.needsReview && !d.detail.privacy ? d.detail.review : null);
            if (!d?.ok && !d?.detail) {
              setRunError({ message: d?.error || '无法启动同步', startedAt: runStartedAt.current });
            }
            return d;
          } catch (err) {
            const message = err.message || String(err);
            setRunError({ message, startedAt: runStartedAt.current });
            return { ok: false, error: message };
          } finally {
            stopPoll();
            await refresh();
            setProgress(null);
            setBusy(false);
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
        runError: runError && !(status?.lastSyncAt >= runError.startedAt) ? runError : null,
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
    function TransferReview({ review, busy, collapsed, onExpand, onConfirm, onDismiss }) {
      if (!review) return null;
      const alternatives = review.alternatives || [];
      const missingFiles = alternatives.some(choice => choice.action === 'restore');
      if (missingFiles && collapsed)
        return e(
          'div',
          { className: 'dss-storage-head' },
          e('span', { role: 'status' }, '缺少文件，待处理'),
          pill('处理缺少文件', onExpand),
        );
      return e(
        'div',
        { className: 'dss-review', role: 'region', 'aria-label': missingFiles ? '本机缺少已同步的文件' : '同步预览' },
        missingFiles ? e('h3', null, '本机缺少已同步的文件') : null,
        e('p', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, review.summary),
        e(
          'div',
          { className: 'dss-actions' },
          ...alternatives.map(choice =>
            e(
              'button',
              {
                key: choice.id,
                type: 'button',
                className: choice.action === 'restore' ? 'dss-pill dss-primary' : 'dss-pill',
                disabled: Boolean(busy),
                onClick: () => onConfirm(choice.id),
              },
              choice.label,
            ),
          ),
          e(
            'button',
            {
              type: 'button',
              className: missingFiles ? 'dss-pill dss-danger' : 'dss-pill dss-primary',
              disabled: Boolean(busy),
              onClick: () => onConfirm(review.id),
            },
            busy && !missingFiles ? '正在继续…' : review.confirmLabel || '确认并继续',
          ),
          missingFiles && typeof onDismiss === 'function'
            ? e(
                'button',
                { type: 'button', className: 'dss-pill dss-review-dismiss', disabled: Boolean(busy), onClick: onDismiss },
                '暂不处理',
              )
            : null,
        ),
        missingFiles && review.sampleFiles?.length
          ? e(
              'details',
              null,
              e('summary', null, review.counts.deleted > review.sampleFiles.length ? '查看部分文件' : '查看文件'),
              e(
                'ul',
                null,
                review.sampleFiles.map(file => e('li', { key: file }, file)),
              ),
            )
          : null,
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
                      : '正在核对本机与云端变化';
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
            e('b', null, (issue.scope || '同步') + (issue.category ? ' · ' + issue.category : '')),
            e('div', null, issue.reason),
            issue.file
              ? e('code', null, issue.file + (issue.lines?.length ? ' · 第 ' + issue.lines.join('、') + ' 行' : ''))
              : null,
            e('div', { className: 'dss-startup-meta' }, issue.action),
            issue.detail?.length
              ? e(
                  'details',
                  null,
                  e('summary', null, 'Git 原文' + (issue.code ? ' · ' + issue.code : '')),
                  e(
                    'code',
                    { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } },
                    issue.detail.join(String.fromCharCode(10)),
                  ),
                )
              : null,
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
        Modal,
        {
          label: '发送前同步检查',
          title: attempt.ready ? '这条会话已完成同步' : '这条会话还不能发送',
          onClose: () => setAttempt(null),
        },
        dialogBody(
          e(
            'p',
            { role: 'status' },
            attempt.ready ? '请先查看最新对话，再次发送。输入内容和附件已保留。' : attempt.message,
          ),
          !attempt.ready && s?.phase === 'running'
            ? e(StartupProgress, { progress: snapshot.progress, phase: s.phase })
            : null,
          !attempt.ready && s?.issues?.length ? e(SyncIssues, { issues: s.issues, detail: s.detail }) : null,
          !attempt.ready && s?.phase === 'pending'
            ? e('p', null, '这条会话正在使用中。可先使用新会话，重新打开 DSH 后继续同步旧会话。')
            : null,
          connectionError || feedback ? e('p', { role: 'alert' }, feedback || '状态连接暂时中断，正在重连。') : null,
        ),
        dialogActions(
          '',
          e(
            'button',
            { type: 'button', className: 'dss-pill', onClick: () => setAttempt(null) },
            attempt.ready ? '返回会话，查看更新' : '返回编辑',
          ),
          !attempt.ready && s?.phase !== 'running'
            ? e(
                'button',
                { type: 'button', className: 'dss-pill dss-primary', disabled: actionPending, onClick: retry },
                actionPending ? '正在重试…' : '重试同步',
              )
            : null,
        ),
      );
    }

    let pluginUpdateNavigation = null;
    const pluginUpdateListeners = new Set();
    function usePluginUpdateNavigation() {
      const [navigation, setNavigation] = useState(pluginUpdateNavigation);
      useEffect(() => {
        pluginUpdateListeners.add(setNavigation);
        setNavigation(pluginUpdateNavigation);
        return () => pluginUpdateListeners.delete(setNavigation);
      }, []);
      return navigation;
    }

    /* Global startup reminder; settings retain a separate, expandable update entry. */
    function UpdateNotice(props) {
      const { config } = usePluginPreferences();
      const enabled = Boolean(config && config.autoCheckUpdates !== false);
      const navigation = usePluginUpdateNavigation();
      const [data, setData] = useState(null);
      const [visible, setVisible] = useState(false);
      const [pos, setPos] = useState(null);
      const [feedback, setFeedback] = useState('');
      const [copyFailed, setCopyFailed] = useState(false);
      useEffect(() => {
        if (!enabled) {
          setVisible(false);
          return;
        }
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
      }, [enabled, props.startup]);
      useEffect(() => {
        if (!enabled || !props.startup || !visible || !data || props.busy) return;
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
      }, [enabled, visible, data, props.busy]);
      if (!enabled || !visible || !data || (props.startup && (props.busy || !pos))) return null;
      const nativeUpdate = data.nativeUpdate === true && typeof navigation?.openBundle === 'function';
      const onWindows = data.platform === undefined || data.platform === 'win32';
      const shellName = onWindows ? ' PowerShell ' : '“终端”';
      const updateStep =
        data.hostKind === 'desktop'
          ? '执行前先完全退出桌面应用（' + (onWindows ? '含托盘' : '按 Command+Q') + '），更新后重新打开。'
          : '更新后重新启动 DSH。';
      const copy = async () => {
        try {
          await window.navigator.clipboard.writeText(data.command);
          setCopyFailed(false);
          setFeedback('已复制更新代码，请打开' + shellName + '粘贴并按回车。' + updateStep);
        } catch {
          setCopyFailed(true);
          setFeedback('复制失败，请手动复制下方代码，到' + shellName + '粘贴执行。' + updateStep);
        }
      };
      const openUpdate = () => {
        try {
          navigation.openBundle(data.packageName);
          if (props.startup) setVisible(false);
        } catch {
          setFeedback('请从侧边栏打开「插件」，找到 ChatSync 后更新。');
        }
      };
      const content = e(
        'div',
        null,
        e(
          'div',
          { className: 'dss-update-requirement' },
          data.dshRequirement ? '需要 DSH ' + data.dshRequirement : 'DSH 版本要求：未声明',
        ),
        e(
          'div',
          { className: 'dss-update-actions' },
          e(
            'button',
            { type: 'button', className: 'dss-btn', onClick: nativeUpdate ? openUpdate : copy },
            nativeUpdate ? '前往插件页更新' : '复制更新代码',
          ),
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
      preferenceLoad = null;
    let pluginPreferences = { config: null, saving: false, error: '' };
    const preferenceListeners = new Set();
    function publishPreferences(patch) {
      pluginPreferences = { ...pluginPreferences, ...patch };
      for (const listener of preferenceListeners) listener(pluginPreferences);
    }
    function acceptPreferences(data) {
      if (!data?.ok || !data.config) throw new Error(data?.error || '无法读取插件设置');
      if (pluginPreferences.config?.autoCheckUpdates !== data.config.autoCheckUpdates) updateRequest = null;
      sidebarBinding?.(data.config.showSidebarSync !== false);
      publishPreferences({ config: data.config });
    }
    function loadPluginPreferences() {
      if (preferenceLoad) return preferenceLoad;
      publishPreferences({ error: '' });
      preferenceLoad = API.config()
        .then(acceptPreferences)
        .catch(error => {
          if (!pluginPreferences.config) sidebarBinding?.(true);
          publishPreferences({ error: error.message || '无法读取插件设置' });
        })
        .finally(() => {
          preferenceLoad = null;
        });
      return preferenceLoad;
    }
    function usePluginPreferences() {
      const [state, setState] = useState(pluginPreferences);
      useEffect(() => {
        preferenceListeners.add(setState);
        setState(pluginPreferences);
        if (!pluginPreferences.config) loadPluginPreferences();
        return () => preferenceListeners.delete(setState);
      }, []);
      return state;
    }
    function pluginPreferenceEnabled(config, key) {
      if (key === 'automatic') return config.automatic ?? config.enabled !== false;
      return config[key] !== false;
    }
    async function togglePluginPreference(key) {
      if (!pluginPreferences.config || pluginPreferences.saving) return;
      const next = !pluginPreferenceEnabled(pluginPreferences.config, key);
      publishPreferences({ saving: true, error: '' });
      try {
        const data = await API.saveConfig({ [key]: next });
        acceptPreferences(data);
        if (pluginPreferenceEnabled(data.config, key) !== next) publishPreferences({ error: '宿主配置固定了此选项。' });
      } catch (error) {
        try {
          acceptPreferences(await API.config());
          publishPreferences({ error: error.message || '保存失败，请重试' });
        } catch {
          publishPreferences({ config: null, error: '保存状态未知，请重新读取。' });
        }
      } finally {
        publishPreferences({ saving: false });
      }
    }
    function SidebarVisibilityProvider() {
      usePluginPreferences();
      return null;
    }
    function PluginPreferences({ view } = {}) {
      const { config, saving, error } = usePluginPreferences();
      if (view === 'summary') return null;
      return e(
        'div',
        { className: 'dss-plugin-prefs' },
        ...[
          ['showSidebarSync', '侧边栏显示同步', '关闭后仍可从「设置 → 同步」打开。'],
          ['automatic', '自动同步', '按同步设置中的选项，在启动或退出 DSH 时自动同步。关闭后仍可手动同步。'],
          ['autoCheckUpdates', '自动检查更新', '检查 ChatSync 的新版本并显示更新提醒。'],
        ].map(([key, label, description]) => {
          const checked = Boolean(config && pluginPreferenceEnabled(config, key));
          const descriptionId = 'dss-plugin-preference-' + key;
          return e(
            'div',
            { className: 'dss-rowline', key },
            e('div', { className: 'dss-rowtext' }, e('span', null, label), e('small', { id: descriptionId }, description)),
            e(
              'button',
              {
                type: 'button',
                role: 'switch',
                'aria-label': label,
                'aria-describedby': descriptionId,
                'aria-checked': checked,
                disabled: !config || saving,
                className: 'dss-switch' + (checked ? ' dss-switch-on' : ''),
                onClick: () => togglePluginPreference(key),
              },
              e('span', { className: 'dss-switch-knob' }),
            ),
          );
        }),
        error ? e('p', { role: 'alert', className: 'dss-err' }, error) : null,
        !config && error ? pill('重新读取', loadPluginPreferences) : null,
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
    let conflictRequest = null;
    function openSessionConflict(record) {
      conflictRequest = record;
      repairNavigation.selectPanel('dsh-sync-conflict');
    }
    function SessionConflictPage() {
      const { busy, refresh } = useSync();
      const request = conflictRequest;
      const close = () => repairNavigation.selectPanel('dsh-sync');
      return e(
        ManagementPage,
        { className: 'dss-conflict-page' },
        request
          ? e(RecoveryItem, {
              record: request,
              busy,
              page: true,
              initiallyOpen: true,
              onRestored: refresh,
              onPreviewClosed: close,
            })
          : e(SyncPageHeading, { title: '会话同步冲突' }),
      );
    }
    const syncBackupTitle = '历史冲突会话备份';
    function usePageStart() {
      const root = useRef(null);
      useLayoutEffect(() => {
        const page = root.current;
        if (!page) return;
        const parent = scrollParent(page);
        if (parent) parent.scrollTop = 0;
        page.scrollTop = 0;
        page.focus({ preventScroll: true });
      }, []);
      return root;
    }
    function ManagementPage({ title, className = '', children }) {
      const root = usePageStart();
      return e(
        'div',
        { className: 'dss-panel dss-management-panel' },
        e(
          'main',
          { className: 'dss-wrap dss-manage-page ' + className, tabIndex: -1, ref: root, 'aria-label': title },
          title ? e(SyncPageHeading, { title }) : null,
          children,
        ),
      );
    }
    function SyncPageHeading({ title }) {
      return e(
        'header',
        { className: 'dss-page-heading' },
        e('h1', null, title),
        pill('返回同步', () => repairNavigation.selectPanel('dsh-sync')),
      );
    }
    function ConnectionPage() {
      const { busy, status } = useSync();
      return e(
        ManagementPage,
        { title: '更换同步仓库' },
        e(ConnectionSettings, { manage: true, busy, remote: status?.remote, branch: status?.branch }),
      );
    }
    function isSyncBackup(record) {
      return Boolean(record.conflictResolution) || record.kind === 'settings-version-reset';
    }
    function SyncBackupPage() {
      const [section, setSection] = useState('conflicts');
      const [query, setQuery] = useState('');
      const [records, setRecords] = useState(null);
      const [error, setError] = useState('');
      const [selection, setSelection] = useState(null);
      const [status, setStatus] = useState('');
      const [busy, setBusy] = useState(false);
      const load = async () => {
        try {
          const data = await API.recovery();
          if (!data.ok) throw new Error(data.error);
          setRecords(data.records.filter(isSyncBackup));
          setError('');
        } catch (error) {
          setError(error.message || String(error));
        }
      };
      useEffect(() => {
        load();
      }, []);
      const remove = async () => {
        if (busy || !selection) return;
        setBusy(true);
        setError('');
        try {
          const preview = await API.localStorage('preview', { recoveryId: selection.id });
          if (!preview.ok) throw new Error(preview.error);
          const result = await API.localStorage('apply', { token: preview.token, confirm: true });
          if (!result.ok) throw new Error(result.error || result.results?.find(item => !item.ok)?.error || '删除失败');
          setSelection(null);
          await load();
          setStatus('已删除备份。');
        } catch (error) {
          setError(error.message || String(error));
        } finally {
          setBusy(false);
        }
      };
      const matches = (records || []).filter(
        record =>
          Boolean(record.conflictResolution) === (section === 'conflicts') &&
          [record.projectTitle, record.sessionTitle, record.path]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      );
      const projects = Map.groupBy(matches, record => (record.conflictResolution ? record.projectTitle || '' : ''));
      return e(
        ManagementPage,
        { className: 'dss-sync-backups', title: syncBackupTitle },
        e(
          'div',
          { className: 'dss-help-tabs', role: 'group', 'aria-label': '备份类型' },
          ...[
            ['conflicts', '冲突会话'],
            ['settings', '设置'],
          ].map(([id, title]) =>
            e(
              'button',
              {
                key: id,
                type: 'button',
                className: 'dss-help-tab',
                'aria-pressed': id === section,
                onClick: () => {
                  setSection(id);
                  setQuery('');
                },
              },
              title,
            ),
          ),
        ),
        e('input', {
          className: 'dss-input',
          value: query,
          type: 'search',
          'aria-label': '搜索备份',
          placeholder: section === 'conflicts' ? '搜索项目或会话' : '搜索设置文件',
          onChange: event => setQuery(event.target.value),
        }),
        status ? e('p', { role: 'status' }, status) : null,
        error && !selection ? e('p', { role: 'alert', className: 'dss-err' }, error, ' ', pill('重新读取', load)) : null,
        !records && !error
          ? e('p', { role: 'status' }, '正在读取…')
          : records && !matches.length
            ? e('p', { role: 'status' }, query.trim() ? '没有匹配的备份。' : '暂无备份。')
            : null,
        ...Array.from(projects, ([project, rows]) =>
          e(
            'section',
            { key: project },
            project ? e('h2', { className: 'dss-subtitle' }, '项目「' + project + '」') : null,
            ...rows.map(record =>
              e(
                'div',
                { className: 'dss-backup-record', key: record.id },
                e(RecoveryItem, { record, onRestored: load, readOnly: true }),
                pill(
                  '删除备份',
                  () => {
                    setError('');
                    setStatus('');
                    setSelection(record);
                  },
                  { disabled: busy },
                ),
              ),
            ),
          ),
        ),
        selection
          ? e(
              Modal,
              {
                title: '永久删除本机备份？',
                onClose: () => {
                  if (!busy) {
                    setSelection(null);
                    setError('');
                  }
                },
              },
              dialogBody(
                e('p', null, selection.sessionTitle || selection.path),
                error ? e('p', { role: 'alert', className: 'dss-err' }, error) : null,
              ),
              dialogActions(
                '',
                pill(
                  '取消',
                  () => {
                    setSelection(null);
                    setError('');
                  },
                  { disabled: busy },
                ),
                pill(busy ? '正在删除…' : '永久删除', remove, { kind: 'danger', disabled: busy }),
              ),
            )
          : null,
      );
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
      const root = usePageStart();
      const [request, setRequest] = useState(repairRequest);
      const { busy, refresh } = useSync();
      useEffect(() => {
        repairListeners.add(setRequest);
        return () => repairListeners.delete(setRequest);
      }, []);
      const grouping = request.mode === 'grouping';
      return e(
        'main',
        {
          id: 'dss-repair-page',
          className: 'dss-panel dss-management-panel',
          ref: root,
          tabIndex: -1,
          'aria-label': grouping ? '处理未分组会话' : '修复会话问题（实验性）',
        },
        e(
          'div',
          { className: 'dss-wrap' },
          e('style', null, STYLE),
          e(SyncPageHeading, { title: grouping ? '处理未分组会话' : '修复会话问题（实验性）' }),
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
      if (typeof record.sessionTitle === 'string')
        return {
          name:
            '会话「' +
            (record.sessionTitle || '未命名') +
            '」' +
            (/^storages\/session_projcache\//.test(file) ? '的列表信息' : ''),
          location: '',
        };
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
      for (const report of lastDetail.privacyReports?.length
        ? lastDetail.privacyReports
        : lastDetail.privacy
          ? [lastDetail.privacy]
          : [])
        for (const finding of report.findings || [])
          lines.push('可能含密钥（已上传）: ' + finding.file + ' · ' + finding.reasons.join('、'));
      for (const item of lastDetail.skippedLarge || [])
        lines.push('未同步（' + (item.reason || '超过 ' + item.limit) + '）: ' + item.file + ' · ' + fmtBytes(item.size));
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
      if (lastDetail.repoSize != null) lines.push('本机同步副本（含历史）: ' + fmtBytes(lastDetail.repoSize));
      if (lastDetail.skipped) lines.push('跳过: ' + lastDetail.skipped);
      for (const w of lastDetail.sessionWarnings || [])
        lines.push(
          '会话未混合合并: ' +
            w.path +
            '；当前保留' +
            (w.kept === 'remote' ? '云端' : '本机') +
            '；本机原件 ' +
            w.localHead +
            '；云端原件 ' +
            w.remoteHead,
        );
      for (const w of lastDetail.sessionDeferred || []) lines.push('会话等待应用: ' + w.hint + '；' + w.file);
      for (const warning of lastDetail.scopeWarnings || []) lines.push(warning);
      if (lastDetail.settingsPause) lines.push(lastDetail.settingsPause);
      if (lastDetail.settingsVersionReset)
        lines.push(
          '已清除 DSH ' +
            lastDetail.settingsVersionReset.from +
            ' 的设置版本记录，设置恢复同步；原设置另存为 ' +
            lastDetail.settingsVersionReset.backups +
            ' 份恢复记录。',
        );
      if (lastDetail.backupBranch)
        lines.push(
          '备份分支: ' +
            lastDetail.backupBranch +
            (lastDetail.backupPushed === true ? '（已上传）' : '（仅在本机，上传失败）'),
        );
      if (lastDetail.failure) {
        lines.push('会话与设置同步失败（' + lastDetail.failure.title + '）: ' + lastDetail.failure.reason);
        for (const line of lastDetail.failure.detail || []) lines.push('  Git: ' + line);
      } else if (lastDetail.error)
        lines.push(
          (lastDetail.dataVerificationPending || lastDetail.dataRepairQueued ? '待处理: ' : '会话与设置同步失败: ') +
            lastDetail.error,
        );
      if (lastDetail.workspaces) {
        const w = lastDetail.workspaces;
        for (const project of w.created || [])
          lines.push('已创建项目「' + (project.title || project.id) + '」：' + project.path);
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
              (c.copy ? '\n      云端版本: ' + c.copy : ''),
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
        e('h2', { className: 'dss-section-title', id: 'dss-setup-heading-' + number, tabIndex: -1 }, title),
      );
    }
    // The host's modal scroll lock can cancel native-dialog wheel defaults. Handle
    // scrolling inside our dialog, including text descendants and nested lists.
    function scrollDialogWheel(event, root) {
      if (event.ctrlKey) return; // Keep browser zoom available.
      const unit = event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? root.clientHeight : 1;
      const dx = event.deltaX * unit,
        dy = event.deltaY * unit;
      for (
        let node = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
        node;
        node = node.parentElement
      ) {
        const style = getComputedStyle(node);
        const x = /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
        const y = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
        const canX = x && dx && (dx < 0 ? node.scrollLeft > 0 : node.scrollLeft < node.scrollWidth - node.clientWidth);
        const canY = y && dy && (dy < 0 ? node.scrollTop > 0 : node.scrollTop < node.scrollHeight - node.clientHeight);
        if (canX || canY) {
          if (canX) node.scrollLeft += dx;
          if (canY) node.scrollTop += dy;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (node === root) break;
      }
    }
    function useDialogWheel(ref) {
      useEffect(() => {
        const root = ref.current;
        const wheel = event => scrollDialogWheel(event, root);
        root?.addEventListener?.('wheel', wheel, { passive: false });
        return () => root?.removeEventListener?.('wheel', wheel);
      }, []);
    }
    function ConnectionSettings({
      busy,
      onSaved,
      onSavingChange,
      remote,
      branch,
      setup = false,
      candidate,
      manage = false,
      onManage,
    }) {
      const [config, setConfig] = useState(null);
      const [draft, setDraft] = useState('');
      const [editing, setEditing] = useState(false);
      const [error, setError] = useState('');
      const [message, setMessage] = useState('');
      const [saving, setSaving] = useState(false);
      const [attempt, setAttempt] = useState(0);
      const [helpTab, setHelpTab] = useState(null);
      const [otherDraft, setOtherDraft] = useState(false);
      const [manageDefault, setManageDefault] = useState(false);
      const [githubOwner, setGithubOwner] = useState(candidate?.defaultOwner || '');
      const original = useRef(null);
      const dirty = useRef(false);
      const savingRef = useRef(false);
      const showForm = config && (editing || (manage && !manageDefault && config.remote));
      const showDefault = config && !showForm && (!config.remote || manageDefault);
      useEffect(() => {
        if (dirty.current) return;
        let alive = true;
        setError('');
        API.config()
          .then(d => {
            if (!d || !d.ok || !d.config) throw new Error((d && d.error) || '无法读取仓库配置');
            if (alive && !dirty.current) {
              original.current = d.config;
              const selected =
                candidate?.expectedRemote === (d.config.remote || '') &&
                candidate.expectedBranch === d.config.branch &&
                candidate.expectedAutoRepo === d.config.autoRepo
                  ? candidate
                  : null;
              setConfig(selected?.config || d.config);
              setDraft((selected?.config || d.config).remote || '');
              if (setup) setMessage(selected?.hint || '');
            }
          })
          .catch(err => {
            if (alive) setError(err.message || String(err));
          });
        return () => {
          alive = false;
        };
      }, [attempt, remote, branch, candidate, setup]);
      useEffect(() => {
        if (!showDefault || githubOwner) return;
        let alive = true;
        API.githubAccount()
          .then(data => {
            if (alive && data.ok && data.owner) setGithubOwner(data.owner);
          })
          .catch(() => {});
        return () => {
          alive = false;
        };
      }, [showDefault, githubOwner]);
      const startEditing = (other = false) => {
        if (busy || savingRef.current) return;
        dirty.current = true;
        setDraft(other && config.remoteWeb?.label === 'GitHub' ? '' : config.remote || '');
        setOtherDraft(other);
        setManageDefault(false);
        setEditing(true);
        setHelpTab(other ? 'other' : null);
        setError('');
        setMessage('');
      };
      const chooseDefault = () => {
        if (busy || savingRef.current) return;
        dirty.current = true;
        setManageDefault(true);
        setEditing(false);
        setHelpTab('github');
        setMessage('');
        setError('');
      };
      const cancel = () => {
        if (savingRef.current) return;
        dirty.current = false;
        setEditing(false);
        setOtherDraft(false);
        setManageDefault(false);
        setHelpTab(null);
        setError('');
        setDraft(config.remote || '');
        setAttempt(attempt + 1);
      };
      const save = async event => {
        event.preventDefault();
        if (!config || savingRef.current || busy || (!setup && !manage && config.remote && !editing)) return;
        const address = showDefault ? '' : draft.trim();
        if (showDefault) setHelpTab('github');
        if (!showDefault && !address) {
          setError('请输入私有仓库地址。');
          return;
        }
        const choice = {
          remote: address,
          expectedRemote: original.current.remote || '',
          ...(setup ? { expectedBranch: original.current.branch, expectedAutoRepo: original.current.autoRepo } : {}),
        };
        savingRef.current = true;
        setSaving(true);
        onSavingChange?.(true);
        setMessage('');
        setError('');
        try {
          if (manage && showDefault) {
            const checked = await API.saveConnection({ ...choice, validateOnly: true });
            if (!checked?.ok || !checked.defaultOwner) throw new Error(checked?.error || '无法确认 GitHub 账号，请重试。');
            setGithubOwner(checked.defaultOwner);
          }
          const d = await API.saveConnection(setup ? { ...choice, validateOnly: true } : choice);
          if (!d || !d.ok || !d.config) throw new Error((d && d.error) || '保存失败，请重试');
          if (setup) {
            if (!d.config.remote && !d.defaultOwner) throw new Error('无法确认默认仓库所属的 GitHub 账号，请重试。');
            if (d.defaultOwner) setGithubOwner(d.defaultOwner);
            onSaved?.({ ...choice, remote: d.config.remote, config: d.config, hint: d.hint, defaultOwner: d.defaultOwner });
            return;
          }
          setConfig(d.config);
          original.current = d.config;
          setDraft(d.config.remote || '');
          setEditing(false);
          setManageDefault(false);
          setHelpTab(null);
          dirty.current = false;
          setMessage(d.hint || (d.config.remote ? '已验证并保存同步仓库。' : '已选择 GitHub 仓库。'));
          if (!manage && !d.config.remote) {
            // The default backup connects on the first sync; check gh now so problems show immediately.
            setMessage('已使用默认仓库，正在检查 GitHub 登录…');
            const check = await API.checkConnection().catch(err => ({ ok: false, message: err.message || String(err) }));
            if (check?.ok) setMessage(check.message);
            else {
              setMessage('已使用默认仓库。');
              setError((check && check.message) || '无法检查 GitHub 登录，请稍后重试。');
            }
          }
          onSaved?.();
        } catch (err) {
          setError(err.message || String(err));
        } finally {
          savingRef.current = false;
          setSaving(false);
          onSavingChange?.(false);
        }
      };
      const parsedLink = config?.remoteWeb || null;
      const addressTab = showForm ? repositoryHelpTab(draft) : null;
      const addressProvider = addressTab || (otherDraft ? 'other' : defaultHelpTab(config));
      const activeHelpTab = helpTab || addressProvider;
      const autoRepoDescription =
        '使用 GitHub 仓库时，自动创建或复用' +
        (githubOwner ? ' ' + githubOwner + ' ' : '当前登录的 GitHub ') +
        '账号下的 dsh-sync 私有仓库。';
      const selectHelpTab = (id, focus = false) => {
        setHelpTab(id);
        if (focus && typeof document !== 'undefined')
          setTimeout(() => document.getElementById(HELP_TAB_ID + id)?.focus(), 0);
      };
      return e(
        'form',
        {
          className: 'dss-sec dss-setting-card' + (setup ? ' dss-setup-connect' : ''),
          id: 'dss-connect',
          tabIndex: -1,
          onSubmit: save,
        },
        manage
          ? null
          : setup
            ? stepHeading(1, '设置同步仓库')
            : e(
                'div',
                { className: 'dss-storage-head dss-connection-heading' },
                e(
                  'div',
                  { className: 'dss-title-status' },
                  e('h2', { className: 'dss-section-title' }, '同步仓库'),
                  config?.remote && parsedLink
                    ? e('span', { className: 'dss-status-light', 'data-tone': 'blue' }, '已连接')
                    : null,
                ),
                config?.remote
                  ? e(
                      'button',
                      {
                        type: 'button',
                        className: 'dss-pill',
                        'aria-expanded': Boolean(showForm),
                        disabled: saving || (busy && !showForm),
                        onClick: showForm ? cancel : onManage || (() => startEditing()),
                      },
                      showForm ? '取消' : '更换同步仓库',
                    )
                  : null,
              ),
        !config && !error ? e('div', { className: 'dss-desc' }, '正在读取连接设置…') : null,
        error ? e('div', { className: 'dss-err dss-form-error', role: 'alert' }, error) : null,
        !config && error
          ? e('button', { type: 'button', className: 'dss-pill', onClick: () => setAttempt(attempt + 1) }, '重新读取')
          : null,
        config && !showForm && (setup || manage || !config.remote || !parsedLink)
          ? e(
              'div',
              null,
              setup && config.remote && parsedLink && !showDefault
                ? e('span', { className: 'dss-status-light', 'data-tone': 'blue' }, '已选同步仓库')
                : null,
              showDefault
                ? e('div', { className: 'dss-desc' }, autoRepoDescription)
                : parsedLink
                  ? null
                  : e(
                      'div',
                      { className: 'dss-err', role: 'alert' },
                      '现有地址不受支持，请更换为私有 Git 仓库的 HTTPS 或 SSH 地址。',
                    ),
              e(
                'div',
                { className: 'dss-actions dss-connection-actions' },
                showDefault
                  ? e(
                      'button',
                      { type: 'submit', className: 'dss-pill', disabled: busy || saving },
                      saving ? (setup ? '正在检查…' : '正在保存…') : '使用 GitHub 仓库',
                    )
                  : null,
                setup || manage || !config.remote
                  ? pill(showDefault ? '使用其他仓库（实验性）' : '更换同步仓库', () => startEditing(showDefault), {
                      disabled: busy || saving,
                    })
                  : null,
                setup && parsedLink
                  ? e(
                      'button',
                      { type: 'submit', className: 'dss-pill dss-primary', disabled: busy || saving },
                      saving ? '正在检查…' : '继续选择内容',
                    )
                  : null,
              ),
            )
          : null,
        showForm
          ? e(
              'fieldset',
              {
                className: 'dss-connection-form',
                disabled: saving || busy,
                style: { border: 0, margin: 0, padding: 0, minWidth: 0 },
              },
              e(
                'label',
                { className: 'dss-field' },
                '仓库地址',
                e('input', {
                  className: 'dss-input',
                  type: 'text',
                  value: draft,
                  required: true,
                  placeholder:
                    addressProvider === 'github'
                      ? '例如 https://github.com/用户名/dsh-sync.git'
                      : '例如 https://gitee.com/用户名/dsh-sync.git',
                  autoComplete: 'off',
                  spellCheck: false,
                  onChange: ev => {
                    dirty.current = true;
                    setDraft(ev.target.value);
                    const tab = repositoryHelpTab(ev.target.value);
                    if (tab) setHelpTab(tab);
                    setMessage('');
                    setError('');
                  },
                }),
              ),
              e(
                'div',
                { className: 'dss-desc' },
                e(
                  'p',
                  null,
                  !otherDraft && addressProvider === 'github'
                    ? '填写已有 GitHub 私有仓库的 HTTPS 或 SSH 克隆地址。已有 ChatSync 仓库可以直接用，新建仓库请保持为空。'
                    : '从 GitHub、Gitee、GitLab 等托管站的私有仓库复制 HTTPS 或 SSH 克隆地址。已有 ChatSync 仓库可以直接用，新建仓库请保持为空。',
                ),
                otherDraft || addressProvider !== 'github'
                  ? e(
                      'p',
                      null,
                      'GitHub 以外的站点还需支持用 HTTPS 检查仓库是否私有。若使用 SSH，同一主机名和路径也要能通过 HTTPS 访问。',
                    )
                  : null,
              ),
              e(
                'div',
                { className: 'dss-actions dss-connection-actions' },
                e(
                  'button',
                  { type: 'submit', className: 'dss-pill dss-primary' },
                  saving ? (setup ? '正在检查…' : '正在检查并保存…') : setup ? '验证并继续' : '保存仓库设置',
                ),
                manage ? pill('使用 GitHub 仓库', chooseDefault) : null,
                !manage && (setup || !config.remote) ? pill('取消', cancel) : null,
              ),
            )
          : null,
        message ? e('div', { className: 'dss-save-state', role: 'status' }, message) : null,
        setup || manage || showForm
          ? e(
              'section',
              { className: 'dss-tip dss-login-help', 'aria-label': '登录帮助' },
              e('h3', null, '登录帮助'),
              loginHelpTabs(activeHelpTab, selectHelpTab),
              helpTabPanel(activeHelpTab),
            )
          : null,
      );
    }

    const HELP_TAB_ID = 'dss-login-help-tab-';
    const HELP_PANEL_ID = 'dss-login-help-panel';
    const HELP_TABS = [
      { id: 'github', label: 'GitHub 仓库' },
      { id: 'other', label: 'Gitee、GitLab 等其他托管站' },
    ];
    /** The help tab for the repository in use: GitHub until another host is connected. */
    function defaultHelpTab(config) {
      if (!config || !config.remote) return 'github';
      return config.remoteWeb?.label === 'GitHub' ? 'github' : 'other';
    }
    function repositoryHelpTab(address) {
      const host = /^(?:(?:https|ssh):\/\/(?:[^@/]+@)?|[^@/:]+@)([a-z0-9.-]+)(?=[:/])/i.exec(address.trim())?.[1];
      return host ? (host.toLowerCase() === 'github.com' ? 'github' : 'other') : null;
    }
    function loginHelpTabs(active, select) {
      const onKeyDown = event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const index = HELP_TABS.findIndex(tab => tab.id === active);
        const step = event.key === 'ArrowRight' ? 1 : HELP_TABS.length - 1;
        select(HELP_TABS[(index + step) % HELP_TABS.length].id, true);
      };
      return e(
        'div',
        { className: 'dss-help-tabs', role: 'tablist', 'aria-label': '仓库类型', onKeyDown },
        HELP_TABS.map(tab =>
          e(
            'button',
            {
              key: tab.id,
              type: 'button',
              role: 'tab',
              id: HELP_TAB_ID + tab.id,
              className: 'dss-help-tab',
              'aria-selected': tab.id === active,
              'aria-controls': HELP_PANEL_ID,
              tabIndex: tab.id === active ? 0 : -1,
              onClick: () => select(tab.id),
            },
            tab.label,
          ),
        ),
      );
    }
    // Annotated, account-free picture of the gh auth login terminal output.
    function githubLoginDiagram() {
      const badge = n => e('span', { className: 'dss-gh-badge', 'aria-hidden': true }, n);
      const row = (n, line, note, dim = false) =>
        e(
          'div',
          { className: 'dss-gh-row' + (n ? ' dss-gh-act' : '') + (dim ? ' dss-gh-dim' : '') },
          e('span', { className: 'dss-gh-n' }, n ? badge(n) : null),
          e('span', { className: 'dss-gh-t' }, ...line),
          note ? e('span', { className: 'dss-gh-note' }, note) : null,
        );
      const warn = e('span', { className: 'dss-gh-warn' }, '!');
      const ok = e('span', { className: 'dss-gh-ok' }, '✓');
      return e(
        'div',
        {
          className: 'dss-gh-diagram dss-gh-term',
          role: 'img',
          'aria-label':
            '终端授权过程示意：1 粘贴命令并按 Enter；2 输入 Y 并按 Enter；3 一次性代码已自动复制；4 按 Enter 打开授权页；5 终端显示 Logged in as 你的用户名，授权完成',
        },
        e('div', { className: 'dss-gh-bar' }, 'Windows PowerShell'),
        row(1, ['PS C:\\Users\\你> gh auth login --hostname github.com --git-protocol https --web'], '粘贴命令，按 Enter'),
        row(
          null,
          [warn, ' Did you know that expiring tokens can be requested with --expiring? …'],
          '提示信息，不用管',
          true,
        ),
        row(
          2,
          [
            e('span', { className: 'dss-gh-ok' }, '?'),
            ' Authenticate Git with your GitHub credentials? (Y/n) ',
            e('span', { className: 'dss-gh-you' }, 'Y'),
          ],
          '输入 Y，按 Enter',
        ),
        row(
          3,
          [warn, ' One-time code (', e('span', { className: 'dss-gh-code' }, 'ABCD-1234'), ') copied to clipboard'],
          '一次性代码，已经自动复制好了',
        ),
        row(
          4,
          [
            'Press ',
            e('span', { className: 'dss-gh-you' }, 'Enter'),
            ' to open https://github.com/login/device in your browser...',
          ],
          '再按一次 Enter，浏览器会打开授权页',
        ),
        row(null, [ok, ' Authentication complete.']),
        row(5, [ok, ' Logged in as 你的用户名'], '看到这一行就完成了，回到这里点「立即同步」'),
      );
    }
    const GIT_DOWNLOAD = () => e('li', null, '安装 ', helpLink('Git', 'https://git-scm.com/downloads'));
    function helpTabPanel(active) {
      let body;
      if (active === 'github')
        body = [
          e(
            'ol',
            { key: 'steps' },
            GIT_DOWNLOAD(),
            e('li', null, '安装 ', helpLink('GitHub CLI', 'https://cli.github.com/')),
            e(
              'li',
              null,
              '在“终端”运行',
              e('code', { className: 'dss-command' }, 'gh auth login --hostname github.com --git-protocol https --web'),
              e(
                'strong',
                { className: 'dss-gh-proxy' },
                '如需通过代理访问 GitHub，请确保已通过环境变量为 GitHub CLI（gh）配置可用代理，或已启用能够代理 GitHub 流量的 TUN 模式',
              ),
            ),
            e('li', null, '根据指引完成授权。'),
          ),
          e('div', { key: 'diagram' }, githubLoginDiagram()),
        ];
      else
        body = [
          e(
            'ol',
            { key: 'steps' },
            GIT_DOWNLOAD(),
            e(
              'li',
              null,
              'HTTPS 地址：打开“终端”，运行（换成你的仓库地址）',
              e('code', { className: 'dss-command' }, 'git ls-remote https://gitee.com/用户名/dsh-sync.git'),
              '按 Git 的提示输入该站的账号和密码或访问令牌。',
              e(
                'div',
                { className: 'dss-help-alt' },
                '或 SSH 地址：为这台电脑生成 SSH 密钥，把公钥添加到托管站的「SSH 公钥」设置，再运行 git ls-remote 加仓库地址。',
              ),
            ),
          ),
          e(
            'nav',
            { key: 'links', className: 'dss-links', 'aria-label': '其他托管站帮助' },
            helpLink('其他托管站说明', DOCS + 'configuration.md#其他-git-托管站'),
          ),
        ];
      return e(
        'div',
        {
          className: 'dss-help-panel',
          role: 'tabpanel',
          id: HELP_PANEL_ID,
          'aria-labelledby': HELP_TAB_ID + active,
        },
        ...body,
      );
    }
    function WorkspaceLocations({ busy, setup = false, onPendingChange, lastSyncAt }) {
      const [workspaces, setWorkspaces] = useState(null);
      const [paths, setPaths] = useState({}),
        [pending, setPending] = useState(false),
        [message, setMessage] = useState('');
      const [editing, setEditing] = useState('');
      const savingRef = useRef(false);
      const seenSync = useRef(lastSyncAt);
      const load = async () => {
        setPending(true);
        setMessage('');
        try {
          const data = await API.workspaceLocations();
          if (!data.ok) throw new Error(data.error);
          setWorkspaces(data.workspaces || []);
        } catch (error) {
          setMessage(error.message || String(error));
        } finally {
          setPending(false);
        }
      };
      useEffect(() => {
        load();
      }, []);
      useEffect(() => {
        if (setup || pending || seenSync.current === lastSyncAt) return;
        seenSync.current = lastSyncAt;
        load();
      }, [lastSyncAt, pending, setup]);
      const hasUnsavedPath = Boolean(
        workspaces?.some(ws => !ws.localPath || (paths[ws.id] ?? ws.localPath) !== ws.localPath),
      );
      useEffect(() => {
        onPendingChange?.(pending || workspaces === null || hasUnsavedPath);
      }, [onPendingChange, pending, workspaces, hasUnsavedPath]);
      const fields = e(
        'div',
        { className: 'dss-stack' },
        pending ? e('p', { className: 'dss-desc', role: 'status' }, '正在读取…') : null,
        workspaces?.length === 0 ? e('p', { className: 'dss-desc' }, '暂无项目。') : null,
        (workspaces || []).map(ws => {
          const value = paths[ws.id] ?? ws.localPath ?? '';
          const label = '项目「' + ws.title + '」';
          if (ws.localPath && editing !== ws.id)
            return e(
              'div',
              { key: ws.id, className: 'dss-rowline dss-workspace-location-row' },
              e('div', { className: 'dss-rowtext' }, label, e('span', { className: 'dss-desc' }, ws.localPath)),
              e(
                'button',
                {
                  type: 'button',
                  className: 'dss-pill',
                  disabled: busy || pending,
                  'aria-label': '更改' + label + '的本机目录',
                  onClick: () => {
                    setEditing(ws.id);
                    setPaths({});
                    setMessage('');
                  },
                },
                '更改',
              ),
            );
          return e(
            'div',
            { key: ws.id, className: 'dss-workspace-location-field' },
            e(
              'label',
              { className: 'dss-field' },
              label + '的本机目录',
              e('input', {
                className: 'dss-input',
                value,
                disabled: busy || pending,
                onChange: event => {
                  setPaths({ ...paths, [ws.id]: event.target.value });
                  setMessage('');
                },
              }),
            ),
            ws.path && ws.path !== ws.localPath ? e('p', { className: 'dss-desc' }, '项目登记位置：' + ws.path) : null,
            e(
              'div',
              { className: 'dss-workspace-location-buttons' },
              e(
                'button',
                {
                  type: 'button',
                  className: 'dss-pill',
                  disabled: busy || pending || !value.trim() || value === ws.localPath,
                  onClick: async () => {
                    if (busy || savingRef.current) return;
                    savingRef.current = true;
                    setPending(true);
                    setMessage('');
                    try {
                      const data = await API.dataRepair('workspace-path', {
                        workspaceId: ws.id,
                        localPath: value.trim(),
                      });
                      if (!data.ok) throw new Error(data.error);
                      const localPath = data.localPath || value.trim();
                      setWorkspaces(previous => previous.map(item => (item.id === ws.id ? { ...item, localPath } : item)));
                      setPaths(previous => ({ ...previous, [ws.id]: localPath }));
                      setEditing('');
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
              ws.localPath
                ? pill(
                    '取消',
                    () => {
                      setEditing('');
                      setPaths({});
                      setMessage('');
                    },
                    { disabled: busy || pending },
                  )
                : null,
            ),
          );
        }),
        message ? e('p', { role: 'status', className: 'dss-desc' }, message) : null,
        workspaces === null && !pending
          ? e('button', { type: 'button', className: 'dss-pill', onClick: load }, '重新读取')
          : null,
      );
      return e(
        'section',
        { className: 'dss-span-all dss-workspace-locations' + (setup ? ' dss-setup-workspace-locations' : '') },
        e('h3', { className: 'dss-subtitle', id: 'dss-workspace-locations-title' }, '项目文件保存位置（实验性）'),
        fields,
      );
    }

    function syncScopeChoices(config) {
      return [
        {
          key: 'sessions',
          label: '会话',
          checked: config.contentScope?.sessions !== false,
          description: '对话记录与项目分组',
        },
        {
          key: 'attachments',
          label: '聊天附件',
          checked: config.contentScope?.attachments !== false,
          description: '上传到对话的图片、文件',
        },
        {
          key: 'settings',
          label: '设置',
          checked: config.contentScope?.settings !== false,
          description: '模型、界面与插件偏好',
        },
        {
          key: 'syncInstructions',
          label: '指令与技能（实验性）',
          checked: config.syncInstructions === true,
          description: 'AGENTS.md 与 skills 文件夹',
        },
        {
          key: 'workspaceSync',
          label: '项目文件',
          checked: config.workspaceSync !== false,
          description: '项目文件夹中的文件',
        },
      ];
    }

    const EMPTY_SETUP_SCOPE = {
      contentScope: { sessions: false, attachments: false, settings: false },
      syncInstructions: false,
      workspaceSync: false,
    };
    function SyncPreferences({
      lastSyncAt,
      busy,
      onSaved,
      onChanged,
      onSavingChange,
      setup = false,
      setupScope = EMPTY_SETUP_SCOPE,
      onScopeChange,
    }) {
      const [projectLocationsPending, setProjectLocationsPending] = useState(true);
      const [config, setConfig] = useState(null);
      const [error, setError] = useState('');
      const [message, setMessage] = useState('');
      const [saving, setSaving] = useState(false);
      const [attempt, setAttempt] = useState(0);
      const [uncertain, setUncertain] = useState(false);
      const [saveFailed, setSaveFailed] = useState(false);
      const savingRef = useRef(false);
      const confirmed = useRef(null);
      const automatic = config?.automatic ?? config?.enabled !== false;
      const accept = actual => {
        acceptPreferences({ ok: true, config: actual });
        confirmed.current = actual;
        setConfig(actual);
        setUncertain(false);
        setSaveFailed(false);
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
          if (overridden) setMessage('受宿主配置限制，已显示实际值');
          onChanged?.();
          return !overridden;
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
          setSaveFailed(true);
          onChanged?.();
          return false;
        } finally {
          savingRef.current = false;
          setSaving(false);
          onSavingChange?.(false);
        }
      };
      const choices = config ? syncScopeChoices(setup ? { ...config, ...setupScope } : config) : [];
      const projectsSelected = choices.some(choice => choice.key === 'workspaceSync' && choice.checked);
      const setChoice = (key, checked) => {
        if (setup && key === 'workspaceSync' && checked) setProjectLocationsPending(true);
        const scope = setup ? setupScope : confirmed.current;
        const patch =
          key === 'workspaceSync' || key === 'syncInstructions'
            ? { [key]: checked }
            : {
                contentScope: { sessions: true, attachments: true, settings: true, ...scope.contentScope, [key]: checked },
              };
        return setup ? onScopeChange?.({ ...scope, ...patch }) : save(patch);
      };
      return e(
        'div',
        { className: 'dss-sec dss-setting-card', id: 'dss-scope', tabIndex: -1 },
        setup ? stepHeading(2, '选择同步内容') : e('h2', { className: 'dss-section-title' }, '同步设置'),
        !config && !error ? e('div', { className: 'dss-desc' }, '正在读取偏好…') : null,
        error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null,
        (!config && error) || uncertain || (setup && saveFailed)
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
              choices.map(({ key, label, description, checked }) =>
                e(
                  'label',
                  { key, className: 'dss-check' },
                  e('input', {
                    type: 'checkbox',
                    'aria-label': key === 'syncInstructions' ? '指令与技能' : label,
                    checked,
                    'aria-describedby': key === 'workspaceSync' && checked ? 'dss-workspace-locations-title' : undefined,
                    onChange: event => setChoice(key, event.target.checked),
                  }),
                  e('span', { className: 'dss-choice' }, label, e('small', null, description)),
                ),
              ),
              projectsSelected
                ? e(WorkspaceLocations, {
                    busy: busy || saving || uncertain,
                    setup,
                    lastSyncAt,
                    onPendingChange: setup ? setProjectLocationsPending : undefined,
                  })
                : null,
              e(
                'div',
                { className: 'dss-rowline dss-subsection-heading dss-span-all' },
                e('div', { className: 'dss-rowtext' }, e('h4', { className: 'dss-subtitle' }, '自动同步（实验性）')),
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
              !automatic ? e('div', { className: 'dss-desc dss-span-all' }, '自动操作已暂停，仍可手动同步') : null,
              e(
                'div',
                { className: 'dss-auto-options dss-span-all' },
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
                  e('span', { className: 'dss-choice' }, '退出时自动同步'),
                ),
              ),
              setup
                ? e(
                    'button',
                    {
                      type: 'button',
                      className: 'dss-pill dss-primary',
                      disabled:
                        saveFailed ||
                        !choices.some(choice => choice.checked) ||
                        (projectsSelected && projectLocationsPending),
                      style: { marginTop: '12px' },
                      'data-continue': 'true',
                      onClick: async () => {
                        if (
                          !choices.some(choice => choice.checked) ||
                          saveFailed ||
                          (projectsSelected && projectLocationsPending)
                        )
                          return;
                        if (await save(setupScope)) onSaved?.(confirmed.current);
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

    function isRecoveryJson(text) {
      try {
        JSON.parse(text);
        return true;
      } catch {
        return false;
      }
    }

    function withoutJsonWhitespace(text) {
      return text.replace(/"(?:[^"\\]|\\.)*"|[ \t\r\n]+/g, token => (token[0] === '"' ? token : ''));
    }

    function recoveryRows(left, right, ignoreWhitespace = false) {
      const lines = text => (text ? text.split(/\r?\n/) : []);
      const leftLines = lines(left),
        rightLines = lines(right);
      const documents = ignoreWhitespace && isRecoveryJson(left) && isRecoveryJson(right);
      const keys = original => {
        if (!ignoreWhitespace) return original;
        return original.map(line => {
          if (!line.trim()) return null;
          // Compare lexemes without reserializing values or changing original line numbers.
          return documents || isRecoveryJson(line) ? withoutJsonWhitespace(line) : line;
        });
      };
      const a = keys(leftLines),
        b = keys(rightLines);
      const reflowed = documents && withoutJsonWhitespace(left) === withoutJsonWhitespace(right);
      const comparison = alignRecoveryRows(a, b);
      return {
        ...comparison,
        rows: comparison.rows.map(([i, j, different]) => [
          leftLines[i],
          rightLines[j],
          i == null ? null : i + 1,
          j == null ? null : j + 1,
          different && !reflowed,
        ]),
      };
    }

    function alignRecoveryRows(a, b) {
      const indices = keys => keys.flatMap((key, i) => (key === null ? [] : [i]));
      const left = indices(a),
        right = indices(b);
      const shared = Math.min(left.length, right.length);
      let prefix = 0,
        suffix = 0;
      while (prefix < shared && a[left[prefix]] === b[right[prefix]]) prefix++;
      while (prefix + suffix < shared && a[left[left.length - 1 - suffix]] === b[right[right.length - 1 - suffix]])
        suffix++;
      const x = left.slice(prefix, left.length - suffix),
        y = right.slice(prefix, right.length - suffix);
      // Bound memory and work for large logs; never present positional rows as an exact diff.
      const length = Math.max(a.length, b.length);
      if (length > 3000 || (x.length + 1) * (y.length + 1) > 400000) {
        return {
          limited: true,
          clipped: length > 3000,
          rows: Array.from({ length: Math.min(3000, length) }, (_, i) => [
            i < a.length ? i : null,
            i < b.length ? i : null,
            false,
          ]),
        };
      }
      const table = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
      for (let i = x.length - 1; i >= 0; i--)
        for (let j = y.length - 1; j >= 0; j--)
          table[i][j] = a[x[i]] === b[y[j]] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      const rows = [];
      let ai = 0,
        bi = 0;
      const add = (i, j, different) => {
        while (a[ai] === null || b[bi] === null)
          rows.push([a[ai] === null ? ai++ : null, b[bi] === null ? bi++ : null, false]);
        if (i != null) ai = i + 1;
        if (j != null) bi = j + 1;
        if (i != null || j != null) rows.push([i, j, different]);
      };
      for (let i = 0; i < prefix; i++) add(left[i], right[i], false);
      let i = 0,
        j = 0;
      while (i < x.length || j < y.length) {
        if (i < x.length && j < y.length && a[x[i]] === b[y[j]]) {
          add(x[i++], y[j++], false);
        } else if (i < x.length && (j === y.length || table[i + 1][j] >= table[i][j + 1])) {
          add(x[i++], null, true);
        } else {
          add(null, y[j++], true);
        }
      }
      for (let i = suffix; i > 0; i--) add(left[left.length - i], right[right.length - i], false);
      add(null, null, false);
      // Keep equal rows and real blank lines as anchors. Pair opposing edits
      // within each block so replacements can be read side by side.
      const aligned = [];
      let local = [],
        remote = [];
      const flush = () => {
        for (let index = 0; index < Math.max(local.length, remote.length); index++)
          aligned.push([local[index] ?? null, remote[index] ?? null, true]);
        local = [];
        remote = [];
      };
      for (const [i, j, changed] of rows) {
        if (changed) {
          if (i != null) local.push(i);
          if (j != null) remote.push(j);
        } else {
          flush();
          aligned.push([i, j, false]);
        }
      }
      flush();
      return { limited: false, rows: aligned };
    }
    /* ---------- 设置分节:网络连接(Git 走哪个代理 + 仓库连通测试;直连时给出可复制的代理命令) ---------- */
    const PROXY_SOURCES = { 'git-config': 'Git 代理', manual: '插件代理', env: '环境变量代理', system: '系统代理' };
    /* 本机代理只显示端口,其他主机显示 主机:端口 */
    function proxyShort(url) {
      try {
        const u = new URL(url);
        return (/^(?:127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname) ? '' : u.hostname) + ':' + u.port;
      } catch {
        return url;
      }
    }
    function CopyCommand({ label, command }) {
      const [state, setState] = useState('');
      const copy = async () => {
        try {
          await window.navigator.clipboard.writeText(command);
          setState('已复制');
        } catch {
          setState('请手动复制');
        }
      };
      return e(
        'div',
        { className: 'dss-net-command' },
        e('span', { className: 'dss-net-label' }, label),
        e('code', null, command),
        e('button', { type: 'button', className: 'dss-pill', onClick: copy }, state || '复制'),
      );
    }
    function NetworkStatus({ busy, remote, candidate }) {
      const [data, setData] = useState(null);
      const [checking, setChecking] = useState(false);
      const [attempt, setAttempt] = useState(0);
      const [showDetails, setShowDetails] = useState(true);
      const pendingRemote = candidate?.remote && candidate.remote !== remote ? candidate.remote : null;
      useEffect(() => {
        let alive = true;
        const provider = candidate?.config?.remoteWeb?.label;
        if (pendingRemote && !attempt) {
          setData({ ok: true, candidate: true, provider });
          setChecking(false);
          return;
        }
        setChecking(true);
        const request = pendingRemote
          ? API.saveConnection({
              remote: pendingRemote,
              expectedRemote: candidate.expectedRemote,
              expectedBranch: candidate.expectedBranch,
              expectedAutoRepo: candidate.expectedAutoRepo,
              validateOnly: true,
            }).then(answer => ({ ok: answer.ok, candidate: true, provider, error: answer.error }))
          : API.network();
        request
          .then(d => alive && setData(d))
          .catch(err => alive && setData({ ok: false, error: err.message || String(err) }))
          .finally(() => alive && setChecking(false));
        return () => {
          alive = false;
        };
      }, [attempt, remote, candidate, pendingRemote]);
      const ok = Boolean(data?.ok);
      const probe = ok ? data.probe : null;
      const route = !data
        ? '检测中…'
        : !ok
          ? '无法检测：' + (data.error || '未知原因')
          : data.candidate
            ? data.provider
            : data.route === 'proxy'
              ? (PROXY_SOURCES[data.source] || '代理') + ' ' + proxyShort(data.proxy)
              : data.route === 'ssh'
                ? 'SSH'
                : '直连';
      const result =
        ok && data.candidate ? '仓库已验证' : !probe ? '' : probe.ok ? probe.ms + ' ms' : '连接失败 · ' + probe.title;
      const commands = ok && data.commands;
      const hasDetails = Boolean(commands || (probe && !probe.ok));
      return e(
        'div',
        { className: 'dss-net' },
        e(
          'div',
          { className: 'dss-net-row' },
          e(
            'button',
            {
              type: 'button',
              className: 'dss-net-trigger',
              title: '重新检测网络',
              'aria-label': ['网络', checking ? '检测中' : route, !checking && result, '重新检测']
                .filter(Boolean)
                .join('，'),
              disabled: checking || busy,
              onClick: () => {
                setShowDetails(true);
                setAttempt(n => n + 1);
              },
            },
            e('span', { className: 'dss-net-dot', 'data-route': ok ? data.route : 'unknown', 'aria-hidden': true }),
            e(
              'span',
              { className: 'dss-net-text' },
              e('span', null, '网络'),
              e('b', null, checking ? '检测中…' : route),
              !checking && result
                ? e('span', { className: probe?.ok || data?.candidate ? 'dss-desc' : 'dss-err' }, result)
                : null,
            ),
          ),
          hasDetails
            ? e(
                'button',
                {
                  className: 'dss-link',
                  type: 'button',
                  'aria-expanded': showDetails,
                  'aria-label': showDetails ? '收起网络排查' : '展开网络排查',
                  onClick: () => setShowDetails(value => !value),
                },
                e('span', { 'aria-hidden': true }, showDetails ? '▾' : '▸'),
              )
            : null,
        ),
        hasDetails && showDetails
          ? e(
              'div',
              { className: 'dss-net-detail' },
              probe && !probe.ok ? e('div', { className: 'dss-err' }, probe.reason + '。' + probe.action) : null,
              commands ? e(CopyCommand, { label: '设置', command: commands.set }) : null,
              commands ? e(CopyCommand, { label: '撤销', command: commands.unset }) : null,
              commands?.placeholder ? e('div', { className: 'dss-desc' }, '「端口号」换成代理软件的端口') : null,
            )
          : null,
      );
    }
    // Use the host's own Markdown primitive when available, including code/list rendering.
    let recoveryUi = {};
    try {
      recoveryUi = require('@deepseek-ai/dsh-client-ui-primitives');
    } catch {
      /* older hosts keep readable text */
    }
    const recoveryMarkdownLabels = {
      code: {
        copyLabel: '复制',
        copiedLabel: '已复制',
        toolbarLabels: { codeLabel: '代码', wrapLabel: '自动换行', unwrapLabel: '取消换行' },
      },
      footnotes: '脚注',
    };
    function RecoveryMarkdown({ text }) {
      if (recoveryUi.MarkdownText)
        return e(recoveryUi.MarkdownText, { text, streaming: false, labels: recoveryMarkdownLabels });
      return e('div', { className: 'dss-readable-text' }, text);
    }

    function recoveryMessage(message, difference, key) {
      return e(
        'article',
        {
          key,
          className:
            'dss-message dss-message-' +
            message.role +
            (difference ? ' dss-message-different dss-message-diff-' + difference : ''),
          'aria-label': (message.role === 'user' ? '用户消息' : '助手回复') + (difference ? '（与另一版本不同）' : ''),
        },
        e(
          'div',
          { className: 'dss-message-body' },
          message.content.map((part, i) =>
            part.type === 'text'
              ? message.role === 'assistant'
                ? e(RecoveryMarkdown, { key: i, text: part.text })
                : e('div', { key: i, className: 'dss-readable-text' }, part.text)
              : e(
                  'div',
                  { key: i, className: 'dss-file-preview' },
                  e('span', { 'aria-hidden': true }, '▧'),
                  e('span', null, part.name),
                  part.bytes ? e('small', null, fmtBytes(part.bytes)) : null,
                ),
          ),
        ),
      );
    }

    function RecoveryReadableVersion({ value, onMore, loading }) {
      const presentation = value.presentation;
      if (value.missing || presentation?.kind === 'missing') return e('p', { className: 'dss-desc' }, '此版本没有文件');
      if (!presentation)
        return e('div', { className: 'dss-readable-text' }, value.text || value.hint || '此文件暂不支持预览');
      if (presentation.kind === 'conversation')
        return e(
          'div',
          { className: 'dss-transcript', 'aria-label': '会话预览' },
          presentation.messages.map((message, index) => recoveryMessage(message, false, message.id + ':' + index)),
          !presentation.total ? e('p', { className: 'dss-desc' }, '这份记录中没有用户消息或助手回复。') : null,
          presentation.incomplete ? e('p', { className: 'dss-err' }, '部分记录无法读取，预览不完整。') : null,
          presentation.hasMore
            ? e(
                'button',
                { type: 'button', className: 'dss-pill', disabled: loading, onClick: onMore },
                loading ? '正在读取…' : '继续显示对话',
              )
            : null,
        );
      if (presentation.kind === 'fields')
        return e(
          'div',
          { className: 'dss-readable-fields' },
          presentation.note ? e('p', { className: 'dss-desc' }, presentation.note) : null,
          e(
            'dl',
            null,
            presentation.fields.map((field, i) =>
              e('div', { key: i, className: 'dss-readable-field' }, e('dt', null, field.name), e('dd', null, field.value)),
            ),
          ),
        );
      if (presentation.kind === 'projects')
        return e(
          'div',
          { className: 'dss-readable-projects' },
          presentation.projects.map(project =>
            e(
              'article',
              { key: project.id },
              e('strong', null, project.title),
              e('div', null, project.location),
              e('div', { className: 'dss-desc' }, project.sessions + ' 个会话'),
            ),
          ),
          e('p', { className: 'dss-desc' }, '已归档 ' + presentation.archived + ' 个会话'),
        );
      if (presentation.kind === 'image')
        return e(
          'figure',
          { className: 'dss-readable-image' },
          e('img', { src: presentation.url, alt: presentation.name }),
          e('figcaption', null, presentation.name),
        );
      if (presentation.kind === 'file')
        return e(
          'div',
          { className: 'dss-file-preview' },
          e('span', { 'aria-hidden': true }, '▧'),
          e('strong', null, presentation.name),
          e('span', null, fmtBytes(presentation.bytes)),
          presentation.note ? e('p', { className: 'dss-desc' }, presentation.note) : null,
        );
      return e(
        'div',
        null,
        presentation.kind === 'markdown'
          ? e(RecoveryMarkdown, { text: presentation.text })
          : e('pre', { className: 'dss-readable-text' }, presentation.text),
        presentation.truncated ? e('p', { className: 'dss-desc' }, '文件较长，预览仅显示部分内容。') : null,
      );
    }

    function RecoveryTranscriptComparison({ local, remote, headings, onMore, loading }) {
      const key = message => JSON.stringify([message.role, message.content]);
      const comparison = useMemo(
        () => alignRecoveryRows(local.messages.map(key), remote.messages.map(key)),
        [local.messages, remote.messages],
      );
      const hasMore = local.hasMore || remote.hasMore;
      const incomplete = local.incomplete || remote.incomplete;
      const rows = comparison.rows;
      // While paging, only compare through the last pair seen on both sides.
      // An apparent insertion after it may match a message on the next page.
      const lastMatch = hasMore
        ? rows.findLastIndex(([i, j, changed]) => !changed && i != null && j != null)
        : rows.length - 1;
      return e(
        'div',
        { className: 'dss-transcript-comparison' },
        e(
          'div',
          { className: 'dss-transcript-headings' },
          headings.map((label, i) => e('div', { key: i, className: 'dss-readable-heading' }, label)),
        ),
        comparison.limited || incomplete
          ? e(
              'div',
              { role: 'status' },
              comparison.limited
                ? '对话较长，仅按顺序显示。请在原始记录中查看差异。'
                : '部分消息无法读取，差异可能不完整。',
            )
          : null,
        e(
          'div',
          { className: 'dss-transcript-scroll', tabIndex: 0, 'aria-label': '本机与云端会话同步滚动比较' },
          e(
            'div',
            { className: 'dss-transcript-grid' },
            rows.flatMap(([i, j, changed], row) =>
              [i, j].map((index, side) => {
                const version = side ? remote : local;
                const difference = changed && row <= lastMatch && !incomplete && (side ? 'add' : 'remove');
                return e(
                  'div',
                  { key: row + ':' + side, className: 'dss-transcript-cell' },
                  index == null ? null : recoveryMessage(version.messages[index], difference),
                );
              }),
            ),
          ),
          !rows.length && !hasMore ? e('p', null, '没有可预览的用户消息或助手回复。') : null,
          hasMore && !comparison.clipped
            ? pill(loading ? '正在读取…' : '继续显示对话', () => onMore(), { disabled: loading })
            : null,
        ),
      );
    }

    function RecoveryReadableComparison({ preview, record, onMore, loading, headings = ['本机版本', '云端版本'] }) {
      const single =
        record?.reason === 'local-project-unavailable' &&
        record.versions?.local?.sha256 &&
        record.versions.local.sha256 === record.versions?.remote?.sha256;
      const local = preview.local.presentation,
        remote = preview.remote.presentation;
      if (!single && local?.kind === 'conversation' && remote?.kind === 'conversation')
        return e(RecoveryTranscriptComparison, { local, remote, headings, onMore, loading });
      return e(
        'div',
        { className: 'dss-readable-comparison', style: single ? { gridTemplateColumns: 'minmax(0,1fr)' } : undefined },
        (single ? ['local'] : ['local', 'remote']).map(side =>
          e(
            'section',
            { key: side, className: 'dss-readable-side' },
            e('div', { className: 'dss-readable-heading' }, single ? '迁移前的会话' : headings[side === 'local' ? 0 : 1]),
            e(
              'div',
              { className: 'dss-readable-scroll', tabIndex: 0 },
              e(RecoveryReadableVersion, { value: preview[side], onMore: () => onMore?.(side), loading }),
            ),
          ),
        ),
      );
    }
    function RecoveryComparison({ preview, record, headings = ['本机版本', '云端版本'] }) {
      const single =
        record?.reason === 'local-project-unavailable' &&
        preview.local.sha256 &&
        preview.local.sha256 === preview.remote.sha256;
      const panes = useRef([]),
        [active, setActive] = useState(-1),
        [ignoreWhitespace, setIgnoreWhitespace] = useState(true);
      const original = value => (value.missing ? '' : value.text || '');
      const textual = !preview.local.binary && !preview.remote.binary;
      const comparison = useMemo(
        () =>
          textual
            ? recoveryRows(original(preview.local), original(preview.remote), ignoreWhitespace)
            : { rows: [], limited: false },
        [preview, ignoreWhitespace],
      );
      const changes = comparison.rows.flatMap((row, i) => (row[4] ? [i] : []));
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
                  ? '已加载内容中有 ' + changes.length + ' 处差异'
                  : !!preview.local.missing !== !!preview.remote.missing
                    ? '一侧不存在文件；请结合原件状态查看'
                    : partial
                      ? '已加载部分相同；完整原件尚未比较'
                      : original(preview.local) !== original(preview.remote)
                        ? '仅空行或排版空白不同'
                        : single
                          ? '保存的会话原件'
                          : '两边内容相同',
          ),
          textual
            ? e(
                'label',
                { className: 'dss-check' },
                e('input', {
                  type: 'checkbox',
                  checked: ignoreWhitespace,
                  onChange: ev => {
                    setIgnoreWhitespace(ev.target.checked);
                    setActive(-1);
                  },
                }),
                '忽略空行和 JSON 排版空白',
              )
            : null,
          changes.length
            ? e(
                'div',
                { className: 'dss-diff-actions' },
                e('button', { type: 'button', className: 'dss-pill', onClick: () => jump(-1) }, '上一处差异'),
                e('button', { type: 'button', className: 'dss-pill', onClick: () => jump(1) }, '下一处差异'),
              )
            : null,
        ),
        comparison.limited ? e('div', { className: 'dss-tip', role: 'status' }, '大文件仅按行号展示，未计算差异。') : null,
        partial ? e('div', { className: 'dss-tip', role: 'status' }, '预览已截断，仅显示部分内容。') : null,
        e(
          'div',
          {
            className: 'dss-diff-grid',
            'aria-label': single ? '迁移前的会话原件' : '双方原件同步滚动比较',
            style: single ? { gridTemplateColumns: 'minmax(0,1fr)' } : undefined,
          },
          (single ? [0] : [0, 1]).map(side => {
            const value = side ? preview.remote : preview.local;
            return e(
              'section',
              { key: side, className: 'dss-diff-side' },
              e(
                'div',
                { className: 'dss-diff-title' },
                single ? '迁移前的会话' : headings[side],
                value.missing ? ' · 此版本没有文件' : '',
              ),
              e(
                'div',
                {
                  className: 'dss-diff-pane',
                  tabIndex: 0,
                  'aria-label': side ? '云端原件内容' : '本机原件内容',
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
                        const changed = row[4] && row[side] !== undefined;
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

    function RecoveryDialog({ record, preview, onClose, onMore, loading, headings, locked, page, children }) {
      const [raw, setRaw] = useState(false);
      const { name, location } = recoveryFileInfo(record);
      const project = preview.sessionImport?.sourceProject;
      const note = record.sessionConflict ? (project ? '项目「' + project.title + '」' : null) : location;
      const tools = e(
        'div',
        { className: 'dss-diff-actions' },
        pill(raw ? (preview.local.presentation?.kind === 'conversation' ? '会话预览' : '返回预览') : '原始记录', () =>
          setRaw(value => !value),
        ),
        pill(page ? '返回同步' : '关闭', onClose, { disabled: locked }),
      );
      const comparison = raw
        ? e(RecoveryComparison, { preview, record, headings })
        : e(RecoveryReadableComparison, { preview, record, onMore, loading, headings });
      const footer = e('footer', { className: 'dss-diff-footer' }, children);
      if (page)
        return e(
          'section',
          { className: 'dss-recovery-dialog dss-conflict-comparison', 'aria-label': name },
          e(
            'header',
            { className: 'dss-page-heading dss-conflict-heading' },
            e('div', null, e('h1', null, name), note ? e('p', { className: 'dss-desc' }, note) : null),
            tools,
          ),
          comparison,
          footer,
        );
      return e(Modal, { title: name, note, onClose, comparison: true, tools }, comparison, footer);
    }

    function RecoveryItem({
      readOnly = false,
      page = false,
      record,
      busy,
      onRestored,
      initiallyOpen = false,
      onPreviewClosed,
      onPreviewFailed,
    }) {
      const opener = useRef(null);
      const [preview, setPreview] = useState(null);
      const [workspaceId, setWorkspaceId] = useState('');
      const [message, setMessage] = useState('');
      const [loading, setLoading] = useState(false);
      const writing = useRef(false);
      const changed = useRef(false);
      const [saved, setSaved] = useState({});
      const [archived, setArchived] = useState(null);
      const [completed, setCompleted] = useState(false);
      const more = async side => {
        if (!preview || loading) return;
        const sides = side ? [side] : ['local', 'remote'].filter(key => preview[key].presentation?.hasMore);
        if (!sides.length) return;
        setLoading(true);
        try {
          const result = await API.recoveryPreview(
            record.id,
            Object.fromEntries(sides.map(key => [key, preview[key].presentation.nextOffset])),
          );
          if (!result.ok) throw new Error(result.error);
          const expanded = { ...preview };
          for (const key of sides) {
            if (result[key].sha256 !== preview[key].sha256) throw new Error('原件已变化，请重新打开');
            const next = result[key].presentation;
            if (next?.kind !== 'conversation') throw new Error('暂时无法继续读取对话');
            expanded[key] = {
              ...result[key],
              presentation: { ...next, messages: [...preview[key].presentation.messages, ...next.messages] },
            };
          }
          setPreview(expanded);
        } catch (err) {
          setMessage(err.message || String(err));
        } finally {
          setLoading(false);
        }
      };
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
          const projects = d.sessionImport?.workspaces || [];
          const pending = Object.values(d.record?.imports || {}).find(attempt => attempt.status !== 'verified');
          const original = projects.find(project => project.id === d.sessionImport?.sourceProject?.id);
          setWorkspaceId(pending?.workspaceId || original?.id || (projects.length === 1 ? projects[0].id : ''));
          setArchived(null);
          setSaved({});
          setCompleted(Boolean(record.conflictComplete));
          changed.current = false;
          setPreview(d);
        } catch (err) {
          setMessage(err.message || String(err));
          onPreviewFailed?.(err.message || String(err));
        } finally {
          setLoading(false);
        }
      };
      useEffect(() => {
        if (initiallyOpen) show();
      }, [initiallyOpen]);
      const restore = async side => {
        if (!preview || loading || busy) return;
        if (
          !window.confirm(
            '将项目文件「' +
              record.path +
              '」恢复为' +
              (side === 'remote' ? '云端' : '当时本机') +
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
      const currentVersions = preview?.branches?.currentVersions;
      const sourceProject = preview?.sessionImport?.sourceProject;
      const originalAvailable = preview?.sessionImport?.workspaces.some(ws => ws.id === sourceProject?.id);
      const hasCurrentVersion = Boolean(currentVersions?.local || currentVersions?.remote);
      const history = archived ?? record.category === 'history';
      const actionsFinished = completed || (record.sessionConflict && archived === true);
      const headings = record.conflictResolution
        ? ['local', 'remote'].map(side => (record.conflictResolution.kept === side ? '保留的版本' : '舍弃的版本'))
        : ['本机版本', '云端版本'];
      const currentSide =
        currentVersions?.local === true && currentVersions.remote !== true
          ? 'local'
          : currentVersions?.remote === true && currentVersions.local !== true
            ? 'remote'
            : null;
      const keepCurrent = async () => {
        if (!currentSide || writing.current || completed) return;
        writing.current = true;
        setLoading(true);
        setMessage('');
        try {
          const data = await API.recoveryKeepCurrent(record, currentSide);
          if (!data.ok) throw new Error(data.error);
          setCompleted(true);
          setMessage('已保留' + (currentSide === 'local' ? '本机版本' : '云端版本') + '。另一版本已存入历史冲突会话备份。');
          changed.current = true;
          if (onPreviewClosed) onRestored?.();
        } catch (error) {
          setMessage(error.message || String(error));
        } finally {
          writing.current = false;
          setLoading(false);
        }
      };
      const sideView = (side, title) => {
        const value = preview[side];
        if (value.missing) return null;
        if (preview.canRestore)
          return pill('恢复' + title, () => restore(side), { disabled: busy || loading, kind: 'primary' });
        const attempt = preview.record?.imports?.[side] || record.imports?.[side];
        if (!preview.sessionImport?.available) return null;
        if (
          record.sessionConflict &&
          (!originalAvailable ||
            (attempt ? attempt.workspaceId !== sourceProject.id : !hasCurrentVersion || currentVersions[side]))
        )
          return null;
        const imported = saved[side] || attempt?.status === 'verified';
        if (record.conflictComplete || (imported && !completed)) return null;
        return pill(
          record.sessionConflict
            ? '保留两个版本'
            : '另存' + (title === '迁移前会话' ? title : side === 'remote' ? '云端会话' : '本机会话'),
          async () => {
            if (writing.current || imported || completed) return;
            writing.current = true;
            setLoading(true);
            setMessage('');
            try {
              const project = record.sessionConflict
                ? sourceProject
                : preview.sessionImport.workspaces.find(ws => ws.id === workspaceId);
              const d = await API.recoveryImport(
                record.id,
                side,
                record.versions[side].sha256,
                project.id,
                record.sessionConflict,
              );
              if (!d.ok) throw new Error(d.error);
              setSaved(previous => ({ ...previous, [side]: true }));
              setCompleted(Boolean(d.conflictComplete));
              const version = record.sessionConflict ? '另一版本' : title === '迁移前会话' ? '迁移前版本' : title;
              setMessage(
                record.sessionConflict
                  ? '项目「' +
                      (d.projectTitle || project.title) +
                      '」中已保留' +
                      recoveryFileInfo(record).name +
                      '的两个版本。' +
                      (d.restartRequired ? '刷新会话列表或重新打开 DSH 后查看。' : '')
                  : '已将' +
                      recoveryFileInfo(record).name +
                      '的' +
                      version +
                      '另存到项目「' +
                      (d.projectTitle || project.title) +
                      '」。' +
                      (d.restartRequired ? '刷新会话列表或重新打开 DSH 后查看。' : ''),
              );
              changed.current = true;
              if (onPreviewClosed) onRestored?.();
            } catch (err) {
              setMessage(err.message || String(err));
            } finally {
              writing.current = false;
              setLoading(false);
            }
          },
          {
            disabled:
              busy ||
              loading ||
              imported ||
              completed ||
              (!record.sessionConflict &&
                (Boolean(attempt && attempt.workspaceId !== workspaceId) ||
                  !preview.sessionImport.workspaces.some(ws => ws.id === workspaceId))),
            kind: record.sessionConflict ? undefined : 'primary',
          },
        );
      };
      const content = [
        e(
          'div',
          { className: 'dss-recovery-file' },
          e('div', { className: 'dss-h' }, recoveryFileInfo(record).name),
          recoveryFileInfo(record).location
            ? e('div', { className: 'dss-desc dss-recovery-path' }, recoveryFileInfo(record).location)
            : null,
          e(
            'div',
            { className: 'dss-desc' },
            new Date(record.createdAt).toLocaleString() +
              ' · ' +
              (record.reason === 'local-project-unavailable'
                ? record.relocation?.archivedSource &&
                  Object.values(record.imports || {}).every(attempt => attempt.status === 'verified')
                  ? '已迁移的会话原件'
                  : '迁移前的会话原件'
                : record.kind === 'restore-backup'
                  ? '恢复前备份'
                  : record.kind === 'settings-version-reset'
                    ? '清除版本记录前（DSH ' + record.otherVersion + '）'
                    : record.sessionConflict
                      ? '会话同步冲突'
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
                                ? '已采用云端版本'
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
      ];
      const localAction =
        preview && sideView('local', record.reason === 'local-project-unavailable' ? '迁移前会话' : '本机版本');
      const remoteAction =
        preview && !(preview.local.sha256 && preview.local.sha256 === preview.remote.sha256)
          ? sideView('remote', '云端版本')
          : null;
      const keepAction =
        record.sessionConflict &&
        currentSide &&
        !actionsFinished &&
        !record.conflictComplete &&
        !Object.keys(preview?.record?.imports || record.imports || {}).length
          ? pill('仅保留' + (currentSide === 'local' ? '本机版本' : '云端版本'), keepCurrent, {
              disabled: busy || loading,
            })
          : null;
      const sideActions =
        page && record.sessionConflict
          ? [localAction, remoteAction].map((action, index) => {
              const side = index === 0 ? 'local' : 'remote';
              return e(
                'div',
                { key: side, className: 'dss-conflict-action-side', 'data-side': side },
                currentSide === side && keepAction ? keepAction : action,
              );
            })
          : [localAction, remoteAction, keepAction];
      const archiveAvailable =
        !record.conflictComplete &&
        !record.sessionConflict &&
        (record.canArchive || ['merged', 'applied', 'repaired', 'restored'].includes(record.status)) &&
        !Object.entries(preview?.record?.imports || record.imports || {}).some(
          ([side, attempt]) => attempt.status !== 'verified' && !saved[side],
        );
      const importHint = !preview?.sessionImport?.available
        ? preview?.sessionImport?.hint
        : !originalAvailable
          ? '原项目在本机不可用，已保留两份记录。'
          : !hasCurrentVersion
            ? '无法确认哪份记录对应当前会话，已保留两份记录。'
            : '';
      const comparison = preview
        ? e(
            RecoveryDialog,
            {
              record,
              preview,
              page,
              onMore: more,
              loading,
              headings,
              locked: writing.current,
              onClose: () => {
                if (writing.current) return;
                setPreview(null);
                if (changed.current && !onPreviewClosed) onRestored?.();
                onPreviewClosed?.();
                opener.current?.focus();
              },
            },
            e(
              'div',
              {
                className: 'dss-recovery-actions' + (record.sessionConflict ? ' dss-conflict-actions' : ''),
                hidden: readOnly || record.conflictComplete,
                inert: actionsFinished || undefined,
                'aria-hidden': actionsFinished || undefined,
              },
              !preview.canRestore
                ? null
                : e(
                    'div',
                    { className: 'dss-tip' },
                    '当前文件：' +
                      (preview.currentHash === null
                        ? '本机当前不存在此文件'
                        : preview.currentHash === preview.local?.sha256
                          ? '与当时本机版本一致'
                          : preview.currentHash === preview.remote?.sha256
                            ? '与云端版本一致'
                            : '已有后续更改'),
                  ),
              !record.sessionConflict && !preview.canRestore && (localAction || remoteAction)
                ? e(
                    'label',
                    { className: 'dss-recovery-project' },
                    '保存到项目',
                    e(
                      'select',
                      {
                        className: 'dss-select',
                        value: workspaceId,
                        disabled: busy || loading,
                        onChange: ev => setWorkspaceId(ev.target.value),
                      },
                      e('option', { value: '' }, '请选择项目'),
                      preview.sessionImport.workspaces.map(ws =>
                        e('option', { key: ws.id, value: ws.id }, '项目「' + ws.title + '」'),
                      ),
                    ),
                  )
                : null,
              ...sideActions,
              archiveAvailable
                ? e(
                    'button',
                    {
                      type: 'button',
                      className: 'dss-pill dss-recovery-archive',
                      disabled: busy || loading,
                      onClick: async () => {
                        if (writing.current || completed) return;
                        writing.current = true;
                        setLoading(true);
                        setMessage('');
                        try {
                          const d = await API.recoveryArchive(record, !history);
                          if (!d.ok) throw new Error(d.error);
                          setArchived(!history);
                          setMessage(d.hint);
                          changed.current = true;
                          if (onPreviewClosed) onRestored?.();
                        } catch (err) {
                          setMessage(err.message || String(err));
                        } finally {
                          writing.current = false;
                          setLoading(false);
                        }
                      },
                    },
                    history ? '放回待查看' : '移入留存备份',
                  )
                : null,
            ),
            message
              ? e(
                  'div',
                  {
                    className: 'dss-recovery-feedback' + (actionsFinished ? ' dss-recovery-complete' : ''),
                    role: 'status',
                  },
                  message,
                )
              : null,
            !readOnly &&
              importHint &&
              record.sessionConflict &&
              !record.conflictComplete &&
              !actionsFinished &&
              !message &&
              !localAction &&
              !remoteAction
              ? e('div', { className: 'dss-recovery-feedback', role: 'status' }, importHint)
              : null,
          )
        : null;
      if (page && !comparison)
        return e(
          'section',
          null,
          e(
            'header',
            { className: 'dss-page-heading dss-conflict-heading' },
            e('h1', null, recoveryFileInfo(record).name),
            pill('返回同步', onPreviewClosed),
          ),
          message
            ? e('p', { role: 'alert', className: 'dss-err' }, message, ' ', pill('重新读取', show))
            : e('p', { role: 'status' }, '正在读取…'),
        );
      if (onPreviewClosed) return comparison || (loading ? e('p', { role: 'status' }, '正在读取…') : null);
      return e(
        'article',
        { className: 'dss-recovery-item' },
        ...content,
        comparison,
        message ? e('div', { className: 'dss-desc', role: 'status' }, message) : null,
      );
    }
    function DataHealth({ busy, initialIssueKey, expanded = false, onVerified, onGrouping, grouping = false }) {
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
          if (preview.relocation) setRepairWorkspace(preview.suggestedWorkspaceId || '');
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
                  className: 'dss-pill dss-primary',
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
                    {
                      type: 'button',
                      className: 'dss-pill',
                      onClick: onGrouping || (() => openRepairPage({ mode: 'grouping' })),
                    },
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
                      ? '原会话使用的目录：' +
                          preview.issue.cwd +
                          (preview.suggestedPath ? '；已匹配本机项目：' + preview.suggestedPath : '')
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
                        className: 'dss-pill dss-primary',
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
                      '在本机项目继续会话',
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
                      placeholder: '私有 Git 仓库地址；留空表示暂不连接',
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
                      className: 'dss-pill dss-primary',
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
              // Closing and reopening the app exists only on Windows Desktop. Everywhere else
              // the queued repair runs by itself once the person quits DSH.
              scan.closeAndRepair
                ? e(
                    'button',
                    {
                      type: 'button',
                      className: 'dss-pill dss-primary',
                      disabled: busy || pending,
                      onClick: async () => {
                        if (!window.confirm('现在关闭桌面应用，应用已确认的修复，再重新打开？请先结束当前对话。')) return;
                        const d = await perform(() => API.dataRepair('restart'));
                        if (d) setMessage(d.hint);
                      },
                    },
                    '关闭并修复（桌面端）',
                  )
                : null,
            )
          : null,
        message ? e('p', { role: 'status' }, message) : null,
      );
    }

    function GroupingRepairOverlay() {
      const [notice, setNotice] = useState(null),
        [error, setError] = useState('');
      const seen = useRef({ candidate: '', dismissed: '' });
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
            if (typeof document !== 'undefined' && document.querySelector('dialog[open]')) return;
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
      const dismiss = () => {
        seen.current.dismissed = notice.signature;
        setNotice(null);
      };
      if (!notice) return null;
      return e(
        'section',
        {
          className: 'dss-update dss-update-popup dss-grouping-notice',
          'aria-label': '未分组会话修复',
        },
        e('h2', { role: 'status' }, '发现 ' + notice.count + ' 个未分组会话'),
        error ? e('p', { className: 'dss-err', role: 'alert' }, error) : null,
        e(
          'div',
          { className: 'dss-diff-actions' },
          e(
            'button',
            {
              type: 'button',
              className: 'dss-pill',
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

    function SessionForkNotice({ count, onSelect }) {
      const [open, setOpen] = useState(true);
      const [view, setView] = useState(null);
      const request = useRef(0);
      const previousCount = useRef(0);
      const load = async () => {
        const id = ++request.current;
        setView({ loading: true });
        try {
          const data = await API.recovery();
          if (!data.ok) throw new Error(data.error);
          const ids = new Set(data.pendingSessionForks?.map(fork => fork.id));
          const rows = data.records.filter(record => ids.has(record.id));
          if (id === request.current) setView({ rows });
        } catch (err) {
          if (id === request.current) setView({ error: err.message || String(err) });
        }
      };
      useEffect(() => {
        if (count > previousCount.current) setOpen(true);
        previousCount.current = count || 0;
      }, [count]);
      useEffect(() => {
        if (open && count) load();
        else setView(null);
        return () => {
          request.current++;
        };
      }, [count, open]);
      if (!count) return null;
      return e(
        'details',
        {
          className: 'dss-conflict-notice',
          'aria-label': '会话同步冲突',
          open,
          onToggle: event => setOpen(event.currentTarget.open),
        },
        e('summary', null, e('span', { role: 'status' }, count + '个冲突会话待处理')),
        view?.loading ? e('p', { role: 'status' }, '正在读取…') : null,
        view?.error ? e('div', { className: 'dss-err', role: 'alert' }, view.error, pill('重新读取', load)) : null,
        view?.rows?.length === 0 ? e('p', { role: 'status' }, '没有待处理的会话冲突') : null,
        view?.rows?.length
          ? e(
              'div',
              { className: 'dss-recovery-list' },
              view.rows.map(record =>
                e(
                  'div',
                  { key: record.id, className: 'dss-recovery-item' },
                  e('span', { className: 'dss-recovery-file' }, recoveryFileInfo(record).name),
                  e(
                    'button',
                    {
                      type: 'button',
                      className: 'dss-pill',
                      'aria-label': '查看冲突：' + recoveryFileInfo(record).name,
                      onClick: () => onSelect({ ...record, sessionConflict: true }),
                    },
                    '查看冲突',
                  ),
                ),
              ),
            )
          : null,
      );
    }

    function RecoveryCenter({ busy, lastSyncAt, revision, onChanged, embedded = false }) {
      const [records, setRecords] = useState(null);
      const [error, setError] = useState('');
      const [open, setOpen] = useState(embedded);

      const load = () =>
        API.recovery()
          .then(d => {
            if (!d.ok) throw new Error(d.error);
            setRecords(
              d.records.filter(
                record =>
                  !isSyncBackup(record) &&
                  (!record.sessionConflict || (record.category === 'history' && !record.conflictComplete)),
              ),
            );
            setError('');
          })
          .catch(err => setError(err.message || String(err)));
      useEffect(() => {
        load();
      }, [lastSyncAt, revision]);
      if (records?.length === 0 && !error) return embedded ? e('p', { role: 'status' }, '暂无恢复记录。') : null;
      const newest = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
      const history = (records?.filter(record => record.category === 'history') || []).sort(newest);
      const attention = (records?.filter(record => record.category !== 'history') || []).sort(newest);
      const status =
        records === null
          ? '正在读取…'
          : records.length + ' 条记录 · 待查看 ' + attention.length + ' 条 · 留存备份 ' + history.length + ' 条';
      const list = (title, rows) =>
        rows.length
          ? [
              e('h3', { key: title, className: 'dss-subtitle' }, title + '（' + rows.length + '）'),
              e(
                'div',
                { key: title + '-list', className: 'dss-recovery-list' },
                rows.map(record =>
                  e(RecoveryItem, {
                    key: record.id,
                    record,
                    busy,
                    onRestored: () => {
                      load();
                      onChanged?.();
                    },
                  }),
                ),
              ),
            ]
          : [];
      return e(
        'div',
        { className: 'dss-stack' },
        embedded ? null : e('h2', { className: 'dss-section-title' }, '找回同步前的内容（实验性）'),
        error
          ? e(
              'div',
              { className: 'dss-err', role: 'alert' },
              error,
              e('button', { type: 'button', className: 'dss-pill', onClick: load }, '重新读取'),
            )
          : e(
              'div',
              { className: 'dss-storage-head' },
              e('span', { className: 'dss-desc', role: 'status' }, status),
              records?.length && !embedded
                ? e(
                    'button',
                    { type: 'button', className: 'dss-link', 'aria-expanded': open, onClick: () => setOpen(!open) },
                    open ? '收起' : '查看',
                  )
                : null,
            ),
        open ? e('div', null, ...list('待查看', attention), ...list('留存备份', history)) : null,
      );
    }
    // Where the sync page was when a sub-page opened, so returning lands in the same place.
    // The section is found again by its heading; the page re-renders from scratch.
    const RETURN_ANCHORS = '.dss-sec, .dss-setting-card';
    let returnPosition = null;
    function anchorKey(node) {
      return node.querySelector('h2, .dss-card-title, .dss-h')?.textContent || '';
    }
    function rememberPosition() {
      if (typeof document === 'undefined') return;
      const from = document.activeElement?.closest?.(RETURN_ANCHORS);
      if (from) returnPosition = { key: anchorKey(from), top: from.getBoundingClientRect().top };
    }
    function scrollParent(node) {
      for (let el = node.parentElement; el; el = el.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) return el;
      }
      return document.scrollingElement;
    }
    function restorePosition(tries = 30) {
      if (!returnPosition || typeof document === 'undefined') return;
      const target = [...document.querySelectorAll(RETURN_ANCHORS)].find(node => anchorKey(node) === returnPosition.key);
      if (!target) {
        if (tries > 0) requestAnimationFrame(() => restorePosition(tries - 1));
        else returnPosition = null;
        return;
      }
      const container = scrollParent(target);
      if (container) container.scrollTop += target.getBoundingClientRect().top - returnPosition.top;
      returnPosition = null;
    }
    function Section(props) {
      const { busy, status, statusError, runError, progress, run, refresh, review } = useSync();
      // The settings.section owner passes its close action for flows leaving the modal.
      const openRepair = request => {
        rememberPosition();
        openRepairPage(request);
        props?.close?.();
      };
      const openManagement = panel => {
        rememberPosition();
        repairNavigation?.selectPanel('dsh-sync-' + panel);
        props?.close?.();
      };
      const setupFocus = useRef(false);
      const setupStarting = useRef(false);
      const [setupStep, setSetupStep] = useState(null);
      const [setupConnection, setSetupConnection] = useState(null);
      const [setupRunError, setSetupRunError] = useState('');
      const [firstSyncScope, setFirstSyncScope] = useState(null);
      const [setupScope, setSetupScope] = useState(EMPTY_SETUP_SCOPE);
      const [dismissedReview, setDismissedReview] = useState(null);
      const [repairDialog, setRepairDialog] = useState(null);
      const [page, setPage] = useState(null);
      const [settingsPending, setSettingsPending] = useState(false);
      const goToStep = number => {
        setupFocus.current = true;
        setSetupStep(number);
        setPage('setup');
        setSetupRunError('');
      };
      const configured = Boolean(status?.remote);
      const currentPage = page || (!status ? 'loading' : configured ? 'sync' : 'setup');
      const nextStep = setupStep || 1;
      const showRun = currentPage === 'sync' || (currentPage === 'setup' && nextStep === 3);
      useEffect(() => {
        if (currentPage !== 'setup' || !setupFocus.current || typeof document === 'undefined') return;
        setupFocus.current = false;
        document.getElementById('dss-setup-heading-' + nextStep)?.focus();
      }, [currentPage, nextStep]);
      useEffect(() => {
        if (currentPage === 'sync' && typeof requestAnimationFrame === 'function')
          requestAnimationFrame(() => restorePosition());
      }, [currentPage]);
      const onRun = async () => {
        if (busy || settingsPending || setupStarting.current) return;
        setDismissedReview(null);
        if (currentPage === 'sync') return run();
        if (nextStep !== 3 || !firstSyncScope || !setupConnection) return;
        setupStarting.current = true;
        setSettingsPending(true);
        setSetupRunError('');
        try {
          const read = await API.config();
          if (!read?.ok || !read.config) throw new Error(read?.error || '无法读取同步范围，请重试。');
          const selected = syncScopeChoices(read.config).filter(choice => choice.checked);
          if (
            selected.length !== firstSyncScope.length ||
            selected.some((choice, i) => choice.key !== firstSyncScope[i].key)
          ) {
            goToStep(2);
            setSetupRunError('同步范围已变化，请重新确认。');
            return;
          }
          const { remote, expectedRemote, expectedBranch, expectedAutoRepo } = setupConnection;
          const saved = await API.saveConnection({ remote, expectedRemote, expectedBranch, expectedAutoRepo });
          if (!saved?.ok || !saved.config) throw new Error(saved?.error || '无法保存同步仓库，请重试。');
          const config = saved.config;
          setSetupConnection({
            ...setupConnection,
            expectedRemote: config.remote,
            expectedBranch: config.branch,
            expectedAutoRepo: config.autoRepo,
            config,
          });
          const outcome = await run(undefined, {
            remote: config.remote,
            branch: config.branch,
            autoRepo: config.autoRepo,
            defaultOwner: setupConnection.defaultOwner,
            scope: Object.fromEntries(syncScopeChoices(read.config).map(choice => [choice.key, choice.checked])),
          });
          if (!outcome?.ok && !outcome?.detail?.needsReview && !outcome?.detail?.downloadPending) {
            if (setupConnection.defaultOwner) {
              const readback = await API.config().catch(() => null);
              const actual = readback?.ok && readback.config;
              const linkedRemote = `https://github.com/${setupConnection.defaultOwner}/dsh-sync.git`;
              if (actual?.remote === linkedRemote && actual.branch === config.branch) {
                setSetupConnection({
                  remote: actual.remote,
                  expectedRemote: actual.remote,
                  expectedBranch: actual.branch,
                  expectedAutoRepo: actual.autoRepo,
                  config: actual,
                  hint: setupConnection.hint,
                });
              }
            }
            throw new Error(outcome?.detail?.error || outcome?.error || outcome?.summary || '首次同步未完成，请重试。');
          }
          setPage('sync');
        } catch (err) {
          setSetupRunError(err.message || String(err));
        } finally {
          setupStarting.current = false;
          setSettingsPending(false);
        }
      };
      const savedDetail = useMemo(() => lastDetailText(status?.lastDetail), [status?.lastDetail]);
      const [versionReset, setVersionReset] = useState({ pending: false, error: '' });
      // Give up a version record left by a DSH that is no longer used: back up, then sync.
      const resetSettingsVersion = async other => {
        if (busy || settingsPending || versionReset.pending) return;
        if (!window.confirm(`清除 DSH ${other} 的版本记录，由这台电脑接管设置同步？当前设置会先另存为恢复记录。`)) return;
        setVersionReset({ pending: true, error: '' });
        try {
          const d = await API.resetSettingsVersion(other);
          if (!d || !d.ok) throw new Error((d && d.error) || '清除失败，请重试。');
          setVersionReset({ pending: false, error: '' });
          await onRun();
        } catch (err) {
          setVersionReset({ pending: false, error: err.message || String(err) });
        }
      };
      const pauseVersions = status?.lastDetail?.settingsPauseVersions || null;
      const currentNotice = status && syncMessagePresentation(status.lastMessage, status.lastOk, status.lastDetail).current;
      const verificationPending = status?.dataVerificationPending ?? status?.lastDetail?.dataVerificationPending;
      const repairQueued = status?.queuedRepairs > 0;
      const last = status?.lastDetail;
      const failed = Boolean(
        runError ||
        (status?.lastOk === false &&
          !verificationPending &&
          !repairQueued &&
          !last?.cancelled &&
          !last?.needsReview &&
          ((!last?.downloadPending && !last?.deferred) || last?.error || last?.workspaces?.errors?.length)),
      );
      const detail = runError?.message || savedDetail || (failed ? status?.lastMessage || '同步失败' : '');

      const syncState = (() => {
        if (busy) return [progress?.label || '准备同步…', 'blue'];
        if (runError) return ['同步失败', 'error'];
        if (status?.gitMissing) return ['未安装 Git', 'error'];
        if (!status?.remote) return ['尚未连接仓库', 'idle'];
        if (verificationPending) return ['修复完成，待核对', 'warning'];
        if (repairQueued) return ['有修复待执行', 'warning'];
        if (last?.cancelled) return ['同步已取消', 'idle'];
        if (last?.needsReview)
          return [
            last.review?.alternatives?.some(choice => choice.action === 'restore') ? '缺少文件，已暂停' : '等待确认',
            'warning',
          ];
        if (last?.downloadPending) return ['有内容待取回', 'warning'];
        if (failed) {
          const op = last?.failure?.op || last?.error;
          if (op === 'push') return ['上传失败', 'error'];
          if (op === 'fetch' || op === 'clone') return ['下载失败', 'error'];
          return [last?.workspaces?.errors?.length && !last.error ? '项目文件同步失败' : '同步失败', 'error'];
        }
        if (last?.settingsPause) return ['设置暂停同步', 'warning'];
        if (last?.deferred) return ['同步待完成', 'warning'];
        if (currentNotice) return [status.lastMessage, 'blue'];
        return status.lastOk === true ? ['同步完成', 'blue'] : ['尚未同步', 'idle'];
      })();
      const shortStage =
        busy && { ws: '同步项目', privacy: '检查内容', apply: '写入会话', cancelling: '正在停止' }[progress?.stage];
      const stageLabel = e(
        'span',
        { className: 'dss-sync-stage', title: syncState[0] },
        shortStage
          ? [
              e('span', { className: 'dss-sync-stage-full', key: 'full' }, syncState[0]),
              e('span', { className: 'dss-sync-stage-short', key: 'short' }, shortStage),
            ]
          : syncState[0],
      );

      return e(
        'div',
        { className: 'dss-wrap dss-sync-page' },
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
              e('div', { className: 'dss-setup-heading' }, e('div', { className: 'dss-onboarding-title' }, '第一次设置')),
              e(
                'nav',
                { className: 'dss-steps', 'aria-label': '同步设置步骤' },
                ['同步仓库', '选择内容', '首次同步'].map((label, i) =>
                  e(
                    'button',
                    {
                      key: i,
                      type: 'button',
                      disabled: settingsPending || busy || i + 1 >= nextStep,
                      className: 'dss-step-link',
                      'aria-current': nextStep === i + 1 ? 'step' : undefined,
                      onClick: () => {
                        if (!setupStarting.current && !settingsPending && !busy && i + 1 < nextStep) goToStep(i + 1);
                      },
                    },
                    i + 1 + '. ' + label,
                  ),
                ),
              ),
            )
          : null,
        currentPage === 'setup' && nextStep === 2 && setupRunError
          ? e('p', { className: 'dss-err dss-form-error', role: 'alert' }, setupRunError)
          : null,
        currentPage === 'setup' && nextStep === 2
          ? e(SyncPreferences, {
              setup: true,
              busy,
              setupScope,
              onScopeChange: setSetupScope,
              onSavingChange: setSettingsPending,
              onChanged: refresh,
              onSaved: config => {
                setFirstSyncScope(syncScopeChoices(config).filter(choice => choice.checked));
                goToStep(3);
              },
            })
          : null,
        currentPage === 'setup' && nextStep === 1
          ? e(ConnectionSettings, {
              setup: true,
              remote: status?.remote,
              branch: status?.branch,
              candidate: setupConnection,
              busy,
              onSavingChange: setSettingsPending,
              onSaved: candidate => {
                setSetupConnection(candidate);
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
                    ? e(
                        'div',
                        { className: 'dss-sync-title' },
                        stepHeading(3, '首次同步'),
                        busy
                          ? e(
                              'span',
                              { className: 'dss-status-light', 'data-tone': 'blue', role: 'status' },
                              stageLabel,
                              progress?.startedAt ? e(ElapsedText, { startedAt: progress.startedAt, prefix: '· ' }) : null,
                            )
                          : null,
                      )
                    : e(
                        'div',
                        { className: 'dss-title-status dss-sync-title' },
                        e('h2', { className: 'dss-section-title' }, '同步状态'),
                        e(
                          'span',
                          {
                            className:
                              'dss-status-light' +
                              (!busy && currentNotice && syncState[0] === status.lastMessage ? ' dss-current-status' : ''),
                            'data-tone': syncState[1],
                            role: 'status',
                            style:
                              !busy && currentNotice && syncState[0] === status.lastMessage
                                ? { color: '#4d6bfe' }
                                : undefined,
                          },
                          stageLabel,
                          busy && progress?.startedAt
                            ? e(ElapsedText, { startedAt: progress.startedAt, prefix: '· ' })
                            : null,
                        ),
                      ),
                ),
                e(
                  'button',
                  {
                    type: 'button',
                    className: 'dss-pill dss-primary dss-run-button',
                    disabled:
                      busy ||
                      settingsPending ||
                      Boolean(status?.gitMissing) ||
                      (currentPage === 'setup' && (!firstSyncScope || !setupConnection)),
                    title: currentPage === 'sync' ? '取回云端更新并上传本机改动' : undefined,
                    onClick: onRun,
                  },
                  e(SyncIcon, { spin: busy }),
                  busy ? '同步中' : currentPage === 'setup' && settingsPending ? '正在确认…' : '立即同步',
                ),
                busy && progress?.transfer
                  ? e(
                      'details',
                      { className: 'dss-live-progress' },
                      e(
                        'summary',
                        { 'aria-label': '本次同步进度' },
                        progress.transfer.pct != null
                          ? progress.transfer.pct + '%'
                          : progress.transfer.op === 'push'
                            ? '上传'
                            : '下载',
                      ),
                      e(
                        'div',
                        { className: 'dss-live-progress-body' },
                        e('p', null, syncState[0]),
                        e(TransferLine, { t: progress.transfer }),
                      ),
                    )
                  : null,
              ),
              currentPage === 'setup' && setupRunError
                ? e('div', { className: 'dss-err dss-form-error', role: 'alert' }, setupRunError)
                : null,
              currentPage === 'sync'
                ? e(SessionForkNotice, {
                    count: status?.pendingSessionForks,
                    onSelect: record => {
                      rememberPosition();
                      openSessionConflict(record);
                      props?.close?.();
                    },
                  })
                : null,
              currentPage === 'sync'
                ? e(TransferReview, {
                    review,
                    collapsed: dismissedReview === review?.id,
                    onExpand: () => setDismissedReview(null),
                    busy: busy || settingsPending,
                    onConfirm: id => run(id),
                    onDismiss: () => setDismissedReview(review?.id),
                  })
                : null,
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
              status?.lastDetail?.settingsPause
                ? e(
                    'div',
                    { className: 'dss-guide dss-version-pause' },
                    e('p', { className: 'dss-desc' }, status.lastDetail.settingsPause),
                    pauseVersions
                      ? e(
                          react.Fragment,
                          null,
                          e(
                            'p',
                            { className: 'dss-desc' },
                            '较新 DSH 的电脑已不再使用（重置、退役或回退）时，可以清除版本记录，由这台电脑接管设置同步。',
                          ),
                          e(
                            'button',
                            {
                              type: 'button',
                              className: 'dss-pill',
                              disabled: busy || settingsPending || versionReset.pending,
                              onClick: () => resetSettingsVersion(pauseVersions.other),
                            },
                            versionReset.pending ? '正在备份…' : '清除版本记录',
                          ),
                        )
                      : null,
                    versionReset.error ? e('div', { className: 'dss-err', role: 'alert' }, versionReset.error) : null,
                  )
                : null,
              status?.lastOk === false
                ? e(SyncIssues, { issues: status.lastDetail?.issues, detail: status.lastDetail })
                : null,
              e(NetworkStatus, {
                busy,
                remote: status?.remote,
                candidate: currentPage === 'setup' ? setupConnection : null,
              }),
              /* 上次结果明细:错误保留很久便于排障 */
              detail
                ? e(
                    'details',
                    { key: runError?.startedAt ?? status?.lastSyncAt ?? 0, open: failed || undefined },
                    e(
                      'summary',
                      null,
                      '上次同步详情' +
                        (runError || status?.lastSyncAt
                          ? ' · ' + new Date(runError?.startedAt ?? status.lastSyncAt).toLocaleString()
                          : ''),
                    ),
                    e('div', { className: 'dss-sync-detail-content ' + (failed ? 'dss-err' : 'dss-desc') }, detail),
                  )
                : null,
            )
          : null,
        currentPage === 'sync'
          ? e(
              'div',
              { className: 'dss-sec dss-settings-group', 'data-sync-settings': true },
              e(
                'div',
                { className: 'dss-settings-body' },
                e(SyncPreferences, {
                  busy,
                  lastSyncAt: status?.lastSyncAt,
                  onSavingChange: setSettingsPending,
                  onChanged: refresh,
                }),
                e(ConnectionSettings, {
                  remote: status?.remote,
                  branch: status?.branch,
                  busy: busy || settingsPending,
                  onSaved: refresh,
                  onManage: () => openManagement('connection'),
                }),
              ),
            )
          : null,
        currentPage === 'sync'
          ? e(
              'section',
              { className: 'dss-sec', 'data-sync-recovery': true },
              e(
                'div',
                { className: 'dss-storage-head' },
                e('h2', { className: 'dss-section-title' }, syncBackupTitle),
                pill('管理备份', () => openManagement('conflict-backups')),
              ),
            )
          : null,
        currentPage === 'sync'
          ? e(
              'section',
              { className: 'dss-sec', 'data-storage-entry': true },
              e(
                'div',
                { className: 'dss-storage-head' },
                e('h2', { className: 'dss-section-title' }, storageTitle),
                pill('管理存储', () => openManagement('storage'), { disabled: busy || settingsPending }),
              ),
            )
          : null,
        currentPage === 'sync'
          ? e(
              'section',
              { className: 'dss-sec' },
              e(
                'div',
                { className: 'dss-storage-head' },
                e('h2', { className: 'dss-section-title' }, '修复会话问题（实验性）'),
                pill(
                  '检查会话问题',
                  () => {
                    if (verificationPending || repairQueued) openRepair({ mode: 'all' });
                    else setRepairDialog('all');
                  },
                  { disabled: busy || settingsPending },
                ),
              ),
            )
          : null,
        repairDialog
          ? e(
              Modal,
              {
                title: repairDialog === 'grouping' ? '处理未分组会话' : '检查会话问题',
                wide: true,
                onClose: () => setRepairDialog(null),
              },
              dialogBody(
                e(DataHealth, {
                  key: repairDialog,
                  expanded: true,
                  busy: busy || settingsPending,
                  grouping: repairDialog === 'grouping',
                  onGrouping: () => setRepairDialog('grouping'),
                  onVerified: refresh,
                }),
              ),
              dialogActions(
                '',
                repairDialog === 'grouping' ? pill('返回检查', () => setRepairDialog('all')) : null,
                pill('关闭', () => setRepairDialog(null)),
              ),
            )
          : null,
      );
    }
    /* ---------- 同步仓库与本机存储 ---------- */
    // One section with a summary line per kind; lists, choices and confirmations open
    // in a dialog whose body scrolls while its buttons stay in view.
    function Modal({ title, note, wide = false, comparison = false, label, tools, onClose, children }) {
      const dialog = useRef(null);
      useDialogWheel(dialog);
      useEffect(() => {
        const node = dialog.current;
        const previous = node?.ownerDocument.activeElement;
        if (node && !node.open) node.showModal?.();
        return () => {
          if (node?.open) node.close();
          if (previous?.isConnected) previous.focus();
        };
      }, []);
      return e(
        'dialog',
        {
          ref: dialog,
          className: 'dss-confirm-dialog' + (comparison ? ' dss-recovery-dialog' : wide ? ' dss-dialog-wide' : ''),
          'aria-modal': true,
          'aria-label': label || title,
          onCancel: event => {
            event.preventDefault();
            onClose();
          },
          onKeyDown: event => event.stopPropagation(),
        },
        e(
          'div',
          { className: 'dss-confirm-head' },
          e('div', null, e('h2', null, title), note ? e('p', { className: 'dss-desc' }, note) : null),
          tools,
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
      return session.title || '未命名会话 · ' + session.id.slice(-8);
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
    // The first messages of a session, loaded when the user asks for them.
    function SessionPreview({ id }) {
      const [state, setState] = useState(null);
      const load = async () => {
        setState({ loading: true });
        try {
          const d = await API.sessionPreview(id);
          if (!d?.ok) throw new Error(d?.error || '读取失败');
          setState({ data: d });
        } catch (err) {
          setState({ error: err.message || String(err) });
        }
      };
      if (!state) return e('button', { type: 'button', className: 'dss-link', onClick: load }, '预览');
      if (state.loading) return e('span', { className: 'dss-desc' }, '正在读取…');
      if (state.error) return e('span', { className: 'dss-err' }, state.error);
      const d = state.data;
      return e(
        'div',
        { className: 'dss-session-preview' },
        e(
          'small',
          { className: 'dss-desc' },
          d.messages +
            ' 条提问' +
            (d.firstAt ? ' · ' + new Date(d.firstAt).toLocaleString() : '') +
            (d.source === 'history' ? ' · 只在同步历史中' : ''),
        ),
        d.preview.length
          ? d.preview.map((text, i) => e('p', { key: i }, text))
          : e('p', { className: 'dss-desc' }, '没有文字提问'),
      );
    }
    function SessionsDialog({ data, busy, focus, onClose, onDone }) {
      const focused = focus ? sessionGroups(data.sessions).find(group => group.key === focus) : null;
      const [selected, setSelected] = useState(() => (focused ? focused.rows.map(s => s.id) : [])),
        [expanded, setExpanded] = useState(() => (focus ? { [focus]: true } : {})),
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
          wide: true,
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
                e(
                  'div',
                  { key: session.id, className: 'dss-session-row' },
                  pickRow({
                    key: 'pick',
                    label: sessionLabel(session),
                    detail:
                      (session.project ? session.project + ' · ' : '') +
                      (session.updatedAt ? new Date(session.updatedAt).toLocaleString() : '') +
                      (session.onThisComputer ? '' : ' · 这台电脑上没有'),
                    checked: selected.includes(session.id),
                    disabled: blocked,
                    onChange: on => togglePick(setSelected, [session.id], on),
                  }),
                  e(SessionPreview, { id: session.id }),
                ),
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
      return (
        '当前内容 ' +
        fmtBytes(data.currentBytes) +
        '；同步分支历史 ' +
        fmtBytes(data.historyBytes) +
        (data.localOtherBytes ? '；本机另存旧历史 ' + fmtBytes(data.localOtherBytes) : '')
      );
    }
    // What each row can do: sessions leave the sync, old files leave the repository.
    const USAGE_ACTIONS = {
      archived: ['移出同步', 'sessions'],
      hidden: ['移出同步', 'sessions'],
      leftover: ['移除', 'remoteFiles'],
    };
    function UsageDialog({ data, busy, onRefresh, onOpen }) {
      const rows = data.groups.filter(g => g.files || g.historyBytes);
      return e(
        'section',
        { className: 'dss-usage-detail', 'aria-label': '同步仓库占用' },
        e('h3', null, '同步仓库占用'),
        e(
          'p',
          { className: 'dss-desc' },
          '本机可见的同步分支：当前内容 ' +
            fmtBytes(data.currentBytes) +
            '，历史版本 ' +
            fmtBytes(data.historyBytes) +
            '，目录与提交记录 ' +
            fmtBytes(data.structureBytes) +
            '。' +
            (data.localBytes != null ? '这台电脑的同步副本共占 ' + fmtBytes(data.localBytes) + '。' : ''),
        ),
        dialogBody(
          e(
            'div',
            { className: 'dss-usage-table' },
            e(
              'div',
              { className: 'dss-usage-row dss-usage-head' },
              e('span', null, '内容'),
              e('span', null, '当前'),
              e('span', null, '历史版本'),
              e('span', null, ''),
            ),
            rows.map(g => {
              const action = g.files ? USAGE_ACTIONS[g.id] : null;
              return e(
                'div',
                { key: g.id, className: 'dss-usage-row', 'data-usage-row': g.id },
                e('span', null, g.title),
                e('span', null, g.files + ' 个 · ' + fmtBytes(g.storedBytes)),
                e('span', null, fmtBytes(g.historyBytes)),
                action
                  ? e(
                      'button',
                      {
                        type: 'button',
                        className: 'dss-link',
                        disabled: busy,
                        onClick: () => onOpen(action[1], g.id),
                      },
                      action[0],
                    )
                  : e('span'),
              );
            }),
          ),
          e(
            'div',
            { className: 'dss-history-bar' },
            e(
              'div',
              { className: 'dss-group-text' },
              e('span', null, '历史版本 ' + fmtBytes(data.historyBytes) + ' · ' + data.commits + ' 次同步记录'),
              e(
                'small',
                { className: 'dss-desc' },
                '这些是 chatsync 每次同步产生的 Git 提交，不是 DSH 自带数据。新电脑只取当前快照；同步仓库可能保留更多旧历史，可打开仓库查看。',
              ),
            ),
            pill('清除历史版本…', () => onOpen('history'), { disabled: busy || (data.commits <= 1 && !data.shallow) }),
            data.repositoryUrl
              ? data.repositoryLabel === 'GitHub'
                ? helpLink('在 GitHub 查看历史', data.repositoryUrl + '/commits/' + encodeURIComponent(data.branch))
                : helpLink('在 ' + (data.repositoryLabel || '网页') + ' 查看仓库', data.repositoryUrl)
              : null,
          ),
          data.localOtherBytes
            ? e(
                'div',
                { className: 'dss-history-bar', 'data-local-history': true },
                e(
                  'div',
                  { className: 'dss-group-text' },
                  e('span', null, '本机另存的旧历史 ' + fmtBytes(data.localOtherBytes)),
                  e(
                    'small',
                    { className: 'dss-desc' },
                    '同步分支已不包含、只在这台电脑的同步副本中保留的旧提交，例如早先版本清除历史后留下的同步前备份。新电脑不会下载它们。',
                  ),
                ),
                pill('回收本机空间…', () => onOpen('localHistory'), { disabled: busy }),
              )
            : null,
          e(
            'p',
            { className: 'dss-desc' },
            data.branches
              ? '同步仓库另有项目分支 ' +
                  data.branches.project +
                  ' 个、同步前备份分支 ' +
                  data.branches.backup +
                  ' 个、电脑同步回执 ' +
                  data.branches.device +
                  ' 个' +
                  (data.branches.other ? '、其他分支 ' + data.branches.other + ' 个' : '') +
                  '。新电脑只下载同步分支和仍在用的项目分支。'
              : '连不上同步仓库，没有统计其他分支。',
          ),
        ),
        dialogActions('大小按压缩后的存储计算', pill('重新统计', onRefresh, { disabled: busy })),
      );
    }

    /* —— 清除历史版本 —— */
    function HistoryDialog({ busy, onClose, onDone }) {
      const [preview, setPreview] = useState(null),
        [retired, setRetired] = useState([]),
        [deleteBranches, setDeleteBranches] = useState(false),
        [confirming, setConfirming] = useState(false),
        [pending, setPending] = useState(true),
        [error, setError] = useState('');
      const load = async () => {
        setPending(true);
        setError('');
        try {
          const d = await API.historyRebuild();
          if (!d?.ok) throw new Error(d?.error || '检查失败，请重试');
          setPreview(d);
        } catch (err) {
          setError(err.message || String(err));
        } finally {
          setPending(false);
        }
      };
      useEffect(() => {
        load();
      }, []);
      const blocked = busy || pending;
      const waiting = preview ? preview.blockers.filter(b => !retired.includes(b.deviceId)) : [];
      const apply = async () => {
        setPending(true);
        setError('');
        try {
          const d = await API.applyHistoryRebuild({
            previewId: preview.previewId,
            retiredDevices: retired,
            deleteBackupBranches: deleteBranches,
          });
          if (!d?.ok) throw new Error(d?.error || '没有完成，请重新检查');
          onDone(
            (d.commit ? '同步分支已改为只含当前内容。' : '') +
              (d.deletedBranches?.length ? '已删除 ' + d.deletedBranches.length + ' 个同步前备份分支。' : '') +
              (d.branchError || '') +
              (d.localCleanupError || '') +
              (d.backup ? '旧历史保留在同步仓库的 ' + d.backup + ' 分支，没有生成本机备份。' : ''),
          );
        } catch (err) {
          setError(err.message || String(err));
          setConfirming(false);
        } finally {
          setPending(false);
        }
      };
      const errorLine = error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null;
      if (confirming)
        return e(
          Modal,
          { title: '清除历史版本', note: '同步分支将只保留当前内容；旧历史保留在同步仓库的归档分支。', onClose },
          dialogBody(
            errorLine,
            e(
              'ul',
              { className: 'dss-steps' },
              e('li', null, '旧历史留在同步仓库的归档分支，不下载、不生成本机备份。'),
              e('li', null, '把同步仓库中的同步分支换成只含当前内容的一次记录。'),
              e('li', null, '回收这台电脑同步副本中的旧历史；同步仓库总占用不会因此清零。'),
              deleteBranches ? e('li', null, '删除 ' + preview.backupBranches.length + ' 个同步前备份分支。') : null,
              e('li', null, '其他电脑下次同步时自动改用新的历史，各电脑上的数据不变。'),
            ),
          ),
          dialogActions(
            '',
            pill('返回', () => setConfirming(false), { disabled: pending }),
            pill(pending ? '正在清除…' : '清除', apply, { disabled: blocked, kind: 'danger' }),
          ),
        );
      return e(
        Modal,
        {
          title: '清除历史版本',
          note: '清除后，同步分支只保留当前内容，并回收本机旧历史。旧历史仍保留在同步仓库的归档分支。',
          onClose,
        },
        dialogBody(
          errorLine,
          pending && !preview
            ? e('p', { className: 'dss-desc', role: 'status' }, '正在读取同步仓库与设备回执（最多 2 分钟）…')
            : null,
          preview
            ? e(
                'div',
                { className: 'dss-stack' },
                e(
                  'p',
                  { className: 'dss-desc' },
                  '本机已取回 ' +
                    preview.commits +
                    ' 次同步记录' +
                    (preview.shallow ? '（仅当前快照，同步仓库可能有更多历史）' : '') +
                    '。旧历史只保留在同步仓库，不生成完整本机备份。',
                ),
                preview.blockers.length
                  ? e(
                      'div',
                      { className: 'dss-stack' },
                      e(
                        'p',
                        { className: 'dss-err', role: 'alert' },
                        '这些电脑还不是 ' +
                          preview.minVersion +
                          ' 或更新版本。旧版本会把旧历史重新传回去，请先在它们上面升级并同步一次；不再使用的电脑可以勾选：',
                      ),
                      ...preview.blockers.map(b =>
                        pickRow({
                          key: b.deviceId,
                          label: b.deviceName + ' 已不再使用',
                          detail: b.reason + (b.appliedAt ? ' · 最后同步 ' + new Date(b.appliedAt).toLocaleString() : ''),
                          checked: retired.includes(b.deviceId),
                          disabled: blocked,
                          onChange: on =>
                            setRetired(old => (on ? [...old, b.deviceId] : old.filter(id => id !== b.deviceId))),
                        }),
                      ),
                    )
                  : null,
                preview.backupBranches.length
                  ? pickRow({
                      key: 'branches',
                      label: '同时删除同步仓库中 ' + preview.backupBranches.length + ' 个同步前备份分支',
                      detail: '同步遇到冲突时保存的云端版本。不删除的话，它们仍占用同步仓库的空间。',
                      checked: deleteBranches,
                      disabled: blocked,
                      onChange: setDeleteBranches,
                    })
                  : null,
              )
            : null,
        ),
        dialogActions(
          waiting.length ? waiting.length + ' 台电脑需要先升级' : '',
          pill('关闭', onClose),
          error ? pill('重新检查', load, { disabled: blocked }) : null,
          pill('清除…', () => setConfirming(true), {
            disabled:
              blocked || !preview || waiting.length > 0 || (preview.commits <= 1 && !preview.shallow && !deleteBranches),
          }),
        ),
      );
    }

    /* —— 回收本机另存的旧历史 —— */
    function LocalHistoryDialog({ busy, onClose, onDone }) {
      const [preview, setPreview] = useState(null),
        [pending, setPending] = useState(true),
        [error, setError] = useState('');
      const load = async () => {
        setPending(true);
        setError('');
        try {
          const d = await API.localHistory();
          if (!d?.ok) throw new Error(d?.error || '检查失败，请重试');
          setPreview(d);
        } catch (err) {
          setError(err.message || String(err));
        } finally {
          setPending(false);
        }
      };
      useEffect(() => {
        load();
      }, []);
      const removable = preview ? preview.refs.filter(r => r.removable) : [];
      const apply = async () => {
        setPending(true);
        setError('');
        try {
          const d = await API.reclaimLocalHistory({ previewId: preview.previewId });
          if (!d?.ok) throw new Error(d?.error || '没有完成，请重新检查');
          onDone(
            '已删除 ' +
              d.removed.length +
              ' 个本机旧备份引用，回收 ' +
              fmtBytes(d.freedBytes) +
              '；同步副本现占 ' +
              fmtBytes(d.totalBytes) +
              '。',
          );
        } catch (err) {
          setError(err.message || String(err));
        } finally {
          setPending(false);
        }
      };
      return e(
        Modal,
        {
          title: '回收本机空间',
          note: '只删除同步仓库仍保留着的旧备份在这台电脑的副本；同步仓库、其他电脑和 DSH 数据都不变。',
          onClose,
        },
        dialogBody(
          error ? e('div', { className: 'dss-err', role: 'alert' }, error) : null,
          pending && !preview
            ? e('p', { className: 'dss-desc', role: 'status' }, '正在核对本机副本与同步仓库中的历史…')
            : null,
          preview
            ? e(
                'div',
                { className: 'dss-stack' },
                e(
                  'p',
                  { className: 'dss-desc' },
                  '同步副本共占 ' +
                    fmtBytes(preview.totalBytes) +
                    '，其中当前同步分支 ' +
                    fmtBytes(preview.currentBytes) +
                    '。',
                ),
                preview.refs.length
                  ? e(
                      'ul',
                      { className: 'dss-steps' },
                      preview.refs.map(r =>
                        e(
                          'li',
                          { key: r.ref },
                          r.ref.replace(/^refs\/(?:heads|remotes)\//, '') +
                            ' · 另占 ' +
                            fmtBytes(r.bytes) +
                            (r.removable ? ' · 同步仓库已保留，可删除' : ' · ' + r.reason),
                        ),
                      ),
                    )
                  : e('p', { className: 'dss-desc' }, '没有占用空间的旧备份引用；可能只是尚未回收的旧对象。'),
                preview.reflogClean
                  ? null
                  : e('p', { className: 'dss-err' }, '恢复记录中还有未归档的独有提交，暂不能回收。'),
              )
            : null,
        ),
        dialogActions(
          removable.length ? '可删除 ' + removable.length + ' 个' : '',
          pill('关闭', onClose),
          error ? pill('重新检查', load, { disabled: busy || pending }) : null,
          pill(pending && preview ? '正在回收…' : '回收', apply, {
            disabled: busy || pending || !preview || !preview.reflogClean || (!removable.length && !preview.otherBytes),
            kind: 'danger',
          }),
        ),
      );
    }

    /* —— 本机备份 —— */
    function backupSummary(scan) {
      const free = scan.items.filter(i => !i.protected).reduce((sum, i) => sum + i.bytes, 0);
      if (scan.backupBytes !== undefined)
        return (
          '恢复原件 ' +
          fmtBytes(scan.backupBytes) +
          ' · 同步副本 ' +
          fmtBytes(scan.transportBytes) +
          ' · 旧版遗留 ' +
          fmtBytes(scan.legacyBytes) +
          (free ? '；可清理 ' + fmtBytes(free) : '')
        );
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
                  label: '我已核对所选原件和旧仓库，不再需要其中的独有历史，并已关闭相关编辑',
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
          title: '本机存储明细',
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
          title: '云端旧文件',
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
                    ' 或更新版本。旧版本会把云端移除当作删除本机文件，请先在它们上面升级并同步一次；不再使用的电脑可以勾选：',
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
        action: '明细',
        load: () => API.sessions(),
        summary: sessionsSummary,
      },
      { key: 'usage', title: '同步仓库', remote: true, action: '明细', load: () => API.repoUsage(), summary: usageSummary },
      {
        key: 'backups',
        title: '本机存储',
        remote: false,
        action: '明细',
        load: () => API.localStorage(),
        summary: backupSummary,
      },
      {
        key: 'remoteFiles',
        title: '云端旧文件',
        remote: true,
        action: '明细',
        load: () => API.remoteCleanup(),
        summary: remoteSummary,
        empty: data => !data.files.length,
      },
    ];
    const storageTitle = '同步仓库与本机存储（实验性）';
    function StoragePage() {
      const { busy, status, statusError, refresh } = useSync();
      return e(
        ManagementPage,
        { title: storageTitle },
        status
          ? e(StorageOverview, { busy, remote: Boolean(status.remote), onRecovered: refresh })
          : e(
              'p',
              { role: statusError ? 'alert' : 'status' },
              statusError || '正在读取…',
              statusError ? pill('重新读取', refresh) : null,
            ),
      );
    }
    function StorageOverview({ busy, remote, onRecovered }) {
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
      useEffect(() => {
        load(rows.map(row => row.key));
      }, [remote]);
      const close = () => setOpen(null);
      // After a change, the affected lines and the repository usage are checked again.
      const done = keys => text => {
        setOpen(null);
        setMessage(text);
        load(keys.filter(key => rows.some(row => row.key === key)));
      };
      const dialogProps = { busy, onClose: close };
      const data = open && results[open.key]?.data;
      const dialog =
        open?.key === 'recovery'
          ? e(
              Modal,
              { title: '找回同步前的内容', wide: true, onClose: close },
              dialogBody(
                e('div', { className: 'dss-wrap' }, e(RecoveryCenter, { busy, embedded: true, onChanged: onRecovered })),
              ),
              dialogActions('', pill('返回存储管理', close)),
            )
          : open?.key === 'history'
            ? e(HistoryDialog, { ...dialogProps, onDone: done(['usage', 'backups']) })
            : open?.key === 'localHistory'
              ? e(LocalHistoryDialog, { ...dialogProps, onDone: done(['usage']) })
              : !data
                ? null
                : open.key === 'sessions'
                  ? e(SessionsDialog, { ...dialogProps, data, focus: open.focus, onDone: done(['sessions', 'usage']) })
                  : open.key === 'backups'
                    ? e(BackupDialog, { ...dialogProps, scan: data, onRescan: () => load(['backups']) })
                    : open.key === 'remoteFiles'
                      ? e(RemoteFilesDialog, { ...dialogProps, preview: data, onDone: done(['remoteFiles', 'usage']) })
                      : null;
      return e(
        'section',
        { className: 'dss-sec', 'data-storage-overview': true },
        message ? e('div', { className: 'dss-save-state', role: 'status' }, message) : null,
        e(
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
              result?.error && !loading[row.key]
                ? pill('重试', () => load([row.key]), { disabled: busy })
                : ready && !row.empty?.(result.data)
                  ? e(
                      'button',
                      {
                        type: 'button',
                        className: 'dss-link',
                        disabled: busy,
                        'aria-expanded': row.key === 'usage' ? open?.key === 'usage' : undefined,
                        onClick: () => setOpen(row.key === 'usage' && open?.key === 'usage' ? null : { key: row.key }),
                      },
                      row.key === 'usage' && open?.key === 'usage' ? '收起' : row.action,
                    )
                  : e('span'),
            );
          }),
        ),
        open?.key === 'usage' && data
          ? e(UsageDialog, {
              ...dialogProps,
              data,
              onRefresh: () => load(['usage']),
              onOpen: (key, focus) => setOpen({ key, focus }),
            })
          : null,
        e(
          'div',
          { className: 'dss-actions' },
          pill('找回同步前的内容', () => setOpen({ key: 'recovery' })),
        ),
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
        ctx.inject(['pluginNavigation'], guarded => {
          pluginUpdateNavigation = guarded.pluginNavigation;
          for (const update of pluginUpdateListeners) update(pluginUpdateNavigation);
          guarded.effect(() => () => {
            if (pluginUpdateNavigation !== guarded.pluginNavigation) return;
            pluginUpdateNavigation = null;
            for (const update of pluginUpdateListeners) update(null);
          });
        });
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
      // The short-name packager rewrites the package identity in the shipped client.
      ctx.slots.inject('plugins.bundle.config', () =>
        ctx.slots.register({ name: 'plugins.bundle.config', key: '@dpskk2/dsh-chatsync' }, PluginPreferences),
      );
      injectStyles(); // 侧栏胶囊按钮等样式全局注入,不依赖设置分节挂载
      // Same native panel contract as dshmarket; opening it never starts an upload.
      ctx.slots.inject('sidebar.panellist', () => {
        const main = ctx.slots.register({ name: 'main', key: 'dsh-sync', id: 'dsh-sync-panel' }, SyncPanel);
        const repair = ctx.slots.register(
          { name: 'main', key: 'dsh-sync-repair', id: 'dsh-sync-repair-panel' },
          RepairPage,
        );
        const backups = ctx.slots.register(
          { name: 'main', key: 'dsh-sync-conflict-backups', id: 'dsh-sync-backups-panel' },
          SyncBackupPage,
        );
        const management = [
          ['storage', StoragePage],
          ['connection', ConnectionPage],
          ['conflict', SessionConflictPage],
        ].map(([key, component]) =>
          ctx.slots.register({ name: 'main', key: 'dsh-sync-' + key, id: 'dsh-sync-' + key + '-panel' }, component),
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
        if (pluginPreferences.config) show(pluginPreferences.config.showSidebarSync !== false);
        return () => {
          if (sidebarBinding === show) sidebarBinding = null;
          removeEntry?.();
          main?.();
          repair?.();
          backups?.();
          management.forEach(remove => remove?.());
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
