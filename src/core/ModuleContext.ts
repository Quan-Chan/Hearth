/**
 * 模块上下文：框架核心提供给模块的 API 面。
 * 对应 docs/需求.md 的模块内方法：
 *   1. 接收事件信息（onEvent 由核心调用）
 *   2. 公开对象        -> exposeObject（把模块自己的对象映射到名字）
 *   3. 取消公开对象    -> unexposeObject
 *   4. 拉取特定对象    -> object（返回被映射对象引用，原生读写，一次修改处处有效）
 */
import type { Hearth } from './Hearth';
import type { ModuleConfig } from '../types';
import { objectKey, OBJECT_KEY_PREFIX } from './ObjectRegistry';

export class ModuleContext {
  /** 模块名 */
  readonly moduleName: string;
  /** 模块 YAML 中的自定义配置（YAML 配置更新后自动刷新为新值，模块随时读取都是最新） */
  get config(): ModuleConfig {
    return this._config;
  }
  private _config: ModuleConfig;
  private core: Hearth;

  constructor(core: Hearth, moduleName: string, config: ModuleConfig) {
    this.core = core;
    this.moduleName = moduleName;
    this._config = config;
  }

  /** 核心专用：YAML 配置更新后刷新本模块的配置引用（仅核心调用）。
   *  模块自行决定何时读取/如何应用新配置；核心不重启模块、不重载代码。 */
  refreshConfig(config: ModuleConfig): void {
    this._config = config;
  }

  /** 产生一个事件消息（框架核心会负责比对与分发）。
   *  模块只写内容 data（source=本模块名由核心自动生成）。 */
  sendEvent(name: string, data?: unknown): Promise<void> {
    return this.core.sendEvent(name, data, this.moduleName);
  }

  /** 定向发送消息（信息直达）：直接发给指定模块（或核心 'core'）。
   *  只带 source（本模块名，核心自动打）+ 内容，无事件名、不走公共对象。
   *  返回是否送达（true = 有接收方并已投递；false = 目标不存在/未运行/未实现 onMessage）。 */
  sendTo(target: string, data?: unknown): Promise<boolean> {
    return this.core.sendTo(target, data, this.moduleName);
  }

  /** 公开对象：把模块自己的对象映射到名字（存引用，不拷贝）。 */
  exposeObject(name: string, value: object = {}): void {
    this.core.exposeObject(name, this.moduleName, value);
  }

  /** 取消公开对象（仅限自己公开的）。 */
  unexposeObject(name: string): void {
    this.core.unexposeObject(name, this.moduleName);
  }

  /** 匹配拉取：模式含通配符 -> 匹配全名返回 { 对象全名: 引用 }；否则返回该对象引用。
   *  模式为三段式全名（public:模块:名）时直接拉取；否则按本模块名自动补齐前两段（拉自己的对象）。
   *  自动补齐的原因：模块日常只碰自己的对象，写全名冗长且易错；通配模式涉及别人的对象
   *  （名字里带别人的模块名），无法推断，必须写全名。 */
  object<T extends object = Record<string, unknown>>(pattern: string): T | Record<string, T> {
    if (!pattern.includes('*') && !pattern.includes('?') && !pattern.startsWith(OBJECT_KEY_PREFIX + ':')) {
      return this.core.object<T>(objectKey(this.moduleName, pattern));
    }
    return this.core.object<T>(pattern);
  }


  /** 请求自身重启（代码重载由模块自己发起）：模块替换代码文件后调用本方法。
   *  核心先验证新代码（失败则旧实例继续运行，返回 false）→ 停止旧实例（stop() 返回
   *  即"已关闭"）→ 重新启动本模块。状态保存/恢复与版本管理都是模块自己的职责，
   *  核心不迁移任何状态。返回重启后模块是否处于运行态：新实例启动失败或被跳过为 false。 */
  requestReload(): Promise<boolean> {
    return this.core.reloadModule(this.moduleName);
  }

  /** 模块自有日志（显式请求核心记录，写入日志时间线，type=module-log）。 */
  log(...parts: unknown[]): void {
    this.core.logModule(this.moduleName, ...parts);
  }
}