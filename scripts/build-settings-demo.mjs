// Embed the shipped React components, CSS and the actual first-install defaults.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DEFAULT_CONFIG } from '../lib/sync.js';
import { recoveryGuide } from '../lib/recovery-guide.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(path.join(root, 'work/ui-runtime/runtime.cjs'));
const { build } = require('esbuild');
const out = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'outputs/settings-ui-20261022');
fs.mkdirSync(out, { recursive: true });
const config = { ...DEFAULT_CONFIG, automatic: DEFAULT_CONFIG.enabled };
const record = { id: 'demo-ledger', kind: 'main', path: 'storages/sync-meta/profiles/desktop/pnpm-workspace.yaml.vmap.json',
  createdAt: new Date().toISOString(), status: 'merged', kept: 'local', versions: { local: { sha256: 'demo-local' }, remote: { sha256: 'demo-remote' } } };
record.guide = recoveryGuide(record, null);
const source = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8');
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
const e = React.createElement;
const DEFAULTS = ${JSON.stringify(config)};
const RECORD = ${JSON.stringify(record)};
let config = structuredClone(DEFAULTS), running = false, stage = '', startedAt = 0, lastDetail = null, lastSyncAt = 0;
let scenario = 'fresh', queued = false, activePanel = 'dsh-sync';
const slots = new Map(); let bundle;
window.__ModuleLoader__ = { load(def) { bundle = def.factory(() => React); } };
const status = () => ({ok:true, remote:config.remote, branch:config.branch, auto:config.automatic, autoRepo:config.autoRepo,
  lastSyncAt,lastDetail,lastOk:lastDetail ? true : null, gitMissing:false, patches:'', workspaceCount:0, ungroupedCount:0 });
window.fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : {};
  const endpoint = String(url).replace('/dsh-sync/api/', ''); let value = {ok:true};
  if (endpoint === 'config') { if (options.method === 'POST') { config={...config,...body};
    if ('automatic' in body) config.enabled=body.automatic; }
    value={ok:true,config:structuredClone(config)};
  } else if (endpoint === 'connection') {
    const remote=String(body.remote||'').trim();
    if(body.expectedRemote !== config.remote) value={ok:false,error:'备份地址已发生变化，请取消后重新打开设置。'};
    else if(remote && !['https://github.com/','git@github.com:','ssh://git@github.com/'].some(prefix=>remote.toLowerCase().startsWith(prefix))) value={ok:false,error:'请输入 GitHub 私有仓库地址。'};
    else {config={...config,remote,autoRepo:!remote};value={ok:true,config:structuredClone(config),hint:'已保存（演示数据，未连接 GitHub）'};}
  } else if (endpoint === 'status') value=status();
  else if (endpoint === 'update') value={ok:true,available:false};
  else if (endpoint === 'progress') value={ok:true,running,stage,label:stage==='fetch'?'正在获取远端更新':'正在上传本机改动',startedAt};
  else if (endpoint === 'grouping') value={ok:true,count:0,enabled:config.autoRestartAfterRepair,busy:running};
  else if (endpoint === 'startup') value={ok:true,startup:{phase:'ready'}};
  else if (endpoint === 'recovery') value={ok:true,records:scenario==='fresh'?[]:[RECORD]};
  else if (endpoint === 'conflicts') value={ok:true,conflicts:[]};
  else if (endpoint === 'recovery/preview') value={ok:true,canRestore:false,currentHash:'demo-local',
    local:{text:JSON.stringify({file:'profiles/desktop/pnpm-workspace.yaml',fields:{onlyBuiltDependencies:{clock:1,device:'computer-a',value:['esbuild']}}},null,2),sha256:'demo-local'},
    remote:{text:JSON.stringify({file:'profiles/desktop/pnpm-workspace.yaml',fields:{onlyBuiltDependencies:{clock:2,device:'computer-b',value:['esbuild','sharp']}}},null,2),sha256:'demo-remote'}};
  else if (endpoint === 'data-health/scan') value={ok:true,checkedLogs:29,issues:[],workspaces:[],queued:queued?1:0,
    repairBackups:[{id:'demo-backup',file:'storages/workspace.json'}]};
  else if (endpoint === 'data-health/preview') value={ok:true,planId:'demo-plan',warning:'将预览中的分组登记恢复为备份版本；原件会先备份。',files:[{file:'storages/workspace.json'}]};
  else if (endpoint === 'data-health/queue') {queued=true;value={ok:true,hint:'修复已安排。完全退出后会备份并修复。'};}
  else if (endpoint === 'data-health/cancel') {queued=false;value={ok:true,hint:'已取消修复安排。'};}
  else if (endpoint === 'run') {
    running=true;stage='fetch';startedAt=Date.now();
    await new Promise(resolve=>setTimeout(resolve,900)); stage='push';
    await new Promise(resolve=>setTimeout(resolve,900));
    if(!config.remote && config.autoRepo) config.remote='https://github.com/demo-user/dsh-sync.git';
    running=false;scenario='connected'; lastSyncAt=Date.now();lastDetail={pushed:true,committed:true,durationMs:1800,
      transfers:[{op:'push',size:18432}],workspaces:{total:0,synced:0}};
    value={ok:true,summary:'同步完成（演示数据）',detail:lastDetail};
  }
  return {ok:true,json:async()=>value};
};
${source}
bundle.apply({slots:{inject:(_name,callback)=>callback(),register:(meta,component)=>{const id=meta.id||meta.key;slots.set(id,component);if(meta.name==='sidebar.panellist')document.getElementById('show-sync').hidden=false;return()=>{slots.delete(id);if(meta.name==='sidebar.panellist')document.getElementById('show-sync').hidden=true;};}},
  inject:(names,callback)=>{if(names.includes('layout'))callback({layout:{selectPanel:key=>{activePanel=key;render();}},effect:()=>{}});},effect:()=>{}});
const Section=slots.get('dsh-sync-manage');
let appRoot=createRoot(document.getElementById('sync-root'));
let mount=0;
function render(){appRoot.render(e(activePanel==='dsh-sync-repair'?slots.get('dsh-sync-repair-panel'):Section,{key:++mount,close:()=>document.getElementById('settings-modal').close()}));}
render();
const account=document.getElementById('account');
account.onclick=()=>document.getElementById('account-menu').classList.toggle('hidden');
document.getElementById('settings').onclick=()=>document.getElementById('settings-modal').showModal();
const settingsModal=document.getElementById('settings-modal');
const syncNode=document.getElementById('sync-root');
const mainHost=syncNode.parentElement;
document.getElementById('close-settings').onclick=()=>settingsModal.close();
settingsModal.onclose=()=>{mainHost.appendChild(syncNode);document.getElementById('settings-sync-host').classList.add('hidden');document.querySelector('.account-card').classList.remove('hidden');};
document.getElementById('settings-sync').onclick=()=>{document.querySelector('.account-card').classList.add('hidden');const host=document.getElementById('settings-sync-host');host.classList.remove('hidden');host.appendChild(syncNode);};
document.getElementById('show-sync').onclick=()=>document.getElementById('settings-modal').close();
document.getElementById('reset').onclick=()=>{config={...structuredClone(DEFAULTS),showSidebarSync:config.showSidebarSync};scenario='fresh';activePanel='dsh-sync';lastDetail=null;lastSyncAt=0;queued=false;render();};
document.getElementById('connected').onclick=()=>{scenario='connected';activePanel='dsh-sync';config={...DEFAULTS,showSidebarSync:config.showSidebarSync,remote:'https://github.com/demo-user/dsh-sync.git'};
 lastDetail={pushed:true,committed:true,durationMs:63000,transfers:[{op:'push',size:18432}],stages:Array.from({length:70},()=>({stage:'wait-lock',ms:250}))};lastSyncAt=Date.now();render();};
document.getElementById('theme').onclick=()=>document.documentElement.classList.toggle('dark');
document.getElementById('narrow').onclick=()=>document.body.classList.toggle('narrow');
`;
const built = await build({ stdin: { contents: entry, resolveDir: path.join(root, 'work/ui-runtime'), sourcefile: 'settings-demo.js' },
  bundle: true, write: false, minify: true, define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'inline' });
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ChatSync · 首次安装设置演示</title>
<style>
:root{color-scheme:light;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;--dsw-alias-label-primary:#141619;--dsw-alias-label-secondary:#6b7078;--dsw-alias-border-l2:#e0e2e5;--dsw-alias-border-l4:#c8ccd1;--dsw-alias-accent-color:#25282d;--dsw-alias-interactive-bg-hover:#f3f4f6;font-family:"Segoe UI","Microsoft YaHei",sans-serif}
:root.dark{color-scheme:dark;--dsw-alias-bg-layer-1:#1c1d21;--dsw-alias-bg-layer-2:#25262b;--dsw-alias-label-primary:#edeef0;--dsw-alias-label-secondary:#a2a5ad;--dsw-alias-border-l2:#3b3e45;--dsw-alias-border-l4:#5a5e67;--dsw-alias-interactive-bg-hover:#303239;--dsw-alias-accent-color:#5a91eb}
*{box-sizing:border-box}body{margin:0;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}button{font:inherit;cursor:pointer;color:inherit}button:focus-visible{outline:2px solid #4385e4;outline-offset:3px}.tools{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 20px;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l2);font-size:12px}.tools span{margin-right:auto;color:var(--dsw-alias-label-secondary)}.tools button{border:1px solid var(--dsw-alias-border-l4);border-radius:7px;background:transparent;padding:6px 10px}
.shell{display:flex;height:calc(100dvh - 60px);min-height:620px;margin:auto}.sidebar{position:relative;flex:0 0 244px;background:var(--dsw-alias-interactive-bg-hover);border-right:1px solid var(--dsw-alias-border-l2);padding:22px 16px;display:flex;flex-direction:column;gap:8px}.logo{font-size:23px;font-weight:700;margin:4px 8px 22px}.logo small{font-size:10px;background:#25282d;color:white;padding:2px 4px;border-radius:3px}.nav{display:flex;align-items:center;gap:14px;min-height:44px;width:100%;border:0;background:transparent;text-align:left;padding:10px 14px;border-radius:10px}.nav.selected{background:var(--dsw-alias-border-l2);font-weight:600}.new{border:1px solid var(--dsw-alias-border-l4);justify-content:center;margin-bottom:12px;background:var(--dsw-alias-bg-layer-2)}.workspace{font-size:13px;color:var(--dsw-alias-label-secondary);margin:24px 12px 6px}.account{margin-top:auto}.account-menu{position:absolute;bottom:75px;left:16px;width:210px;background:var(--dsw-alias-bg-layer-2);padding:8px;border:1px solid var(--dsw-alias-border-l2);box-shadow:0 4px 20px #0001;border-radius:12px}.hidden,#show-sync[hidden]{display:none}.main{min-width:0;flex:1;overflow:auto;padding:28px clamp(20px,4vw,64px) 64px}.title{font-size:21px;font-weight:600;margin:0 auto 24px;max-width:960px}.main #sync-root{max-width:960px;margin:auto}.settings-dialog{color:inherit;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:22px;width:min(900px,calc(100vw - 40px));padding:26px;height:min(650px,calc(100dvh - 80px))}.settings-dialog::backdrop{background:#0005}.settings-dialog header{display:flex;justify-content:space-between;align-items:center;font-size:20px}.settings-content{display:flex;gap:28px;margin-top:28px;height:calc(100% - 76px)}.settings-sync-host{flex:1;min-width:0;overflow:auto;padding-right:8px}.settings-tabs{width:150px;display:flex;flex-direction:column;gap:8px}.settings-tabs button{background:transparent;text-align:left;border:0;padding:12px;border-radius:8px}.account-card{flex:1;padding:24px;border:1px solid var(--dsw-alias-border-l4);border-radius:16px;height:max-content}.narrow .shell{max-width:480px;border-inline:1px solid var(--dsw-alias-border-l2)}.narrow .sidebar{flex-basis:62px;padding:18px 8px}.narrow .sidebar .nav{justify-content:center;padding:10px}.narrow .nav span:last-child,.narrow .logo,.narrow .workspace{display:none}.narrow .main{padding:20px 16px}
@media(max-width:700px){.sidebar{flex-basis:62px;padding:18px 8px}.sidebar .nav{justify-content:center;padding:10px}.nav span:last-child,.logo,.workspace{display:none}.main{padding:20px 16px}.tools{padding:10px}.tools span{width:100%}.shell{height:calc(100dvh - 110px)}}
</style>
<div class="tools"><b>ChatSync 演示</b><span>使用实际插件界面与默认值；操作仅影响本页，不连接 GitHub。</span><button id="reset">重置为首次安装</button><button id="connected">查看已连接示例</button><button id="theme">明暗主题</button><button id="narrow">窄屏</button></div>
<div class="shell"><aside class="sidebar"><div class="logo">deepseek <small>HARNESS</small></div><button class="nav new"><span>⊕</span><span>新会话</span></button><div class="nav"><span>♧</span><span>插件</span></div><div class="nav"><span>▦</span><span>插件市场</span></div><div class="nav"><span>◷</span><span>自动化任务</span></div><button class="nav selected" id="show-sync"><span>⟳</span><span>同步</span></button><div class="workspace">工作区</div><div class="nav"><span>▱</span><span>尚未添加工作区</span></div><div id="account-menu" class="account-menu hidden"><button class="nav" id="settings">⚙ 设置</button></div><button id="account" class="nav account"><span>♙</span><span>账号与设置</span></button></aside><main class="main"><h1 class="title">同步</h1><div id="sync-root"></div></main></div>
<dialog id="settings-modal" class="settings-dialog"><header>设置<button id="close-settings" aria-label="关闭设置">×</button></header><div class="settings-content"><nav class="settings-tabs"><button>账号与余额</button><button>通用设置</button><button>模型</button><button>内置插件</button><button id="settings-sync">同步</button></nav><div id="settings-sync-host" class="settings-sync-host hidden"></div><div class="account-card">账号与余额<br><br>此处模拟宿主设置窗口，检查同步通知是否遮挡。</div></div></dialog>
<script>${built.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></html>`;
fs.writeFileSync(path.join(out, 'chatsync-settings-demo.html'), html);
fs.writeFileSync(path.join(out, 'first-install-defaults.json'), JSON.stringify(config, null, 2));
console.log(path.join(out, 'chatsync-settings-demo.html'));
