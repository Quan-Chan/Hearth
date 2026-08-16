/**
 * 模块上下文：框架核心提供给模块的 API 面。
 * 对应 REQUIREMENTS.md 第 3 节"模块内方法"：
 *   1. 接收事件信息（onEvent 由核心调用）
 *   2. 公开数组        -> exposeArray
 *   3. 取消公开数组    -> unexposeArray
 *   4. 拉取特定数组    -> pullArray
 *   5. 编辑特定数组    -> editArray
 */
import type { ConnectCore } from './ConnectCore';
import type { ArrayOp, ModuleConfig } from '../types';

export class ModuleContext {
  /** 模块名 */
  readonly moduleName: string;
  /** 模块 YAML 中的自定义配置 */
  readonly config: ModuleConfig;
  private core: ConnectCore;

  constructor(core: ConnectCore, moduleName: string, config: ModuleConfig) {
    this.core = core;
    this.moduleName = moduleName;
    this.config = config;
  }

  /** 产生一个事件消息（框架核心会负责比对与分发）。 */
  sendEvent(name: string, data?: unknown): Promise<void> {
    return this.core.sendEvent(name, data, this.moduleName);
  }

  /** 公开数组（模块选择公开的数组，其他人可拉取/编辑内容，但不能改名）。 */
  exposeArray(name: string, initial: unknown[] = []): void {
    this.core.exposeArray(name, this.moduleName, initial);
  }

  /** 取消公开数组（仅限自己公开的）。 */
  unexposeArray(name: string): void {
    this.core.unexposeArray(name, this.moduleName);
  }

  /** 拉取特定数组（深拷贝快照）。 */
  pullArray<T = any>(name: string): T[] {
    return this.core.pullArray<T>(name);
  }

  /** 编辑特定数组的内容（结构化操作；数组名不可改变）。 */
  editArray(name: string, op: ArrayOp): void {
    this.core.editArray(name, op);
  }

  /** 模块自有日志（写入事件流水，type=module:log）。 */
  log(...parts: unknown[]): void {
    this.core.logModule(this.moduleName, ...parts);
  }
}
