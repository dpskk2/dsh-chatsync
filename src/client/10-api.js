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
  workspacePath: (workspaceId, path) =>
    fetch('/dsh-sync/api/workspace/path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, path }),
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

/* 气泡提示:挂在触发元素附近,结果反馈保留较长时间便于排障(8s 后淡出) */
function bubble(anchor, text, ok) {
  try {
    const b = document.createElement('div');
    b.className = 'dss-bubble';
    b.classList.add(ok ? 'dss-bubble-ok' : 'dss-bubble-err');
    if (ok) b.style.color = '#4d6bfe';
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
  '.dss-bubble-ok{color:#4d6bfe}',
  '.dss-auto-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px}.dss-auto-options>.dss-check{margin:0;gap:12px;padding:14px 16px}',
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
  '.dss-readable-comparison{flex:1;min-height:100px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;overflow:hidden}.dss-readable-side{display:flex;flex-direction:column;min-height:0;min-width:0}.dss-readable-heading{padding:8px 0;font-size:13px;color:var(--dsw-alias-label-secondary,#666)}.dss-readable-scroll{flex:1;min-height:0;overflow:auto;padding:12px 16px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px}.dss-transcript{width:min(100%,748px);margin:auto;display:flex;flex-direction:column;gap:28px;padding:12px 0}.dss-message{display:flex;min-width:0}.dss-message-user{justify-content:flex-end}.dss-message-user>.dss-message-body{max-width:82%;padding:10px 16px;border-radius:var(--dsw-radius-xl,18px);background:var(--dsw-specific-bubble,#edf2fa)}.dss-message-assistant>.dss-message-body{width:100%;min-width:0;line-height:1.75}.dss-readable-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.75}.dss-readable-fields dl{margin:0}.dss-readable-field{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,2fr);gap:16px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd)}.dss-readable-field dt{color:var(--dsw-alias-label-secondary,#666);overflow-wrap:anywhere}.dss-readable-field dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.dss-readable-projects article{padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd);overflow-wrap:anywhere}.dss-readable-image{margin:0}.dss-readable-image img{display:block;max-width:100%;max-height:65vh;object-fit:contain}.dss-readable-image figcaption{font-size:12px;color:var(--dsw-alias-label-secondary,#666);margin-top:8px}.dss-file-preview{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:14px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px;overflow-wrap:anywhere}.dss-message-body>p:first-child{margin-top:0}.dss-message-body>p:last-child{margin-bottom:0}@media(max-width:650px){.dss-readable-comparison{grid-template-columns:1fr;overflow:auto}.dss-readable-side{min-height:250px}.dss-readable-field{grid-template-columns:1fr;gap:4px}}',
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
  '.dss-storage-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.dss-storage-rows{display:flex;flex-direction:column;margin-top:8px}.dss-storage-row{display:grid;grid-template-columns:7em minmax(0,1fr) auto;gap:12px;align-items:baseline;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-storage-row .dss-err{margin:0}.dss-storage-title{font-weight:600}.dss-confirm-dialog.dss-dialog-wide{width:min(720px,calc(100vw - 32px))}.dss-confirm-dialog .dss-confirm-head{flex:none;max-height:40vh;overflow:auto}.dss-confirm-dialog .dss-confirm-actions{flex:none}.dss-confirm-status{margin-right:auto;align-self:center;font-size:13px;color:var(--dsw-alias-label-secondary,inherit)}.dss-pick{display:flex;align-items:center;gap:8px;padding:6px 0;line-height:20px}.dss-pick input{flex:none;width:16px;height:16px;margin:0;accent-color:#4d6bfe}.dss-pick select{margin-left:auto}.dss-confirm-body .dss-subtitle{margin:12px 0 4px}.dss-confirm-body code{overflow-wrap:anywhere}@media (max-width:480px){.dss-storage-row{grid-template-columns:minmax(0,1fr) auto}.dss-storage-row>.dss-desc,.dss-storage-row>.dss-err{grid-column:1/-1;grid-row:2}}',
  /* Repository usage: a compact table that collapses to two columns on narrow panes. */
  '.dss-usage-table{display:flex;flex-direction:column;font-size:13px}.dss-usage-row{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1.3fr) minmax(0,1fr) 5em;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-usage-row>:not(:first-child){text-align:right;white-space:nowrap}.dss-usage-head{font-weight:600}.dss-history-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:12px 0;padding:12px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}.dss-history-bar .dss-group-text{flex:1 1 240px}.dss-session-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0 8px}.dss-session-row>.dss-pick{flex:1 1 0;min-width:0}.dss-session-preview{flex:1 0 100%;margin:0 0 8px 24px;padding:8px 12px;border-left:2px solid var(--dsw-alias-border-l2,#d9dde3);font-size:13px}.dss-session-preview p{margin:4px 0;overflow-wrap:anywhere}.dss-steps{margin:0;padding-left:20px}.dss-steps li{margin:6px 0}@media (max-width:480px){.dss-usage-row{grid-template-columns:minmax(0,1fr) auto auto auto;font-size:12px}}',
  '.dss-confirm-dialog{box-sizing:border-box;width:min(520px,calc(100vw - 32px));max-height:min(80dvh,640px);padding:0;border:1px solid var(--dsw-alias-border-l2,#888);border-radius:14px;background:var(--dsw-alias-bg-layer-1,Canvas);color:var(--dsw-alias-label-primary,CanvasText);font:14px/1.6 system-ui;overflow:hidden}.dss-confirm-dialog[open]{display:flex;flex-direction:column}.dss-confirm-dialog::backdrop{background:#0009}.dss-confirm-head{padding:16px 20px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-confirm-head h2{font-size:17px;margin:0 0 4px}.dss-confirm-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 20px}.dss-confirm-row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;overflow-wrap:anywhere}.dss-confirm-actions{display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-confirm-dialog button.dss-pill{background:transparent;border-color:var(--dsw-alias-border-l4,rgba(127,127,127,.4));color:inherit;font-weight:500}.dss-confirm-dialog button.dss-primary{background:#4d6bfe;border-color:#4d6bfe;color:#fff}.dss-confirm-dialog button.dss-danger{background:#d93838;border-color:#d93838;color:#fff}',
  '.dss-wrap>.dss-settings-group{padding-top:0}.dss-wrap .dss-setting-card{border:0;border-radius:0;padding:28px 0;gap:20px}.dss-settings-body{gap:0}.dss-settings-body>.dss-setting-card+.dss-setting-card{border-top:1px solid var(--dsw-alias-border-l2,#d9dde3)}.dss-settings-body>.dss-setting-card:last-child{padding-bottom:0}.dss-scope-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px;text-align:left}.dss-scope-fields>.dss-span-all,.dss-scope-fields>.dss-workspace-locations{grid-column:1/-1}.dss-scope-fields>.dss-check{margin:0;gap:12px;padding:14px 16px}.dss-scope-help{margin-top:4px}.dss-scope-fields>.dss-workspace-locations{margin-top:12px;padding:18px 16px}.dss-scope-fields>.dss-subsection-heading{margin-top:12px;padding-top:24px}.dss-wrap .dss-setting-card>.dss-section-title{text-align:left}.dss-scope-fields .dss-choice{gap:4px}.dss-scope-fields .dss-choice small{font-size:13px;line-height:1.6}',
].join('\n');
