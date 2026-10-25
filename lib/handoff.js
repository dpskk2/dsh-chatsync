import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LOCAL_DATA, safePath, digest } from './recovery.js';
import { normalizeScope } from './scope.js';
import { queuedDataRepairs, pendingDataVerification } from './data-health.js';

const DEVICE_RE = /^[0-9a-f-]{36}$/;
const HEAD_RE = /^[0-9a-f]{40,64}$/;
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const connectionKey = cfg => digest(Buffer.from(JSON.stringify([cfg.remote, cfg.branch])));

export function handoffStatus(engine) {
  const saved = engine.readHandoff();
  if (!saved || saved.connectionKey !== connectionKey(engine.loadConfig())) return null;
  return { ...saved, peers: (saved.peers || []).filter(p => Date.now() - p.appliedAt < MAX_AGE) };
}

// Receipts live in separate branches, never in DSH's working tree or settings.
// They confirm Git content at a point in time, not that the host UI opened it.
export async function recordHandoff(engine, result) {
  const cfg = engine.loadConfig();
  if (engine.skipHandoff || !cfg.remote || result.error || result.cancelled || result.deferred || result.needsReview
    || result.downloadPending || result.sessionDeferred?.length || result.scopeWarnings?.length
    || result.sessionWarnings?.length || engine.hasPendingSessionImport() || queuedDataRepairs(engine).length
    || pendingDataVerification(engine).length || result.workspaces?.errors?.length) return;
  if (engine._verifiedPrivateRemote !== cfg.remote) throw new Error('回执目标尚未验证为私有仓库');
  if (cfg.branch.startsWith('chatsync-device/') || cfg.workspaceBranchPrefix === 'chatsync-device') throw new Error('同步分支与设备回执保留目录重名');
  const transport = engine._transport || engine;
  const head = await transport.rev('HEAD');
  if (!head) return;
  const remoteHead = await transport.rev('refs/remotes/origin/' + cfg.branch);
  // A newer peer commit does not invalidate our previously applied ancestor.
  // An upload result, however, must describe the exact uploaded local commit.
  if (!remoteHead || (remoteHead !== head && (result.pushed || !await transport.isAncestor(head, remoteHead))))
    throw new Error('本机提交与已传输内容不一致，暂不发布交接回执');
  const actor = engine.actorId();
  if (!DEVICE_RE.test(actor)) throw new Error('设备标识无效');
  const scope = { main: head, workspaces: {}, content: normalizeScope(cfg.contentScope) };
  if (cfg.workspaceSync !== false) {
    for (const ws of engine.workspaces()) {
      const root = engine.workspaceRealPathOf(ws, cfg), dir = engine.workspaceGitDir(ws.id);
      if (root && fs.existsSync(dir)) {
        const sha = await engine.rev('HEAD', dir, root);
        if (sha) {
          const remoteSha = await engine.rev('refs/remotes/origin/' + engine.workspaceBranchOf(cfg, ws.id), dir, root);
          if (!remoteSha || (remoteSha !== sha && !await engine.isAncestor(sha, remoteSha, dir, root)))
            throw new Error('项目提交与已传输内容不一致，暂不发布交接回执');
          scope.workspaces[ws.id] = sha;
        }
      }
    }
  }
  const dir = safePath(engine.home, LOCAL_DATA + '/handoff');
  fs.mkdirSync(dir, { recursive: true });
  const previous = handoffStatus(engine);
  const didUpload = result.pushed || result.workspaces?.pushed > 0;
  // pluginVersion lets other computers check that everyone runs a version that no
  // longer syncs machine-only files before removing them from the shared tree.
  const receipt = { format: 1, applicationVerified: true, deviceId: actor, deviceName: '设备 ' + actor.slice(0, 8), branch: cfg.branch,
    appliedAt: Date.now(), pluginVersion: engine.pluginVersion(), scope };
  const gitdir = safePath(dir, 'receipt.git'), worktree = safePath(dir, 'outbox');
  fs.mkdirSync(worktree, { recursive: true });
  const call = args => engine.gitW(gitdir, worktree, args);
  if (!fs.existsSync(gitdir)) {
    if (!engine.ok(await engine.git(['init', '--bare', gitdir]))) throw new Error('无法建立交接记录');
    await call(['symbolic-ref', 'HEAD', 'refs/heads/chatsync-device/' + actor]);
    await call(['config', 'user.name', 'ChatSync']);
    await call(['config', 'user.email', 'chatsync@localhost']);
    await call(['config', 'commit.gpgsign', 'false']);
  }
  // Keep idempotent receipts to avoid a new commit when nothing changed.
  const file = safePath(worktree, 'receipt.json');
  let prior;
  try { prior = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (prior?.branch === receipt.branch && JSON.stringify(prior.scope) === JSON.stringify(scope)
    && Number.isSafeInteger(prior.appliedAt) && Date.now() - prior.appliedAt < MAX_AGE / 2) receipt.appliedAt = prior.appliedAt;
  fs.writeFileSync(file, JSON.stringify(receipt) + '\n');
  if (!engine.ok(await call(['add', '--', 'receipt.json']))) throw new Error('无法暂存交接记录');
  const dirty = await call(['diff', '--cached', '--quiet']);
  if (dirty.code !== 0 && dirty.code !== 1) throw new Error('无法检查交接记录');
  if (dirty.code === 1 && !engine.ok(await call(['commit', '-m', 'ChatSync device receipt']))) throw new Error('无法保存交接记录');
  // Pass the remote URL as an argument, never interpolate it into a shell command.
  const push = await call(['push', cfg.remote, 'HEAD:refs/heads/chatsync-device/' + actor]);
  const fetched = await transport.git(['fetch', cfg.remote, '+refs/heads/chatsync-device/*:refs/chatsync-devices/*', '--prune']);
  const peers = [];
  if (engine.ok(fetched)) {
    const refs = await transport.git(['for-each-ref', '--format=%(refname)', 'refs/chatsync-devices/']);
    for (const ref of refs.out.trim().split('\n').slice(0, 100)) {
      const id = ref.split('/').at(-1);
      if (!DEVICE_RE.test(id) || id === actor) continue;
      const r = await transport.gitBytes(['show', ref + ':receipt.json']);
      if (!engine.ok(r) || r.out.length > 64 * 1024) continue;
      let peer;
      try { peer = JSON.parse(r.out.toString('utf8')); } catch { continue; }
      if (peer.format !== 1 || peer.applicationVerified !== true || peer.deviceId !== id || peer.branch !== cfg.branch || !HEAD_RE.test(peer.scope?.main || '')
        || !Number.isSafeInteger(peer.appliedAt) || peer.appliedAt > Date.now() + 60_000 || Date.now() - peer.appliedAt > MAX_AGE) continue;
      // A receipt for an ancestor is not evidence that the peer has our new commit.
      const target = didUpload ? scope : previous?.uploaded?.scope;
      if (!target || !(await transport.isAncestor(target.main, peer.scope.main))) continue;
      const mainComplete = Object.entries(target.content || normalizeScope(null)).every(([key, enabled]) => !enabled || peer.scope.content?.[key] === true);
      const workspaceComplete = Object.entries(target.workspaces).every(([key, sha]) => peer.scope.workspaces?.[key] === sha);
      peers.push({ deviceId: id, deviceName: '设备 ' + id.slice(0, 8), appliedAt: peer.appliedAt,
        main: peer.scope.main, exactMain: target.main === peer.scope.main, mainComplete, workspaceComplete });
    }
  }
  const state = { connectionKey: connectionKey(cfg), deviceId: actor, deviceName: receipt.deviceName,
    checkedAt: Date.now(), scope, uploaded: didUpload ? { at: Date.now(), scope } : previous?.uploaded || null,
    received: result.pulled ? { at: Date.now(), scope } : previous?.received || null,
    receiptPublished: engine.ok(push), peers,
    warning: !engine.ok(push) || !engine.ok(fetched) ? '数据传输已完成，设备回执传输失败，请下次同步重试' : null,
    meaning: '回执证明仓库内容已应用，不代表宿主界面或附件已完成实机验收；回执 30 天后过期' };
  const stateFile = safePath(engine.home, LOCAL_DATA + '/handoff.json');
  const temp = stateFile + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' }); fs.renameSync(temp, stateFile); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
