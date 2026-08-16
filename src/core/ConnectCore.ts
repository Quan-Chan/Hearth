/**
 * Connect-Core 核心：一个极简的中间层，同时是整个软件的核心层。
 *
 * 职责（对应 REQUIREMENTS.md）：
 *  框架核心方法：
 *   1. 启动模块      -> startModule
 *   2. 关闭模块      -> stopModule
 *   3. 发送事件消息  -> sendEvent
 *  框架其余功能：
 *   - 自产事件：核心启动/关闭时产生 "core:startup" / "core:shutdown"
 *   - 比对事件：按 startEvents 决定是否启动模块，按 listen 决定是否发送事件消息
 *   - 监听模块文件夹：ConfigWatcher 热加载 YAML（新增/修改/删除）
 *   - 日志：EventStreamLog 原样记录所有发生的事情（事件流水）
 *   - 公共数组：ArrayRegistry 管理模块公开的数组
 *
 * 启动核心 == 启动整个软件：core.start() 会扫描模块配置并发出 core:startup，
 * 所有依赖该事件的模块自动启动，无需单独启动任何模块。
 */
import * as path from 'path';
import { EventStreamLog } from './EventStreamLog';
import { ArrayRegistry } from './ArrayRegistry';
import { ConfigWatcher } from './ConfigWatcher';
import { ModuleContext } from './ModuleContext';
import { anyEventMatches } from './EventMatcher';
import { loadModuleProgram } from '../module/loadModule';
import type {
  ArrayOp,
  ConnectCoreOptions,
  CoreEvent,
  ModuleConfig,
  ModuleDefinition,
  ModuleRuntimeInfo,
} from '../types';

interface ModuleSlot {
  name: string;
  config: ModuleConfig;
  yamlPath: string;
  def?: ModuleDefinition;
  ctx?: ModuleContext;
  status: 'running' | 'stopped' | 'failed';
  startedAt?: number;
  error?: string;
}

export class ConnectCore {
  /** 事件流水日志（原样记录所有发生的事情）。 */
  readonly log: EventStreamLog;
  /** 核心选项（已解析为绝对路径）。 */
  readonly options: Required<ConnectCoreOptions>;

  private arrays = new ArrayRegistry();
  private modules = new Map<string, ModuleSlot>();
  /** 已经出现过的事件名（用于"事件已发生则立即启动新模块"）。 */
  private occurred = new Set<string>();
  private watcher?: ConfigWatcher;
  private startedFlag = false;

  constructor(options: ConnectCoreOptions = {}) {
    this.options = {
      moduleDir: path.resolve(options.moduleDir ?? './modules'),
      logFile: path.resolve(options.logFile ?? './logs/event-stream.log'),
      watch: options.watch ?? true,
      pollIntervalMs: options.pollIntervalMs ?? 200,
      logToConsole: options.logToConsole ?? false,
    };
    this.log = new EventStreamLog({
      filePath: this.options.logFile,
      logToConsole: this.options.logToConsole,
    });
  }

  get started(): boolean {
    return this.startedFlag;
  }

  // ==================== 生命周期：启动核心 == 启动整个软件 ====================

  async start(): Promise<void> {
    if (this.startedFlag) throw new Error('Connect-Core 已经启动，请勿重复启动');
    this.startedFlag = true;
    this.log.record({ type: 'core:start' });

    this.watcher = new ConfigWatcher({
      dir: this.options.moduleDir,
      watch: this.options.watch,
      pollIntervalMs: this.options.pollIntervalMs,
      callbacks: {
        onLoad: (cfg, yamlPath) => this.handleConfigLoad(cfg, yamlPath),
        onUpdate: (cfg, yamlPath) => this.handleConfigUpdate(cfg, yamlPath),
        onRemove: (name) => this.handleConfigRemove(name),
        onError: (name, message) =>
          this.log.record({ type: 'config:error', module: name, error: message }),
      },
    });
    // 初始扫描：加载模块文件夹中已有的 YAML 配置
    await this.watcher.start();
    // 核心自产事件：核心启动。所有 startEvents 匹配的模块会被自动启动。
    await this.sendEvent('core:startup', undefined, 'core');
  }

  async stop(): Promise<void> {
    if (!this.startedFlag) return;
    // 先广播核心关闭事件，让模块有机会收尾
    await this.sendEvent('core:shutdown', undefined, 'core');
    // 再按启动顺序的逆序停止所有运行中的模块
    const running = [...this.modules.values()].filter((m) => m.status === 'running');
    for (const m of running.reverse()) {
      await this.stopModule(m.name);
    }
    await this.watcher?.stop();
    this.startedFlag = false;
    this.log.record({ type: 'core:stop' });
    await this.log.close();
  }

  /** 立即重新扫描模块文件夹（测试/管理用）。 */
  async rescanModules(): Promise<void> {
    await this.watcher?.rescan();
  }

  // ==================== 框架核心方法 ====================

  /** 核心方法 1：启动模块。reason 为触发启动的事件名（用于日志）。 */
  async startModule(name: string, reason?: string): Promise<void> {
    const slot = this.modules.get(name);
    if (!slot) throw new Error(`未知模块: ${name}`);
    if (slot.status === 'running') {
      this.log.record({ type: 'module:start-skipped', module: name, reason: 'already-running' });
      return;
    }
    if (!slot.config.enabled) {
      this.log.record({ type: 'module:start-skipped', module: name, reason: 'disabled' });
      return;
    }
    try {
      const def = await loadModuleProgram(slot.config.file);
      const ctx = new ModuleContext(this, name, slot.config);
      await def.start?.(ctx);
      slot.def = def;
      slot.ctx = ctx;
      slot.status = 'running';
      slot.startedAt = Date.now();
      slot.error = undefined;
      this.log.record({
        type: 'module:start',
        module: name,
        file: slot.config.file,
        reason: reason ?? 'manual',
      });
    } catch (err) {
      slot.status = 'failed';
      slot.error = err instanceof Error ? err.message : String(err);
      this.log.record({ type: 'module:start-failed', module: name, error: slot.error });
    }
  }

  /** 核心方法 2：关闭模块。 */
  async stopModule(name: string): Promise<void> {
    const slot = this.modules.get(name);
    if (!slot) throw new Error(`未知模块: ${name}`);
    if (slot.status !== 'running') {
      this.log.record({ type: 'module:stop-skipped', module: name, reason: 'not-running' });
      return;
    }
    try {
      await slot.def?.stop?.(slot.ctx!);
      slot.status = 'stopped';
      this.log.record({ type: 'module:stop', module: name });
    } catch (err) {
      slot.status = 'stopped';
      this.log.record({
        type: 'module:stop-failed',
        module: name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 核心方法 3：发送事件消息。核心会比对事件：启动匹配的模块 + 向监听模块发消息。 */
  async sendEvent(name: string, data?: unknown, source: string = 'external'): Promise<void> {
    if (!this.startedFlag) throw new Error('Connect-Core 未启动，不能发送事件');
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('事件名必须是非空字符串');
    }
    const event: CoreEvent = { name, data };
    this.occurred.add(name);
    this.log.record({ type: 'event', event: name, source, data });

    // 1) 比对启动事件：未运行的模块若 startEvents 匹配，则启动它
    const toStart = [...this.modules.values()].filter(
      (m) => m.status !== 'running' && m.config.enabled && anyEventMatches(m.config.startEvents, name),
    );
    for (const m of toStart) {
      await this.startModule(m.name, name);
    }

    // 2) 比对监听事件：向运行中且 listen 匹配的模块发送事件消息
    for (const m of this.modules.values()) {
      if (m.status !== 'running' || !m.ctx || !m.def?.onEvent) continue;
      if (!anyEventMatches(m.config.listen, name)) continue;
      try {
        await m.def.onEvent(m.ctx, event);
      } catch (err) {
        this.log.record({
          type: 'module:event-failed',
          module: m.name,
          event: name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ==================== 模块配置热加载（监听模块文件夹） ====================

  private handleConfigLoad(cfg: ModuleConfig, yamlPath: string): void {
    this.modules.set(cfg.name, {
      name: cfg.name,
      config: cfg,
      yamlPath,
      status: 'stopped',
    });
    this.log.record({ type: 'config:load', module: cfg.name, file: cfg.file });
    // 若启动事件已经出现过，立即启动模块
    if (cfg.enabled !== false && this.occurred.size > 0) {
      const happened = [...this.occurred].some((e) => anyEventMatches(cfg.startEvents, e));
      if (happened) void this.startModule(cfg.name, 'config-load');
    }
  }

  private async handleConfigUpdate(cfg: ModuleConfig, yamlPath: string): Promise<void> {
    const prev = this.modules.get(cfg.name);
    const wasRunning = prev?.status === 'running';
    this.modules.set(cfg.name, {
      name: cfg.name,
      config: cfg,
      yamlPath,
      status: wasRunning ? 'running' : prev?.status ?? 'stopped',
      def: prev?.def,
      ctx: prev?.ctx,
      startedAt: prev?.startedAt,
      error: prev?.error,
    });
    this.log.record({ type: 'config:update', module: cfg.name, file: cfg.file });
    if (wasRunning) {
      // 配置变化：重启模块以应用新配置
      await this.stopModule(cfg.name);
      if (cfg.enabled !== false) await this.startModule(cfg.name, 'config-update');
    } else if (cfg.enabled !== false) {
      const happened = [...this.occurred].some((e) => anyEventMatches(cfg.startEvents, e));
      if (happened) await this.startModule(cfg.name, 'config-update');
    }
  }

  private async handleConfigRemove(name: string): Promise<void> {
    const slot = this.modules.get(name);
    if (!slot) return;
    if (slot.status === 'running') await this.stopModule(name);
    this.modules.delete(name);
    this.log.record({ type: 'config:remove', module: name });
  }

  // ==================== 公共数组（模块内方法 2-5 的核心实现） ====================

  /** 公开数组（模块选择公开的数组）。同拥有者重新公开 = 重置内容（模块重启场景）。 */
  exposeArray(name: string, owner: string, initial: unknown[] = []): void {
    if (this.arrays.has(name)) {
      if (this.arrays.ownerOf(name) === owner) {
        this.arrays.reset(name, owner, initial);
        this.log.record({ type: 'array:reset', array: name, owner });
        return;
      }
      throw new Error(`公共数组已存在: ${name}（拥有者 ${this.arrays.ownerOf(name)}）`);
    }
    this.arrays.expose(name, owner, initial);
    this.log.record({ type: 'array:expose', array: name, owner });
  }

  /** 取消公开数组（仅拥有者）。 */
  unexposeArray(name: string, owner: string): void {
    this.arrays.unexpose(name, owner);
    this.log.record({ type: 'array:unexpose', array: name, owner });
  }

  /** 拉取特定数组（深拷贝快照）。 */
  pullArray<T = any>(name: string): T[] {
    return this.arrays.pull<T>(name);
  }

  /** 编辑特定数组的内容（不能改变数组名）。 */
  editArray(name: string, op: ArrayOp): void {
    this.arrays.edit(name, op);
    this.log.record({ type: 'array:edit', array: name, op });
  }

  /** 列出所有公共数组名。 */
  listArrays(): string[] {
    return this.arrays.list();
  }

  /** 查询公共数组的拥有者。 */
  arrayOwner(name: string): string | undefined {
    return this.arrays.ownerOf(name);
  }

  // ==================== 查询与模块日志 ====================

  listModules(): ModuleRuntimeInfo[] {
    return [...this.modules.values()].map((m) => ({
      name: m.name,
      config: m.config,
      status: m.status,
      startedAt: m.startedAt,
      error: m.error,
    }));
  }

  getModule(name: string): ModuleRuntimeInfo | undefined {
    const m = this.modules.get(name);
    if (!m) return undefined;
    return {
      name: m.name,
      config: m.config,
      status: m.status,
      startedAt: m.startedAt,
      error: m.error,
    };
  }

  /** 模块自有日志（写入事件流水，type=module:log）。 */
  logModule(moduleName: string, ...parts: unknown[]): void {
    this.log.record({
      type: 'module:log',
      module: moduleName,
      message: parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '),
    });
  }
}
