/**
 * Connect-Core 核心：框架的中间层，同时是软件的核心层。
 *
 * 职责（对应 docs/需求.md 的框架核心方法）：
 *   1. 启动模块        -> startModule（委托 ModuleManager）
 *   2. 关闭模块        -> stopModule（委托 ModuleManager；关闭时其公开数组自动取消映射）
 *   3. 发送事件消息    -> sendEvent（委托 EventDispatcher：启动匹配模块 + 向监听模块转发）
 * 框架其余功能：
 *   - 自产事件：核心启动时产生 "core:startup"
 *   - 监听模块文件夹：ConfigWatcher 热加载 YAML（新增/修改/删除）
 *   - 日志：只记录核心自己干的事情（三字段：type/source/message，见 logFormat.ts）
 *   - 公共数组：映射关系，公开者把数组对象映射到名字，所有人共享同一对象
 *   - CLI 指令协议：委托给 CliProtocol（独立文件）；目标为 core 的定向信息被转交
 *
 * 启动核心 == 启动整个软件：core.start() 会扫描模块配置并发出 core:startup，
 * 所有依赖该事件的模块自动启动，无需单独启动任何模块。
 *
 * 运行循环：
 *   start() -> 扫描模块目录 -> 重建比对索引 -> 发 core:startup（匹配模块自动启动）。
 *   此后每一次 sendEvent 走同一条三步：① 把 startEvents 命中的未运行模块拉起来
 *   （模块间的启动依赖链由此建立）；② 收集 listen 命中的监听者（无人认领则记 event-drop）；
 *   ③ 逐个派发事件消息，单点失败只记 error、不影响其他模块。
 *   配置热加载不重启核心：监听器感知到文件增/改/删，当场 加载/重启/移除 模块并重建索引。
 *   stop() -> 逐个调用模块 stop() 等返回"已关闭"（超时强制关闭）-> 关闭日志。
 *
 * 文件组织（一个文件 = 一个功能部分）：
 *   - 本文件：核心类本体 —— 生命周期 / 配置热加载 / 公共数组 API / 查询 / 委托；
 *   - ModuleManager.ts：模块状态机（启动/停止/重启/停机收尾 + 槽位表）；
 *   - EventDispatcher.ts：事件派发与定向通道（sendEvent/sendDirected/sendTo）；
 *   - CliProtocol.ts：CLI 指令协议（定向指令 + 结果回传），独立成文件；
 *   - 其余每个 core/*.ts 一个功能部分（见 README §6 目录结构）。
 */
import * as path from 'path';
import { EventStreamLog } from './EventStreamLog';
import { ArrayRegistry } from './ArrayRegistry';
import { ConfigWatcher } from './ConfigWatcher';
import { CliProtocol } from './CliProtocol';
import { ModuleManager } from './ModuleManager';
import { EventDispatcher } from './EventDispatcher';
import { LOG_TYPES } from './logFormat';
import type { LogType } from './logFormat';
import type {
  ConnectCoreOptions,
  DirectedMessage,
  ModuleConfig,
  ModuleRuntimeInfo,
} from '../types';

/** 日志内存副本的默认条数上限（超出丢最旧的；落盘文件不受影响）。 */
const DEFAULT_MAX_LOG_MEMORY_ENTRIES = 20000;
/** 停止等待上限的默认值（毫秒）：停机时等待全部模块返回"已关闭"的总时限，超时强制关闭。 */
const DEFAULT_STOP_TIMEOUT_MS = 20000;

export class ConnectCore {
  /** 核心日志（只记录核心自己干的事情）。 */
  readonly log: EventStreamLog;
  /** 核心选项（已解析为绝对路径）。 */
  readonly options: Required<ConnectCoreOptions>;

  private arrays = new ArrayRegistry();
  private watcher?: ConfigWatcher;
  private startedFlag = false;
  /** CLI 指令协议处理器（惰性创建：只有真的收到定向指令才实例化，普通核心不创建）。 */
  private cliProtocolInst?: CliProtocol;
  /** 停机中标记：置位后拒绝外部事件/启动/配置变更，关闭过程不可被中断。 */
  private stoppingFlag = false;
  /** 模块状态机：槽位表 + 启动/停止/重启/停机收尾。 */
  private readonly manager: ModuleManager;
  /** 事件派发器：事件广播与定向通道。 */
  private readonly dispatcher: EventDispatcher;
  /** 进程级守护：开启 guardProcess 的核心集合与已安装的处理句柄。 */
  private static guardedCores = new Set<ConnectCore>();
  private static processGuardInstalled = false;

  constructor(options: ConnectCoreOptions = {}) {
    this.options = {
      moduleDir: path.resolve(options.moduleDir ?? './modules'),
      logFile: path.resolve(options.logFile ?? './logs/event-stream.log'),
      watch: options.watch ?? true,
      pollIntervalMs: options.pollIntervalMs ?? 200,
      logToConsole: options.logToConsole ?? false,
      guardProcess: options.guardProcess ?? false,
      defaultStartTimeoutMs: options.defaultStartTimeoutMs ?? 0,
      maxLogMemoryEntries: options.maxLogMemoryEntries ?? DEFAULT_MAX_LOG_MEMORY_ENTRIES,
      stopTimeoutMs: options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
    };
    this.log = new EventStreamLog({
      filePath: this.options.logFile,
      logToConsole: this.options.logToConsole,
      maxMemoryEntries: this.options.maxLogMemoryEntries,
    });
    this.manager = new ModuleManager(this);
    this.dispatcher = new EventDispatcher(this, this.manager);
  }

  get started(): boolean {
    return this.startedFlag;
  }

  /** 停机中标记（@internal）：供 ModuleManager/EventDispatcher 判断冻结面。 */
  get stopping(): boolean {
    return this.stoppingFlag;
  }

  /** 统一日志出口：记录一条核心自己的日志（三字段：type/source/message + 附加字段）。
   *  协议/管理面（如 CliProtocol）也从这里记录，所有核心动作都进入日志时间线。 */
  writeLog(type: LogType, source: string, message: string, extra: Record<string, unknown> = {}): void {
    this.log.record({ type, source, message, ...extra });
  }

  /** 进程级守护（guardProcess 开启时安装一次，全部开启者共享）：
   *  模块私下发起的异步失败与漏网的同步异常不再杀死进程，只进日志时间线。
   *  捕获 uncaughtException 后进程继续运行，宿主需自行权衡。 */
  private static installProcessGuard(): void {
    if (ConnectCore.processGuardInstalled) return;
    ConnectCore.processGuardInstalled = true;
    const fmt = (e: unknown): string => (e instanceof Error ? (e.stack ?? e.message) : String(e));
    process.on('unhandledRejection', (reason) => {
      const text = 'caught unhandled async failure (Promise): ' + fmt(reason);
      if (ConnectCore.guardedCores.size === 0) console.error('[connect-core] ' + text);
      for (const core of ConnectCore.guardedCores) core.writeLog(LOG_TYPES.ERROR, 'core', text);
    });
    process.on('uncaughtException', (err) => {
      const text = 'caught uncaught exception (process continues): ' + fmt(err);
      if (ConnectCore.guardedCores.size === 0) console.error('[connect-core] ' + text);
      for (const core of ConnectCore.guardedCores) core.writeLog(LOG_TYPES.ERROR, 'core', text);
    });
  }

  // ==================== 生命周期：启动核心 == 启动整个软件 ====================

  async start(): Promise<void> {
    if (this.startedFlag) throw new Error('Connect-Core already started, do not start twice');
    this.startedFlag = true;
    if (this.options.guardProcess) {
      ConnectCore.guardedCores.add(this);
      ConnectCore.installProcessGuard();
    }
    this.writeLog(LOG_TYPES.CORE_START, 'core', 'core started');

    // 坏 YAML 只记 error、核心继续运行。
    this.watcher = new ConfigWatcher({
      dir: this.options.moduleDir,
      watch: this.options.watch,
      pollIntervalMs: this.options.pollIntervalMs,
      callbacks: {
        onLoad: (cfg, yamlPath) => this.handleConfigLoad(cfg, yamlPath),
        onUpdate: (cfg, yamlPath) => this.handleConfigUpdate(cfg, yamlPath),
        onRemove: (name) => this.handleConfigRemove(name),
        onError: (name, message) =>
          this.writeLog(LOG_TYPES.ERROR, name, `config parse failed: ${message}`, {
            module: name,
            error: message,
          }),
      },
    });
    // 先登记目录里已有的 YAML（模块均为"停"态），再发 core:startup 让匹配者自动启动。
    await this.watcher.start();
    await this.sendEvent('startup', undefined, 'core');
  }

  /** 停止整个软件：
   *  ① 对每个运行模块调用 stop() 钩子——stop() 返回（resolve）即该模块"已关闭"；
   *  ② 等待全部模块返回"已关闭"：全部返回 → 关闭自己；超过 stopTimeoutMs 仍未返回 → 强制关闭。
   *  （① ② 由 ModuleManager.stopAll 执行。）
   */
  async stop(): Promise<void> {
    if (!this.startedFlag || this.stoppingFlag) return;
    this.stoppingFlag = true;
    // 冻结文件面：停机期间不再加载/更新/移除配置，防止停机途中新模块被注册。
    // 先停 watcher 再停模块的原因：若顺序反过来，停模块期间新 YAML 会触发新模块启动，
    // 停机集合会边关边长；冻结文件面后模块集合固定，stopAll 关的就是全集。
    await this.watcher?.stop();
    await this.manager.stopAll();
    // 收尾：核心自身的数组也遵守"拥有者消失即注销"的数组规则。
    this.arrays.removeOwner('core');
    this.startedFlag = false;
    this.stoppingFlag = false;
    this.writeLog(LOG_TYPES.CORE_STOP, 'core', 'core stopped');
    await this.log.close();
  }

  /** 立即重新扫描模块文件夹（测试/管理用）。返回是否真正执行了扫描
   *  （false = 停机中或上一次扫描仍在进行中，本次调用被跳过）。 */
  async rescanModules(): Promise<boolean> {
    if (!this.startedFlag || this.stoppingFlag) return false;
    return (await this.watcher?.rescan()) ?? false;
  }

  // ==================== 框架核心方法（委托） ====================

  /** 核心方法 1：启动模块（见 ModuleManager.startModule）。 */
  async startModule(name: string, reason?: string): Promise<void> {
    return this.manager.startModule(name, reason);
  }

  /** 请求自身重启（见 ModuleManager.reloadModule）。返回是否完成替换。 */
  async reloadModule(name: string): Promise<boolean> {
    return this.manager.reloadModule(name);
  }

  /** 核心方法 2：关闭单个模块（见 ModuleManager.stopModule）。 */
  async stopModule(name: string): Promise<void> {
    return this.manager.stopModule(name);
  }

  /** 核心方法 3：发送事件消息（见 EventDispatcher.sendEvent）。 */
  async sendEvent(name: string, data?: unknown, source: string = 'external'): Promise<void> {
    return this.dispatcher.sendEvent(name, data, source);
  }

  /** 定向发送事件：只投递给指定的运行中模块（见 EventDispatcher.sendDirected）。 */
  async sendDirected(targets: string[] | null, name: string, data?: unknown, source: string = 'external'): Promise<string[]> {
    return this.dispatcher.sendDirected(targets, name, data, source);
  }

  /** 定向发送一条纯消息（信息直达）（见 EventDispatcher.sendTo）。返回是否送达。 */
  async sendTo(target: string, data?: unknown, source: string = 'external'): Promise<boolean> {
    return this.dispatcher.sendTo(target, data, source);
  }

  // ==================== CLI 指令协议（委托 CliProtocol） ====================

  /** 惰性获取 CLI 指令协议处理器：只有真的收到定向指令才创建。 */
  private get cliProtocol(): CliProtocol {
    if (!this.cliProtocolInst) this.cliProtocolInst = new CliProtocol(this);
    return this.cliProtocolInst;
  }

  /** 处理目标为 core 的定向信息（@internal）：委托 CLI 指令协议，供 EventDispatcher 调用。 */
  handleCliMessage(message: DirectedMessage): Promise<void> {
    return this.cliProtocol.handleDirected(message);
  }

  // ==================== 模块配置热加载（监听模块文件夹） ====================

  /** 配置加载：接受注册返回 true；拒绝（模块名已被其他 YAML 占用）返回 false。
   *  同名模块一律不准注册 —— 名字是模块的全局身份，允许顶替等于允许"伪装成同名模块"上线
   *  （防注入风险）。拒绝的文件不被 watcher 记账，每轮扫描都会重新请求并各记一条 error，
   *  持续可见直到同名问题被修复（与坏 YAML 的"每轮重试提醒"同规则）。 */
  private handleConfigLoad(cfg: ModuleConfig, yamlPath: string): boolean {
    if (this.stoppingFlag) return true; // 停机中：文件面已冻结，此处只收住在途扫描的收尾
    if (!this.manager.register(cfg, yamlPath)) {
      const existing = this.manager.getSlot(cfg.name)!;
      this.writeLog(LOG_TYPES.ERROR, cfg.name,
        `config load rejected: module name ${cfg.name} already registered by ${existing.yamlPath} (duplicate module names not allowed)`,
        { module: cfg.name, file: cfg.file, conflict: existing.yamlPath },
      );
      return false;
    }
    this.dispatcher.rebuildIndexes(this.manager.slots());
    this.writeLog(LOG_TYPES.CONFIG_LOAD, cfg.name, `config loaded: ${cfg.name}`, {
      module: cfg.name,
      file: cfg.file,
    });
    return true;
  }

  /** 配置更新：本文件（yamlPath 相同）的更新照常应用返回 true；
   *  别的文件来抢同名模块名（yamlPath 不同）返回 false —— 拒绝顶替，防同名伪装。
   *  YAML 更新只重载 YAML 本身，不重载代码、不重启模块（代码重载由模块自行发起，
   *  见 requestReload）。应用范围：
   *   - 更新模块注册（config 字段）与比对索引（startEvents/listen 变化即时生效）；
   *   - 运行中的模块：刷新其 ctx.config 引用（模块自行决定何时读取/如何应用新配置），
   *     实例与代码不动；
   *   - 配置把 enabled 改为 false：停止运行中的模块（配置驱动的停止，同样不重载代码）；
   */
  private async handleConfigUpdate(cfg: ModuleConfig, yamlPath: string): Promise<boolean> {
    if (this.stoppingFlag) return true; // 停机中：不再应用任何配置变化
    const prev = this.manager.getSlot(cfg.name);
    // 同名不同文件：本文件不是该模块名当前归属的 YAML，拒绝应用（模块名全库不允许重复，先注册者保留）
    if (prev && prev.yamlPath !== yamlPath) {
      this.writeLog(LOG_TYPES.ERROR, cfg.name,
        `config update rejected: module name ${cfg.name} occupied by ${prev.yamlPath} (duplicate module names not allowed)`,
        { module: cfg.name, file: cfg.file, conflict: prev.yamlPath },
      );
      return false;
    }
    const wasRunning = prev?.status === 'running';
    await this.manager.applyUpdate(cfg, yamlPath);
    this.dispatcher.rebuildIndexes(this.manager.slots());
    this.writeLog(LOG_TYPES.CONFIG_UPDATE, cfg.name, `config updated: ${cfg.name} (YAML layer only, module instance and code unchanged)`, {
      module: cfg.name,
      file: cfg.file,
    });
    if (wasRunning && cfg.enabled === false) {
      // 配置禁用：停止运行中的模块（配置驱动的停止，不重载代码；重启用新配置）
      await this.stopModule(cfg.name);
    }
    return true;
  }

  private async handleConfigRemove(name: string): Promise<void> {
    if (this.stoppingFlag) return; // 停机中：不再应用任何配置变化
    if (!this.manager.getSlot(name)) return;
    await this.manager.remove(name);
    this.dispatcher.rebuildIndexes(this.manager.slots());
    this.writeLog(LOG_TYPES.CONFIG_REMOVE, name, `config removed: ${name}`, { module: name });
  }

  // ==================== 公共数组（映射关系） ====================

  /** 公开数组：把模块的数组对象映射到名字（name 为第三段，前两段自动拼装，存引用不拷贝）。 */
  exposeArray(name: string, owner: string, items: unknown[] = []): void {
    this.arrays.expose(name, owner, items);
  }

  /** 取消公开数组（仅拥有者）。 */
  unexposeArray(name: string, owner: string): void {
    this.arrays.unexpose(name, owner);
  }

  /** 匹配拉取：模式不含通配符 -> 返回该数组引用；含通配符 -> 返回 { 数组全名: 引用 }。 */
  array<T = any>(pattern: string): T[] | Record<string, T[]> {
    return this.arrays.get<T>(pattern);
  }

  /** 注销某拥有者的全部数组映射（@internal）：供 ModuleManager 在模块停止时调用。 */
  removeOwnerArrays(owner: string): string[] {
    return this.arrays.removeOwner(owner);
  }

  // ==================== 查询与模块日志 ====================

  listModules(): ModuleRuntimeInfo[] {
    return this.manager.slots().map((m) => ({
      name: m.name,
      config: m.config,
      status: m.status,
    }));
  }

  getModule(name: string): ModuleRuntimeInfo | undefined {
    const m = this.manager.getSlot(name);
    if (!m) return undefined;
    return {
      name: m.name,
      config: m.config,
      status: m.status,
    };
  }

  /** 模块自有日志（模块显式请求核心记录，type=module-log）。 */
  logModule(moduleName: string, ...parts: unknown[]): void {
    this.writeLog(LOG_TYPES.MODULE_LOG, moduleName, parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '), {
      module: moduleName,
    });
  }
}