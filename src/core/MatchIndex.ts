/**
 * 比对索引（MatchIndex）：把"条件 -> 槽"的匹配从逐事件全量比对，变成索引查找。
 *
 * 两个概念：
 *  - 精确表：无通配符的条件，事件名相等即命中（字符串比较，零正则，O(1)）；
 *  - 通配列表：含通配符的条件，事件到达时逐条正则比对。
 * 匹配结果与 eventMatches 逐字一致（见 EventMatcher.ts）：这里只决定"测哪些条件"，
 * 不改变"怎么测"。精确条件永远 O(1) 命中；通配条件逐条测。
 */
import { patternToRegExp } from './EventMatcher';

export class MatchIndex<T> {
  private exact = new Map<string, T[]>();
  private patterns: { re: RegExp; slot: T }[] = [];

  /** 用条目重建索引：无通配符条件进精确表，含通配符条件进通配列表。 */
  rebuild(entries: { pattern: string; slot: T }[]): void {
    this.exact.clear();
    this.patterns = [];
    for (const { pattern, slot } of entries) {
      if (pattern.indexOf('*') < 0 && pattern.indexOf('?') < 0) {
        const list = this.exact.get(pattern);
        if (list) list.push(slot);
        else this.exact.set(pattern, [slot]);
      } else {
        this.patterns.push({ re: patternToRegExp(pattern), slot });
      }
    }
  }

  /** 匹配事件名：精确表 O(1) + 通配列表逐条比对。
   *  同一槽可能因多个条件命中出现多次，这里不去重——去重后的顺序由调用方
   *  （EventDispatcher.dedupSorted）统一按加载序号排，保证与全量比对结果一致。 */
  lookup(name: string): T[] {
    const out: T[] = [];
    const hit = this.exact.get(name);
    if (hit) {
      for (const slot of hit) out.push(slot);
    }
    for (const e of this.patterns) {
      if (e.re.test(name)) out.push(e.slot);
    }
    return out;
  }
}