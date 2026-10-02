/**
 * 会话活动探测 —— 「当前是否有会话正在生成」。
 *
 * 用途:同步后自动重启(重建工作区登记索引、修复侧栏「未分组」)如果正好赶上用户
 * 正在等回复,会把整轮对话杀掉(2026-09-13 实测)。所以自动重启前先问一句
 * 「有人在生成吗」,有就只提示、不重启。
 *
 * 判定优先级:
 *  1. agents 服务(权威):DSH 宿主的 AgentRegistry,`list()` 里 status === 'running'
 *     的会话正在被驱动(见 @deepseek-ai/dsh-agent 的 AgentStatus = 'idle' | 'running')。
 *     agents 服务在 = 它说了算,即使返回 0 个 running 也不再用文件时间兜底。
 *  2. 会话日志 mtime(兜底):agents 服务取不到时,用「会话日志在窗口内被写过」近似
 *     「这轮对话还在进行」。
 *  3. 两者都不可用 → available:false(调用方按「未知」处理,自行决定是否放行)。
 *
 * 本模块只读、无副作用,且**永不抛异常**:探测失败一律降级为「未知」,
 * 不允许因为探测把同步/重启链路弄坏。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 界面里显示的会话名长度上限(超出截断,卡片/确认框都放得下) */
export const TITLE_DISPLAY_MAX = 40;

/** 会话日志 mtime 兜底判定的默认窗口(毫秒)。模型思考/工具执行的间隙不会写日志,
 *  窗口太短会漏判「正在生成」;太长会把刚读完的会话误判成在跑(只是推迟自动重启、
 *  改为弹窗引导,代价很小)。 */
export const DEFAULT_ACTIVITY_WINDOW_MS = 120_000;

/** 兜底扫描结果缓存时长:调用方(状态接口)可能几秒问一次,避免反复扫 sessions/ */
const SCAN_CACHE_MS = 1000;
let scanCache = { key: '', at: 0, ids: [] };

const warned = new Set();     // 一次性告警去重,避免同步循环刷日志

/** 会话目录名(与 sync.js 的口径一致,避免把无关目录当会话) */
const SESSION_DIR_RE = /^session-[0-9a-f-]{36}$/i;
/** 日志文件候选:按版本优先,取存在的最高版本(兼容 v4/v5 与旧格式) */
const LOG_NAME_RES = [
  /^session\.v(\d+)\.jsonl(\.zstd)?$/i,
  /^session\.jsonl(\.zstd)?$/i,
];

function warnOnce(key, fn) {
  if (warned.has(key)) return;
  warned.add(key);
  try { fn(); } catch { /* 告警失败不影响探测 */ }
}

/* ================= 会话名(界面显示用) =================
 * 侧栏里显示的是「会话名」:宿主会话标题(dsh-session-title),或退化为工作目录名。
 * 界面提示「重启会打断哪次对话」时只给 session-<uuid> 用户无法对应,所以这里解析出名字。
 * 两类来源,都不允许抛异常:
 *   1. 宿主 agents 服务的会话对象(session.title / header.title / 会话标题服务);
 *   2. storages/session_projcache/sessions/<id>.json 的 title 投影(宿主持久化的缓存,按会话写)。
 * 名称是展示用增强项:解析不到就不给这个 id 的条目,界面自行退化为目录名/id。 */

/** 从会话对象里取一个字符串标题 */
function titleFromSessionObject(session) {
  if (!session || typeof session !== 'object') return null;
  for (const value of [session.title, session.displayTitle]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const header = session.header && typeof session.header === 'object' ? session.header : null;
  if (header && typeof header.title === 'string' && header.title.trim()) return header.title.trim();
  // 结构化标题(dsh-session-title 的快照):{ title, source, ... }
  if (session.title && typeof session.title === 'object' && typeof session.title.title === 'string') {
    return session.title.title.trim() || null;
  }
  return null;
}

/** 读会话投影缓存(storages/session_projcache/sessions/<id>.json)里的标题 */
export function readCachedSessionTitle(home, id) {
  if (!home || !id) return null;
  try {
    const file = path.join(String(home), 'storages', 'session_projcache', 'sessions', String(id) + '.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    let title = parsed?.record?.rows?.title?.val;
    if (title && typeof title === 'object') title = title.title;
    return typeof title === 'string' && title.trim() ? title.trim() : null;
  } catch { return null; }
}

/** 带前缀(如 `session-`)的 id 也按裸 uuid 找一份投影缓存 */
function cachedTitleFor(home, id) {
  return readCachedSessionTitle(home, id) || readCachedSessionTitle(home, String(id).replace(/^session-/, ''));
}

/** 裁剪到界面长度上限(按码点切片,避免截断半个字符) */
export function truncateDisplayText(text, max = TITLE_DISPLAY_MAX) {
  const s = typeof text === 'string' ? text.trim() : '';
  if (!s) return '';
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max).join('') + '…' : s;
}

/** 宿主 agents 服务里「活着」的会话对象(带服务形状容错) */
function liveAgents(agents) {
  try {
    if (Array.isArray(agents)) return agents;
    if (agents && typeof agents.list === 'function') {
      const listed = agents.list();
      return Array.isArray(listed) ? listed : [];
    }
  } catch { /* 交给调用方兜底 */ }
  return [];
}

/** 会话 id → 运行中的会话对象(优先直接命中 id,再退化为去前缀比较) */
function liveSessionObjects(agents) {
  const byId = new Map();
  for (const agent of liveAgents(agents)) {
    if (!agent || typeof agent !== 'object') continue;
    const session = agent.session && typeof agent.session === 'object' ? agent.session : null;
    const id = firstString([agent.id, agent.sessionId, session && session.id]) || null;
    if (id && !byId.has(id)) byId.set(id, session || {});
  }
  return byId;
}

/**
 * 解析「会话 id → 显示名」。解析不到某个 id 就不返回它(界面自行退化),
 * 任何一步失败都只影响这一个 id,不影响会话活动探测。
 * @param {object} ctx 宿主 cordis 上下文(可为空)
 * @param {string[]} ids 需要取名的会话 id
 * @param {string} [home] DSH home(投影缓存兜底用)
 * @returns {Record<string,string>}
 */
export function resolveSessionTitles(ctx, ids, home) {
  const wanted = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean).slice(0, 20);
  if (!wanted.length) return {};
  let agents;
  try { agents = ctx && typeof ctx.get === 'function' ? ctx.get('agents') : undefined; }
  catch { agents = undefined; }
  const live = liveSessionObjects(agents);
  const out = {};
  for (const id of wanted) {
    let title = titleFromSessionObject(live.get(id)) || titleFromSessionObject(live.get(String(id).replace(/^session-/, '')));
    if (!title) title = cachedTitleFor(home, id);
    const display = truncateDisplayText(title);
    if (display) out[id] = display;
  }
  return out;
}

/**
 * 在会话目录里挑出「当前使用的那份日志」。
 * 按版本号取最高(不做完整解码),目录枚举兼容未来新格式。
 * @param {string} dir 会话目录
 * @returns {string|null} 日志文件绝对路径
 */
export function pickSessionLogFile(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  let best = null;
  let bestVer = -1;
  for (const name of names) {
    let ver = -1;
    for (let i = 0; i < LOG_NAME_RES.length; i++) {
      const m = LOG_NAME_RES[i].exec(name);
      if (!m) continue;
      ver = m[1] ? Number(m[1]) : (name.endsWith('.zstd') ? 2 : 1);
      break;
    }
    if (ver < 0) continue;
    if (ver > bestVer) { bestVer = ver; best = name; }
  }
  return best ? path.join(dir, best) : null;
}

/**
 * 读取一个会话目录里日志文件的 mtime。
 *
 * 刻意不做缓存:会话生成是**往日志文件 append**,会话目录的 mtime 不会变,
 * 用目录 mtime 当失效键会把「用户刚开始生成」漏判成空闲(2026-10-01 回归测试
 * 实证:文件 mtime 改到 20 分钟前仍被缓存判成活跃)。一次扫描每个会话多花一次
 * stat,成本可忽略;准确性优先。
 * @param {string} dir 会话目录
 * @returns {number|null} mtimeMs
 */
function sessionLogMtime(dir) {
  const file = pickSessionLogFile(dir);
  if (!file) return null;
  try { return fs.statSync(file).mtimeMs; } catch { return null; }
}

/**
 * 枚举本机会话目录(sessions/<分组>/session-<uuid>)。
 * @param {string} home DSH home
 * @returns {string[]} 会话目录绝对路径
 */
function sessionDirs(home) {
  const root = path.join(home, 'sessions');
  const out = [];
  let groups = [];
  groups = fs.readdirSync(root, { withFileTypes: true });
  for (const group of groups) {
    if (!group.isDirectory()) continue;
    const groupDir = path.join(root, group.name);
    let entries = [];
    entries = fs.readdirSync(groupDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_DIR_RE.test(entry.name)) continue;
      out.push(path.join(groupDir, entry.name));
    }
  }
  return out;
}

/**
 * agents 服务判定:list() 里 status === 'running' 的会话。
 * 服务形状容错:宿主契约是 `{ list(): Agent[] }`,但也接受直接给出 Agent 数组
 * (未来宿主换了包装层时不会静默失效)。
 * 只认正面的 running;未知状态按「没在跑」处理(= 放行,和 dsh-market 的取向一致:
 * 未来宿主换了措辞时,宁可少拦也不要卡住自动重启)。
 * @param {unknown} agents 宿主 agents 服务(或任何带 list() 的对象/Agent 数组)
 * @param {number} now 参考时间
 * @returns {{ available: boolean, activeIds: string[] }}
 */
export function probeAgentActivity(agents, now = Date.now()) {
  if (agents === undefined || agents === null) return { available: false, activeIds: [] };
  let listed;
  try {
    if (Array.isArray(agents)) listed = agents;
    else if (typeof agents.list === 'function') listed = agents.list();
    else return { available: false, activeIds: [] };
  } catch (error) {
    warnOnce('agents-list', () => console.warn('[dsh-chatsync] agents.list() 异常,会话活动按未知处理: ' + describe(error)));
    return { available: false, activeIds: [] };
  }
  if (!Array.isArray(listed)) return { available: false, activeIds: [] };
  const activeIds = [];
  for (const agent of listed) {
    if (!agent || typeof agent !== 'object') continue;
    if (agent.status !== 'running') continue;
    const session = agent.session && typeof agent.session === 'object' ? agent.session : null;
    const header = session && session.header && typeof session.header === 'object' ? session.header : null;
    const id = firstString([agent.id, agent.sessionId, session && session.id, header && header.id]) || 'unknown';
    if (!activeIds.includes(id)) activeIds.push(id);
  }
  void now;
  return { available: true, activeIds };
}

/**
 * 文件兜底判定:会话日志在窗口内被写过 = 疑似正在生成。
 * @param {object} opts { home, now, activityWindowMs, sessionIds }
 * @returns {{ available: boolean, activeIds: string[] }}
 */
export function probeLogActivity({ home, now = Date.now(), activityWindowMs = DEFAULT_ACTIVITY_WINDOW_MS, sessionIds } = {}) {
  let ids = Array.isArray(sessionIds) ? sessionIds : null;
  if (!ids && home) {
    const key = path.resolve(String(home));
    if (scanCache.key !== key || now - scanCache.at > SCAN_CACHE_MS) {
      let dirs = [];
      try { dirs = sessionDirs(key); } catch { return { available: false, activeIds: [] }; }
      const found = [];
      for (const dir of dirs) {
        const mtimeMs = sessionLogMtime(dir);
        if (mtimeMs === null) return { available: false, activeIds: [] };
        const m = SESSION_DIR_RE.exec(path.basename(dir));
        found.push({ id: m ? m[0] : path.basename(dir), mtimeMs });
      }
      scanCache = { key, at: now, ids: found };
    }
    ids = scanCache.ids;
  }
  if (!Array.isArray(ids)) return { available: false, activeIds: [] };
  const activeIds = [];
  for (const item of ids) {
    // 支持两种输入:字符串 id(无法判时间,mtime 当 0 → 不活跃)或 { id, mtimeMs }
    const id = typeof item === 'string' ? item : (item && typeof item === 'object' ? item.id : null);
    const mtimeMs = typeof item === 'string' ? 0 : (item && typeof item === 'object' && Number.isFinite(item.mtimeMs) ? item.mtimeMs : 0);
    if (!id) continue;
    const age = now - mtimeMs;
    if (age >= 0 && age <= activityWindowMs) activeIds.push(String(id));
  }
  return { available: true, activeIds };
}

/**
 * 对外主入口:优先权威的 agents 服务,取不到再用会话日志时间兜底。
 * @param {object} ctx 宿主 cordis 上下文(可为 null;取 ctx.get('agents'))
 * @param {object} opts { home, now, activityWindowMs, sessionIds, titles }
 * @param {boolean} [opts.titles] 是否附带「会话 id → 显示名」映射(界面提示用)
 * @returns {{ available: boolean, activeCount: number, activeIds: string[], source: 'agents'|'log-activity'|'none', checkedAt: number, titles?: Record<string,string>, error?: string }}
 */
export function probeSessionActivity(ctx, opts = {}) {
  const now = Number.isFinite(opts.now) ? Number(opts.now) : Date.now();
  const activityWindowMs = Number.isFinite(opts.activityWindowMs) && opts.activityWindowMs > 0
    ? Number(opts.activityWindowMs)
    : DEFAULT_ACTIVITY_WINDOW_MS;
  /* 会话名只在调用方明确要求时解析(状态接口);同步/重启守卫路径不需要,避免多余的文件读取 */
  const withTitles = (result) => (opts.titles === true && result.activeCount > 0
    ? { ...result, titles: resolveSessionTitles(ctx, result.activeIds, opts.home) }
    : result);
  const unknown = (error) => ({
    available: false, activeCount: 0, activeIds: [], source: 'none', checkedAt: now,
    ...(error ? { error: String(error).slice(0, 200) } : {}),
  });
  try {
    let agents;
    try { agents = ctx && typeof ctx.get === 'function' ? ctx.get('agents') : undefined; }
    catch (error) {
      warnOnce('ctx-get', () => console.warn('[dsh-chatsync] ctx.get("agents") 异常,改用会话日志兜底: ' + describe(error)));
      agents = undefined;
    }
    const viaAgents = probeAgentActivity(agents, now);
    if (viaAgents.available) {
      return withTitles({
        available: true,
        activeCount: viaAgents.activeIds.length,
        activeIds: viaAgents.activeIds,
        source: 'agents',
        checkedAt: now,
      });
    }
    if (opts.home || Array.isArray(opts.sessionIds)) {
      const viaLogs = probeLogActivity({ home: opts.home, now, activityWindowMs, sessionIds: opts.sessionIds });
      if (viaLogs.available) {
        return withTitles({
          available: true,
          activeCount: viaLogs.activeIds.length,
          activeIds: viaLogs.activeIds,
          source: 'log-activity',
          checkedAt: now,
        });
      }
    }
    return unknown();
  } catch (error) {
    warnOnce('probe', () => console.warn('[dsh-chatsync] 会话活动探测异常,按未知处理: ' + describe(error)));
    return unknown(error && error.message);
  }
}

/** 会话活动状态 → 一行中文说明(日志/接口/UI 共用同一口径) */
export function describeSessionActivity(activity) {
  if (!activity || activity.available !== true) return '会话活动未知(宿主未提供 agents 服务,也没读到会话日志)';
  if (activity.activeCount > 0) {
    const ids = Array.isArray(activity.activeIds) ? activity.activeIds.slice(0, 3) : [];
    const source = activity.source === 'agents' ? '正在生成' : '最近有写入(疑似正在生成)';
    // 有会话名就用名字(用户能对上侧栏),没有才退回 id
    const named = activity.titles && typeof activity.titles === 'object'
      ? ids.map((id) => activity.titles[id]).filter((t) => typeof t === 'string' && t)
      : [];
    const shown = named.length === ids.length && named.length ? named : ids;
    return shown.length
      ? `检测到 ${activity.activeCount} 个会话${source}: ${shown.join(', ')}${activity.activeCount > shown.length ? ' …' : ''}`
      : `检测到 ${activity.activeCount} 个会话${source}`;
  }
  return '当前没有会话在生成';
}

function firstString(values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function describe(error) {
  return String((error && error.message) || error);
}

/** 测试用:清空模块级缓存(不影响生产逻辑) */
export function resetActivityCaches() {
  scanCache = { key: '', at: 0, ids: [] };
  warned.clear();
}
