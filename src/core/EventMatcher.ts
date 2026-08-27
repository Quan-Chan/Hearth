/**
 * 事件比对器：判断事件名（纯字符串）是否匹配模块声明的模式 —— 匹配规则的唯一来源。
 * 支持：
 *  - 精确匹配："core:startup" 只匹配 "core:startup"
 *  - 通配符 * ：匹配任意字符序列（可为空），如 "chat:*" 匹配 "chat:message"
 *  - 通配符 ? ：匹配单个字符
 *
 * 关键规则：MatchIndex 只负责"测哪些条件"，具体怎么测仍由这里的
 * patternToRegExp 逐字决定。索引只影响速度，匹配结果永远与全量比对一致。
 */
const SPECIAL_CHARS = '.*+?^${}()|[]\\';

/**
 * 编译缓存：同一条件文本只编译一次（条件集由配置驱动、数量有界）。
 * 上限防病理性超大条件集撑爆缓存：超限后现场编译，正确性不变。
 */
const MAX_CACHED_PATTERNS = 4096;
const regexCache = new Map<string, RegExp>();

export function eventMatches(pattern: string, eventName: string): boolean {
  if (typeof pattern !== 'string' || typeof eventName !== 'string') return false;
  return patternToRegExp(pattern).test(eventName);
}

/** 事件名是否匹配模式列表中的任意一个。 */
export function anyEventMatches(patterns: string[] | undefined, eventName: string): boolean {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((p) => eventMatches(p, eventName));
}

export function patternToRegExp(pattern: string): RegExp {
  const cached = regexCache.get(pattern);
  if (cached) return cached;
  let out = '^';
  for (const ch of pattern) {
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else out += SPECIAL_CHARS.includes(ch) ? '\\' + ch : ch;
  }
  const re = new RegExp(out + '$');
  if (regexCache.size < MAX_CACHED_PATTERNS) regexCache.set(pattern, re);
  return re;
}
