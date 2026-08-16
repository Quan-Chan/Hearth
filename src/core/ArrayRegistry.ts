/**
 * 公共数组注册表（映射语义）。
 *
 * 公开数组 = 把模块的数组对象"映射"到一个名字上（存引用，不拷贝）。
 * 其他模块 array(name) 拿到的是同一个被映射对象 -> 原生数组语法、O(1)、一次修改处处有效。
 * 公开者消失（模块停止）-> removeOwner 取消映射 -> 数组自然消失，不留残档。
 * 数组名一旦公开不可改变（没有改名操作）。
 */
import type { ArrayOp } from '../types';

export interface PublicArray {
  name: string;
  owner: string;
  /** 被映射的数组对象（注册表持有引用，所有模块共享同一对象） */
  items: unknown[];
}

export class ArrayRegistry {
  private map = new Map<string, PublicArray>();

  /** 公开：把数组对象映射到名字（存引用，不拷贝）。 */
  expose(name: string, owner: string, items: unknown[] = []): void {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('公共数组名必须是非空字符串');
    }
    if (!Array.isArray(items)) {
      throw new Error(`公开数组 ${name} 的内容必须是数组`);
    }
    if (this.map.has(name)) {
      throw new Error(`公共数组已存在: ${name}（拥有者 ${this.map.get(name)!.owner}）`);
    }
    this.map.set(name, { name, owner, items });
  }

  /** 取消映射（仅拥有者可执行）。 */
  unexpose(name: string, owner: string): void {
    const arr = this.map.get(name);
    if (!arr) throw new Error(`公共数组不存在: ${name}`);
    if (arr.owner !== owner) {
      throw new Error(`公共数组 ${name} 的拥有者是 ${arr.owner}，${owner} 无权取消公开`);
    }
    this.map.delete(name);
  }

  /** 获取被映射的数组对象（O(1) 返回引用，直接原生使用）。 */
  get<T = any>(name: string): T[] {
    const arr = this.map.get(name);
    if (!arr) throw new Error(`公共数组不存在: ${name}`);
    return arr.items as T[];
  }

  /** 显式深拷贝快照（需要数据隔离的场合才用）。 */
  snapshot<T = any>(name: string): T[] {
    return structuredClone(this.get(name)) as T[];
  }

  /** 编辑内容（受控操作；内部直接改被映射对象）。数组名不可改变。 */
  edit(name: string, op: ArrayOp): void {
    applyOp(this.get(name), op);
  }

  /** 删除某拥有者的全部映射（模块停止时调用）-> 数组从注册表消失。返回被删的数组名。 */
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

  has(name: string): boolean {
    return this.map.has(name);
  }

  ownerOf(name: string): string | undefined {
    return this.map.get(name)?.owner;
  }

  list(): string[] {
    return [...this.map.keys()];
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
