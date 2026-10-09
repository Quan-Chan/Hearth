/**
 * 公共对象注册表（映射关系）。
 *
 * 公开对象 = 把模块的对象映射到一个三段式名字上（存引用, 不拷贝）。
 * 三段式：公共对象标记 : 模块名 : 对象名。第一段（public）与第二段（模块名）由核心自动拼装,
 * 第三段由模块给它公开的对象起名。
 * 拉取（object(pattern)）拿到同一个被映射对象：模式不含通配符 -> 精确返回该对象的引用；
 * 模式含通配符（* / ?）-> 返回全部匹配, 形态为 { 对象全名: 引用 }。
 * 公开者消失（模块停止）-> removeOwner 取消映射 -> 对象消失。
 *
 * 取值规则：公开的是对象本身（引用），对象内部的字段由公开者与使用者自行商定；
 * 对象里放数组是常见用法，注册表不限制字段形状，只要求取值是非 null 的对象。
 */

import { eventMatches } from './EventMatcher';
import { naturalCompare } from './ConfigWatcher';

/** 三段式公共对象名的第一段：公共对象标记。 */
export const OBJECT_KEY_PREFIX = 'public';

/** 拼装三段式对象全名：public:模块名:对象名。 */
export function objectKey(owner: string, name: string): string {
  return OBJECT_KEY_PREFIX + ':' + owner + ':' + name;
}

export interface PublicObject {
  name: string;
  owner: string;
  value: object;
}

export class ObjectRegistry {
  private map = new Map<string, PublicObject>();

  /** 公开：把对象映射到三段式名字（name 为第三段, 前两段自动拼装, 存引用不拷贝）。 */
  expose(name: string, owner: string, value: object = {}): void {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('shared object name must be a non-empty string');
    }
    if (name.includes(':')) {
      throw new Error('shared object name must not contain ":" (reserved for name separator): ' + name);
    }
    if (typeof value !== 'object' || value === null) {
      throw new Error(`shared object ${name} value must be an object`);
    }
    const key = objectKey(owner, name);
    if (this.map.has(key)) {
      throw new Error(`shared object already exists: ${key} (owner ${this.map.get(key)!.owner})`);
    }
    this.map.set(key, { name: key, owner, value });
  }

  /** 取消映射（仅拥有者可执行）。 */
  unexpose(name: string, owner: string): void {
    const key = objectKey(owner, name);
    const obj = this.map.get(key);
    if (!obj) throw new Error(`shared object not found: ${key}`);
    if (obj.owner !== owner) {
      throw new Error(`shared object ${key} is owned by ${obj.owner}, ${owner} cannot unexpose it`);
    }
    this.map.delete(key);
  }

  /** 匹配拉取：模式不含通配符 -> 精确返回被映射对象引用（精确名 = 明确指定某一个对象,
   *  不存在即调用方写错, 抛错暴露；含通配符 -> 返回 { 对象全名: 引用 } 映射（模糊查询
   *  允许合法地零命中, 返回空对象而非抛错）。 */
  get<T extends object = Record<string, unknown>>(pattern: string): T | Record<string, T> {
    if (!pattern.includes('*') && !pattern.includes('?')) {
      const obj = this.map.get(pattern);
      if (!obj) throw new Error(`shared object not found: ${pattern}`);
      return obj.value as T;
    }
    const out: Record<string, T> = {};
    const keys: string[] = [];
    for (const key of this.map.keys()) {
      if (eventMatches(pattern, key)) keys.push(key);
    }
    // 键按自然排序（与模块加载顺序同一规则），结果顺序稳定可预测
    keys.sort(naturalCompare);
    for (const key of keys) out[key] = this.map.get(key)!.value as T;
    return out;
  }

  /** 删除某拥有者的全部映射（模块停止时调用）-> 对象从注册表消失。返回被删的对象全名。 */
  removeOwner(owner: string): string[] {
    const removed: string[] = [];
    for (const [name, obj] of [...this.map]) {
      if (obj.owner === owner) {
        this.map.delete(name);
        removed.push(name);
      }
    }
    return removed;
  }
}
