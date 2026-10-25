// Part of the SyncEngine (lib/sync.js); moved verbatim from lib/sync.js.
import fs from 'node:fs';
import path from 'node:path';
import { sessionLogGeneration } from '../session-path.js';

// zstd 解码(读会话头用):运行时有 zstd 才可用;旧版本自动降级
export let zstdDecompressSync = null;
try { ({ zstdDecompressSync } = await import('node:zlib')); } catch { zstdDecompressSync = null; }
/** zstd 帧魔数(小端 0xFD2FB528) */
export const ZSTD_MAGIC = Buffer.from([0x28, 0xB5, 0x2F, 0xFD]);
/**
 * 会话日志文件候选名(按优先级,新的在前)。DSH 迭代过四代命名:
 *   session.jsonl[.zstd](v0) → session.v1.jsonl[.zstd] → … → session.v4.jsonl[.zstd]
 *   格式版本与是否压缩无关；无版本号的名字表示原始第 0 代。
 * 登记表自查 / 幽灵清理 / 会话预览 / 冲突预览共用这一份口径 —— 任何一处漏项都会
 * 让「本机明明有这个会话」被误判为幽灵。
 * 保留本常量仅作向后兼容与预览兜底;真正的文件选择请用 pickSessionLog()
 * (按目录枚举,未来 v5+ 自动兼容,不依赖白名单)。
 */
export const SESSION_LOG_NAMES = ['session.v4.jsonl.zstd', 'session.v3.jsonl.zstd', 'session.jsonl.zstd', 'session.jsonl'];
/** 会话日志文件名(不含路径)匹配:session[.vN].jsonl[.zstd] —— v4/v3/v2 与未来 v5+ 都覆盖 */
export const SESSION_LOG_FILE_RE = /^(?:session|log)(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/i;
/**
 * 在会话目录里枚举日志文件,返回「最新格式」的文件绝对路径(找不到返回 null)。
 * 按格式代际 N 降序，无版本号为第 0 代；最高代有多份时返回 null。
 * 未知未来版本仍可发现，能否应用由宿主格式接口决定。
 */
export function pickSessionLog(sdir) {
  let names = [];
  try { names = fs.readdirSync(sdir); } catch { return null; }
  let best = null;
  let bestVer = -1, ambiguous = false;
  for (const name of names) {
    const m = SESSION_LOG_FILE_RE.exec(name);
    if (!m) continue;
    const p = path.join(sdir, name);
    try { if (!fs.statSync(p).isFile()) continue; } catch { continue; }
    const ver = sessionLogGeneration(name);
    if (ver === null) continue;
    if (ver === bestVer) ambiguous = true;
    if (ver > bestVer) { bestVer = ver; best = p; ambiguous = false; }
  }
  return ambiguous ? null : best;
}
/**
 * 会话「开始过轮次」的事件类型 —— DSH 用它把会话从空白(blank)翻成非空白。
 * 口径见 @deepseek-ai/dsh-api-session-controller/lib/types/list.js:
 *   blank = state.blank && event.type !== 'turn/start'
 */
const TURN_START_TYPE = 'turn/start';
/** JSONL 文本里是否含 turn/start 事件:按行解析,避免正文里出现同名字符串被误判。 */
export function textHasTurnStart(text) {
  for (const line of text.split('\n')) {
    if (!line.includes(TURN_START_TYPE)) continue;
    try { if (JSON.parse(line)?.type === TURN_START_TYPE) return true; } catch { /* 不完整行由调用方 carry */ }
  }
  return false;
}
