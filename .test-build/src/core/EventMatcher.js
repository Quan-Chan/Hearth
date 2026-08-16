"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventMatches = eventMatches;
exports.anyEventMatches = anyEventMatches;
exports.patternToRegExp = patternToRegExp;
/**
 * 事件比对器：判断事件名（纯字符串）是否匹配模块声明的模式。
 * 支持：
 *  - 精确匹配："core:startup" 只匹配 "core:startup"
 *  - 通配符 * ：匹配任意字符序列（可为空），如 "chat:*" 匹配 "chat:message"
 *  - 通配符 ? ：匹配单个字符
 */
const SPECIAL_CHARS = '.*+?^${}()|[]\\';
function eventMatches(pattern, eventName) {
    if (typeof pattern !== 'string' || typeof eventName !== 'string')
        return false;
    return patternToRegExp(pattern).test(eventName);
}
/** 事件名是否匹配模式列表中的任意一个。 */
function anyEventMatches(patterns, eventName) {
    if (!patterns || patterns.length === 0)
        return false;
    return patterns.some((p) => eventMatches(p, eventName));
}
function patternToRegExp(pattern) {
    let out = '^';
    for (const ch of pattern) {
        if (ch === '*')
            out += '.*';
        else if (ch === '?')
            out += '.';
        else
            out += SPECIAL_CHARS.includes(ch) ? '\\' + ch : ch;
    }
    return new RegExp(out + '$');
}
