/**
 * 公共数组注册表。
 * 规则（对应 REQUIREMENTS.md）：
 *  - 模块选择公开自己的数组（expose），其他人可以拉取（pull）与编辑内容（edit）。
 *  - 数组名一旦公开不可改变（没有改名操作）；编辑只作用于内部内容。
 *  - 取消公开（unexpose）仅限数组拥有者（模块）自己。
 */
import type { ArrayOp } from '../types';

export interface PublicArray {
  name: string;
  owner: string;
  items: unknown[];
}

export class ArrayRegistry {
  private map = new Map<string, PublicArray>();

  /** 公开数组；重名会抛错。initial 必须是数组。 */
  expose(name: string, owner: string, initial: unknown[] = []): void {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('公共数组名必须是非空字符串');
    }
    if (!Array.isArray(initial)) {
      throw new Error(`公开数组 ${name} 的初始内容必须是数组`);
    }
    if (this.map.has(name)) {
      throw new Error(`公共数组已存在: ${name}（拥有者 ${this.map.get(name)!.owner}）`);
    }
    this.map.set(name, { name, owner, items: initial });
  }

  /** 同拥有者重新公开：重置内容（数组名保持不变）。模块重启场景。 */
  reset(name: string, owner: string, items: unknown[]): void {
    const arr = this.map.get(name);
    if (!arr) throw new Error(`公共数组不存在: ${name}`);
    if (arr.owner !== owner) {
      throw new Error(`公共数组 ${name} 的拥有者是 ${arr.owner}，${owner} 无权重置`);
    }
    arr.items.length = 0;
    arr.items.push(...items);
  }

  /** 取消公开（仅拥有者可执行）。 */
  unexpose(name: string, owner: string): void {
    const arr = this.map.get(name);
    if (!arr) throw new Error(`公共数组不存在: ${name}`);
    if (arr.owner !== owner) {
      throw new Error(`公共数组 ${name} 的拥有者是 ${arr.owner}，${owner} 无权取消公开`);
    }
    this.map.delete(name);
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  ownerOf(name: string): string | undefined {
    return this.map.get(name)?.owner;
  }

  list(): string[] {
    return [...this.map.keys()];
  }

  /** 拉取：返回深拷贝快照，调用方修改快照不影响注册表内容。 */
  pull<T = any>(name: string): T[] {
    const arr = this.map.get(name);
    if (!arr) throw new Error(`公共数组不存在: ${name}`);
    return structuredClone(arr.items) as T[];
  }

  /** 编辑内容（结构化操作）。数组名不可改变。 */
  edit(name: string, op: ArrayOp): void {
    const arr = this.map.get(name);
    if (!arr) throw new Error(`公共数组不存在: ${name}`);
    applyOp(arr.items, op);
  }
}

/** 对数组应用一个编辑操作。 */
export function applyOp(items: unknown[], op: ArrayOp): void {
  switch (op.type) {
    case 'push': {
      if (op.value !== undefined) items.push(op.value);
      if (Array.isArray(op.values)) items.push(...op.values);
      break;
    }
    case 'pop':
      items.pop();
      break;
    case 'shift':
      items.shift();
      break;
    case 'unshift':
      items.unshift(op.value);
      break;
    case 'set': {
      assertIndex(op.index, items);
      items[op.index] = op.value;
      break;
    }
    case 'removeAt': {
      assertIndex(op.index, items);
      items.splice(op.index, 1);
      break;
    }
    case 'removeValue': {
      const idx = items.findIndex((x) => deepEqual(x, op.value));
      if (idx >= 0) items.splice(idx, 1);
      break;
    }
    case 'splice': {
      assertIndex(op.index, items);
      const deleteCount = op.deleteCount ?? items.length - op.index;
      const insert = Array.isArray(op.insert) ? op.insert : [];
      items.splice(op.index, deleteCount, ...insert);
      break;
    }
    case 'clear':
      items.length = 0;
      break;
    case 'apply': {
      const fn = op.fn;
      if (typeof fn !== 'function') throw new Error('apply 操作需要 fn 函数');
      const result = fn(items);
      if (!Array.isArray(result)) throw new Error('apply 变换函数必须返回数组');
      items.length = 0;
      items.push(...result);
      break;
    }
    default:
      throw new Error(`不支持的数组操作: ${String((op as { type: string }).type)}`);
  }
}

function assertIndex(index: number, items: unknown[]): void {
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    throw new Error(`数组索引越界: ${index}（长度 ${items.length}）`);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
