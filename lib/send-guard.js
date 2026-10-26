import { sessionIdPattern } from './session-path.js';
import fs from 'node:fs';
import path from 'node:path';
import { scopeMirrorPath } from './scope.js';

// A boot barrier: only checked and applied history releases an old session.
// A later write by another device is outside this fetched snapshot's guarantee.
export function createSendGuard(engine) {
  let connection = null,
    old = new Set(),
    checked = new Set();
  const excluded = id => {
    // An explicitly excluded local original has no inbound sync to wait for.
    // Use Git's actual matcher (including negations), never a partial glob parser.
    if (typeof engine.home !== 'string' || typeof engine.scanSessions !== 'function') return false;
    const cfg = engine.loadConfig(),
      folder = scopeMirrorPath(engine.home, cfg);
    const gitdir = fs.existsSync(path.join(engine.home, '.git'))
      ? path.join(engine.home, '.git')
      : path.join(folder, '.git');
    if (!fs.existsSync(gitdir) || typeof engine.gitSync !== 'function') return false;
    const files = engine
      .scanSessions()
      .filter(session => session.id === id)
      .map(session => path.relative(engine.home, session.file).replaceAll('\\', '/'));
    return (
      files.length > 0 &&
      files.every(
        file =>
          engine.gitSync([
            '-C',
            engine.home,
            '--git-dir=' + gitdir,
            '--work-tree=' + engine.home,
            'check-ignore',
            '--no-index',
            '-q',
            '--',
            file,
          ]).code === 0,
      )
    );
  };
  const refresh = () => {
    const cfg = engine.loadConfig();
    const key = JSON.stringify([cfg.remote, cfg.branch, cfg.enabled, cfg.autoPullOnStart, cfg.contentScope?.sessions]);
    if (key !== connection) {
      connection = key;
      old = new Set(engine.localSessionIds());
      checked = new Set();
    }
    return Boolean(
      cfg.remote && cfg.enabled !== false && cfg.autoPullOnStart !== false && cfg.contentScope?.sessions !== false,
    );
  };
  refresh();
  return {
    require(ids) {
      refresh();
      for (const id of ids) {
        old.add(id);
        checked.delete(id);
      }
    },
    verify(ids) {
      refresh();
      for (const id of ids) checked.add(id);
    },
    check(id) {
      if (typeof id !== 'string' || !sessionIdPattern.test(id))
        return { allowed: false, message: '无法识别会话，消息未发送。' };
      if (!refresh() || !old.has(id) || checked.has(id) || excluded(id)) return { allowed: true };
      return {
        allowed: false,
        sessionId: id,
        message: '这条旧会话尚未完成启动同步，消息未发送。输入内容和附件已保留；同步完成后请查看最新对话，再次发送。',
      };
    },
  };
}

// Protect the public admission method before Agent resume, attachment import
// and message enqueue. Retain the caller's Cordis context and restore on unload.
export function protectPrompt(controller, guard) {
  if (typeof controller?.prompt !== 'function') throw new Error('宿主缺少会话发送入口，无法安装同步发送保护');
  const original = controller.prompt;
  function protectedPrompt(request, ...args) {
    const state = guard.check(request?.sessionId);
    if (!state.allowed) throw new Error(state.message);
    return original.call(this, request, ...args);
  }
  controller.prompt = protectedPrompt;
  return () => {
    if (controller.prompt === protectedPrompt) controller.prompt = original;
  };
}
