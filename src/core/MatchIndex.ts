/**
 * 比对索引（MatchIndex）：把"条件 -> 槽"的匹配从逐事件全量比对，变成索引查找。
 *
 * 三档入座：
 *  - 精确表：无通配符的条件，事件名相等即命中（字符串比较，零正则）；
 *  - 前缀桶：有通配符的条件，按首个 * / ? 之前的字面部分分桶；事件到达时只测
 *    "事件名前缀恰好是桶键"的桶（避免与全部条件对比）；以通配符开头的条件进全局桶；
 *  - 溢出表：字节预算耗尽后余下的条件，只存模式文本引用，事件到达时现场编译比对
 *    （正确性不变，仅这些条件退化）。
 *
 * 字节预算：用空间换时间的总阀门。估算模型由实测标定（每条编译条目 ≈ 900B + 模式
 * 长度×2；桶键 ≈ 100B；精确条目 ≈ 100B），建索引时逐条记账，累计超预算即停止索引、
 * 余下进溢出表。预算只算"新增内存"（编译正则 + 索引条目 + 桶键）；模式文本本身
 * 存在于模块配置对象中，不算新增。超限是降级不是报错。
 *
 * 语义与 eventMatches 逐字一致：桶分组只改变"测哪些条件"，不改变"怎么测"。
 */
import { patternToRegExp } from './EventMatcher';

/** 每条已编译索引条目的估算字节数（实测标定：gc 后 10000 条 ≈ 580B/条，取 650 留余量）。 */
const BYTES_PER_COMPILED_ENTRY = 650;
/** 每个桶键的估算字节数。 */
const BYTES_PER_BUCKET_KEY = 100;
/** 每个精确表条目的估算字节数（无需正则，仅条目开销）。 */
const BYTES_PER_EXACT_ENTRY = 100;

interface BucketEntry<T> {
  re: RegExp;
  slot: T;
}

interface OverflowEntry<T> {
  pattern: string;
  slot: T;
}

/** 索引状态统计（CLI index 指令展示用）。 */
export interface MatchIndexStats {
  /** 字节预算 */
  budgetBytes: number;
  /** 已记账的字节 */
  usedBytes: number;
  /** 入索引的条件数（精确+桶+全局） */
  indexedPatterns: number;
  /** 预算耗尽退入溢出表的条件数 */
  overflowPatterns: number;
  /** 精确条件数 */
  exactPatterns: number;
  /** 桶条件数 */
  bucketPatterns: number;
  /** 全局桶条件数 */
  globalPatterns: number;
  /** 前缀桶数 */
  buckets: number;
}

export class MatchIndex<T> {
  private exact = new Map<string, T[]>();
  private buckets = new Map<string, BucketEntry<T>[]>();
  private global: BucketEntry<T>[] = [];
  private overflow: OverflowEntry<T>[] = [];
  private budgetBytes = 0;
  private usedBytes = 0;
  private exactCount = 0;
  private bucketCount = 0;
  private globalCount = 0;

  /** 用条目与预算重建索引（预算耗尽后余下条目进溢出表）。 */
  rebuild(entries: { pattern: string; slot: T }[], budgetBytes: number): void {
    this.exact.clear();
    this.buckets.clear();
    this.global = [];
    this.overflow = [];
    this.budgetBytes = budgetBytes;
    this.usedBytes = 0;
    this.exactCount = 0;
    this.bucketCount = 0;
    this.globalCount = 0;
    for (const { pattern, slot } of entries) {
      this.addEntry(pattern, slot);
    }
  }

  private addEntry(pattern: string, slot: T): void {
    if (pattern.indexOf('*') < 0 && pattern.indexOf('?') < 0) {
      // 精确条件：事件名相等即命中，无需正则
      const cost = BYTES_PER_EXACT_ENTRY + pattern.length * 2;
      if (this.usedBytes + cost > this.budgetBytes) {
        this.overflow.push({ pattern, slot });
        return;
      }
      this.usedBytes += cost;
      const list = this.exact.get(pattern);
      if (list) list.push(slot);
      else this.exact.set(pattern, [slot]);
      this.exactCount++;
      return;
    }
    // 通配条件：按首个 * / ? 之前的字面部分分桶
    let k = 0;
    while (k < pattern.length && pattern[k] !== '*' && pattern[k] !== '?') k++;
    const key = pattern.slice(0, k);
    const cost = BYTES_PER_COMPILED_ENTRY + pattern.length * 2;
    if (this.usedBytes + cost > this.budgetBytes) {
      this.overflow.push({ pattern, slot });
      return;
    }
    this.usedBytes += cost;
    const entry: BucketEntry<T> = { re: patternToRegExp(pattern), slot };
    if (key.length === 0) {
      this.global.push(entry);
      this.globalCount++;
      return;
    }
    let list = this.buckets.get(key);
    if (!list) {
      this.usedBytes += BYTES_PER_BUCKET_KEY + key.length * 2;
      list = [];
      this.buckets.set(key, list);
    }
    list.push(entry);
    this.bucketCount++;
  }

  /**
   * 匹配事件名：精确表 O(1) + 前缀桶（只测事件名前缀恰好是桶键的桶）+ 全局桶 + 溢出表。
   * 同一槽可能因多个条件命中而出现多次，调用方按需去重。
   */
  lookup(name: string): T[] {
    const out: T[] = [];
    const hit = this.exact.get(name);
    if (hit) {
      for (const slot of hit) out.push(slot);
    }
    if (this.buckets.size > 0) {
      let key = '';
      for (let i = 0; i < name.length; i++) {
        key += name[i];
        const list = this.buckets.get(key);
        if (list) {
          for (const e of list) {
            if (e.re.test(name)) out.push(e.slot);
          }
        }
      }
    }
    for (const e of this.global) {
      if (e.re.test(name)) out.push(e.slot);
    }
    for (const e of this.overflow) {
      if (patternToRegExp(e.pattern).test(name)) out.push(e.slot);
    }
    return out;
  }

  /** 当前索引状态统计。 */
  stats(): MatchIndexStats {
    return {
      budgetBytes: this.budgetBytes,
      usedBytes: this.usedBytes,
      indexedPatterns: this.exactCount + this.bucketCount + this.globalCount,
      overflowPatterns: this.overflow.length,
      exactPatterns: this.exactCount,
      bucketPatterns: this.bucketCount,
      globalPatterns: this.globalCount,
      buckets: this.buckets.size,
    };
  }
}
