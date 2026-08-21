/**
 * 模块上下文：框架核心提供给模块的 API 面（模块看到的全部世界就这一层）。
 * 对应 REQUIREMENTS.md 第 3 节"模块内方法"：
 *   1. 接收事件信息（onEvent 由核心调用）
 *   2. 公开数组        -> exposeArray（把模块自己的数组对象映射到名字）
 *   3. 取消公开数组    -> unexposeArray
 *   4. 拉取特定数组    -> array（返回被映射对象引用，原生数组语法，一次修改处处有效）
 */
import type { ConnectCore } from './ConnectCore';
import type { ModuleConfig } from '../types';

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

  /** 产生一个事件消息（框架核心会负责比对与分发）。
   *  模块只写第二段内容 data（第一段事件头 head.source=本模块名由核心自动生成）。 */
  sendEvent(name: string, data?: unknown): Promise<void> {
    return this.core.sendEvent(name, data, this.moduleName);
  }

  /** 定向发送消息（信息直达）：直接发给指定模块（或核心 'core'）。
   *  只带基础头（head.source=本模块名，核心自动打）+ 内容，无事件名、不走公共数组。
   *  返回是否送达（true = 有接收方并已投递；false = 目标不存在/未运行/未实现 onMessage）。 */
  sendTo(target: string, data?: unknown): Promise<boolean> {
    return this.core.sendTo(target, data, this.moduleName);
  }

  /** 公开数组：把模块自己的数组对象映射到名字（存引用，不拷贝）。 */
  exposeArray(name: string, items: unknown[] = []): void {
    this.core.exposeArray(name, this.moduleName, items);
  }

  /** 取消公开数组（仅限自己公开的）。 */
  unexposeArray(name: string): void {
    this.core.unexposeArray(name, this.moduleName);
  }

  /** 拉取特定数组：返回被映射的对象引用，像原生数组一样直接使用。 */
  array<T = any>(name: string): T[] {
    return this.core.array<T>(name);
  }

  /** 模块自有日志（显式请求核心记录，写入事件流水，type=module-log）。 */
  log(...parts: unknown[]): void {
    this.core.logModule(this.moduleName, ...parts);
  }
}
