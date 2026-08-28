/**
 * 公共数组注册表（映射关系）。
 *
 * 公开数组 = 把模块的数组对象映射到一个三段式名字上（存引用, 不拷贝）。
 * 三段式：公共数组标记 : 模块名 : 数组名。第一段（public）与第二段（模块名）由核心自动拼装, 
 * 第三段由模块给它公开的数组起名。
 * 拉取（array(pattern)）拿到同一个被映射对象：模式不含通配符 -> 精确返回该数组的引用；
 * 模式含通配符（* / ?）-> 返回全部匹配, 形态为 { 数组全名: 引用 }。
 * 公开者消失（模块停止）-> removeOwner 取消映射 -> 数组消失。
 */

import { eventMatches } from './EventMatcher';

/** 三段式公共数组名的第一段：公共数组标记。 */
export const ARRAY_KEY_PREFIX = 'public';

/** 拼装三段式数组全名：public:模块名:数组名。 */
export function arrayKey(owner: string, name: string): string {
  return ARRAY_KEY_PREFIX + ':' + owner + ':' + name;
}

export interface PublicArray {
  name: string;
  owner: string;
  items: unknown[];
}

export class ArrayRegistry {
  private map = new Map<string, PublicArray>();

  /** 公开：把数组对象映射到三段式名字（name 为第三段, 前两段自动拼装, 存引用不拷贝）。 */
  expose(name: string, owner: string, items: unknown[] = []): void {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('shared array name must be a non-empty string');
    }
    if (!Array.isArray(items)) {
      throw new Error(`shared array ${name} content must be an array`);
    }
    const key = arrayKey(owner, name);
    if (this.map.has(key)) {
      throw new Error(`shared array already exists: ${key} (owner ${this.map.get(key)!.owner})`);
    }
    this.map.set(key, { name: key, owner, items });
  }

  /** 取消映射（仅拥有者可执行）。 */
  unexpose(name: string, owner: string): void {
    const key = arrayKey(owner, name);
    const arr = this.map.get(key);
    if (!arr) throw new Error(`shared array not found: ${key}`);
    if (arr.owner !== owner) {
      throw new Error(`shared array ${key} is owned by ${arr.owner}, ${owner} cannot unexpose it`);
    }
    this.map.delete(key);
  }

  /** 匹配拉取：模式不含通配符 -> 精确返回被映射对象引用（精确名 = 明确指定某一个数组, 
   *  不存在即调用方写错, 抛错暴露；含通配符 -> 返回 { 数组全名: 引用 } 映射（模糊查询
   *  允许合法地零命中, 返回空对象而非抛错）。 */
  get<T = any>(pattern: string): T[] | Record<string, T[]> {
    if (!pattern.includes('*') && !pattern.includes('?')) {
      const arr = this.map.get(pattern);
      if (!arr) throw new Error(`shared array not found: ${pattern}`);
      return arr.items as T[];
    }
    const out: Record<string, T[]> = {};
    for (const [key, arr] of this.map) {
      if (eventMatches(pattern, key)) out[key] = arr.items as T[];
    }
    return out;
  }

  /** 删除某拥有者的全部映射（模块停止时调用）-> 数组从注册表消失。返回被删的数组全名。 */
  removeOwner(owner: string): string[] {
    const removed: string[] = [];
    for (const [name, arr] of [...this.map]) {
      if (arr.owner === owner) {
        this.map.delete(name);
        removed.push(name);
      }
    }
    return removed;
  }
}