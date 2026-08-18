/**
 * Connect-Core 核心：一个极简的中间层，同时是整个软件的核心层。
 *
 * 职责（对应 REQUIREMENTS.md）：
 *  框架核心方法：
 *   1. 启动模块      -> startModule
 *   2. 关闭模块      -> stopModule（关闭时其公开数组自动取消映射、自然消失）
 *   3. 发送事件消息  -> sendEvent（比对事件：启动匹配模块 + 向监听模块转发）
 *  框架其余功能：
 *   - 自产事件：核心启动/关闭时产生 "core:startup" / "core:shutdown"
 *   - 监听模块文件夹：ConfigWatcher 热加载 YAML（新增/修改/删除）
 *   - 日志：只记录核心自己干的事情（三字段：type/source/message，见 logFormat.ts）
 *   - 公共数组：映射语义，公开者把数组对象映射到名字，所有人共享同一对象
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
import { LOG_TYPES } from './logFormat';
import type { LogType } from './logFormat';
import { loadModuleProgram } from '../module/loadModule';
import type {
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

/** CLI 请求协议（约定式）：事件 = 门铃，数组 = 内容。
 *  - cli:commands（CLI 拥有）：指令内容条目 [{ id, cmd, args, status }]
 *  - cli:request  事件（带 id）：请求门铃 —— 核心收到后从 cli:commands 取该 id 的指令执行
 *  - core:results（核心拥有）：执行结果条目 [{ id, cmd, ok, result, error }]
 *  - cli:done     事件（带 id）：完成门铃 —— CLI 收到后从 core:results 取对应结果
 * 数组名是双方约定（不放进事件），事件只负责响铃与携带 id 用于对应。
 */
const CLI_REQUEST_EVENT = 'cli:request';
const CLI_DONE_EVENT = 'cli:done';
const CLI_COMMANDS_ARRAY = 'cli:commands';
const CORE_RESULTS_ARRAY = 'core:results';

/** 模块启动原因 -> 人类可读描述。 */
function describeStartReason(reason?: string): string {
  if (!reason || reason === 'manual') return '手动启动';
  if (reason === 'config-load') return '配置加载，启动事件已发生';
  if (reason === 'config-update') return '配置更新，重新启动';
  return `事件 ${reason} 匹配启动条件`;
}

export class ConnectCore {
  /** 事件流水日志（只记录核心自己干的事情）。 */
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

  /** 统一日志出口：只记录核心自己干的事情（三字段：type/source/message + 附加字段）。 */
  private writeLog(type: LogType, source: string, message: string, extra: Record<string, unknown> = {}): void {
    this.log.record({ type, source, message, ...extra });
  }

  // ==================== 生命周期：启动核心 == 启动整个软件 ====================

  async start(): Promise<void> {
    if (this.startedFlag) throw new Error('Connect-Core 已经启动，请勿重复启动');
    this.startedFlag = true;
    this.writeLog(LOG_TYPES.CORE_START, 'core', '核心启动');

    this.watcher = new ConfigWatcher({
      dir: this.options.moduleDir,
      watch: this.options.watch,
      pollIntervalMs: this.options.pollIntervalMs,
      callbacks: {
        onLoad: (cfg, yamlPath) => this.handleConfigLoad(cfg, yamlPath),
        onUpdate: (cfg, yamlPath) => this.handleConfigUpdate(cfg, yamlPath),
        onRemove: (name) => this.handleConfigRemove(name),
        onError: (name, message) =>
          this.writeLog(LOG_TYPES.ERROR, name, `配置解析失败: ${message}`, {
            module: name,
            error: message,
          }),
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
    // 再按启动顺序的逆序停止所有运行中的模块（其公开数组随之消失）
    const running = [...this.modules.values()].filter((m) => m.status === 'running');
    for (const m of running.reverse()) {
      await this.stopModule(m.name);
    }
    await this.watcher?.stop();
    // 核心自己的公开数组（如 core:results 结果信箱）随之消失
    this.arrays.removeOwner('core');
    this.startedFlag = false;
    this.writeLog(LOG_TYPES.CORE_STOP, 'core', '核心关闭');
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
      this.writeLog(LOG_TYPES.MODULE_SKIP, name, '模块已在运行，跳过启动', {
        module: name,
        reason: 'already-running',
      });
      return;
    }
    if (!slot.config.enabled) {
      this.writeLog(LOG_TYPES.MODULE_SKIP, name, '模块被禁用，跳过启动', {
        module: name,
        reason: 'disabled',
      });
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
      this.writeLog(LOG_TYPES.MODULE_START, name, describeStartReason(reason), {
        module: name,
        file: slot.config.file,
        reason: reason ?? 'manual',
      });
    } catch (err) {
      slot.status = 'failed';
      slot.error = err instanceof Error ? err.message : String(err);
      this.writeLog(LOG_TYPES.ERROR, name, `启动失败: ${slot.error}`, {
        module: name,
        error: slot.error,
      });
    }
  }

  /** 核心方法 2：关闭模块。关闭后其公开的数组自动取消映射（自然消失，不留残档）。 */
  async stopModule(name: string): Promise<void> {
    const slot = this.modules.get(name);
    if (!slot) throw new Error(`未知模块: ${name}`);
    if (slot.status !== 'running') {
      this.writeLog(LOG_TYPES.MODULE_SKIP, name, '模块未在运行，跳过关闭', {
        module: name,
        reason: 'not-running',
      });
      return;
    }
    try {
      await slot.def?.stop?.(slot.ctx!);
      slot.status = 'stopped';
    } catch (err) {
      slot.status = 'stopped';
      this.writeLog(LOG_TYPES.ERROR, name, `关闭钩子失败: ${err instanceof Error ? err.message : String(err)}`, {
        module: name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // 模块关闭 -> 其公开的数组映射全部取消，数组随之消失
    const removed = this.arrays.removeOwner(name);
    this.writeLog(
      LOG_TYPES.MODULE_STOP,
      name,
      removed.length > 0 ? `关闭模块，清理 ${removed.length} 个公共数组` : '关闭模块',
      { module: name, removedArrays: removed },
    );
  }

  /** 核心方法 3：发送事件消息。核心比对事件：启动匹配的模块 + 向监听模块转发。 */
  async sendEvent(name: string, data?: unknown, source: string = 'external'): Promise<void> {
    if (!this.startedFlag) throw new Error('Connect-Core 未启动，不能发送事件');
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('事件名必须是非空字符串');
    }
    const event: CoreEvent = { name, data };

    // CLI 请求门铃拦截：cli:request 是核心自己的协议事件（不进普通事件路由，不记入 occurred）
    if (name === CLI_REQUEST_EVENT) {
      await this.handleCliRequest(source, event);
      return;
    }

    this.occurred.add(name);

    // 1) 比对启动事件：未运行的模块若 startEvents 匹配，则启动它
    const toStart = [...this.modules.values()].filter(
      (m) => m.status !== 'running' && m.config.enabled && anyEventMatches(m.config.startEvents, name),
    );
    for (const m of toStart) {
      await this.startModule(m.name, name);
    }

    // 2) 比对监听事件：收集匹配的监听模块，记录核心动作（转发或丢弃）
    const listeners = [...this.modules.values()].filter(
      (m) => m.status === 'running' && m.ctx && m.def?.onEvent && anyEventMatches(m.config.listen, name),
    );
    if (listeners.length === 0) {
      this.writeLog(LOG_TYPES.EVENT_DROP, source, name, { event: name, data });
    } else {
      this.writeLog(LOG_TYPES.EVENT, source, name, {
        event: name,
        data,
        recipients: listeners.map((m) => m.name),
      });
    }

    // 3) 向监听模块发送事件消息（单个模块失败不影响其他模块）
    for (const m of listeners) {
      try {
        await m.def!.onEvent!(m.ctx!, event);
      } catch (err) {
        this.writeLog(LOG_TYPES.ERROR, m.name, `处理事件 ${name} 失败: ${err instanceof Error ? err.message : String(err)}`, {
          event: name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ==================== CLI 请求协议（门铃 + 数组） ====================

  /**
   * 处理 CLI 请求（门铃协议，由 sendEvent 拦截 cli:request 后调用）：
   *  ① 从 cli:commands（CLI 拥有的公开数组）取第一条未处理的指令；
   *  ② 执行它（事件/启动/关闭/定向发送/查询/退出），并把该条目标记为已处理；
   *  ③ 把执行结果写入 core:results（核心自己的公开数组）；
   *  ④ 广播 cli:done 完成门铃，CLI 收到后自己读 core:results 的最新一条来展示。
   * 终端是串行的，无需 id 关联：事件只当门铃，内容/结果全走数组。
   */
  private async handleCliRequest(source: string, event: CoreEvent): Promise<void> {
    // 结果信箱惰性创建：只有真的用到 CLI 协议时才出现，普通核心保持零污染
    if (!this.arrays.has(CORE_RESULTS_ARRAY)) this.exposeArray(CORE_RESULTS_ARRAY, 'core', []);

    const commands = this.arrays.get<Record<string, unknown>>(CLI_COMMANDS_ARRAY);
    const entry = commands.find((c) => c.status !== 'done' && c.status !== 'error');
    if (!entry) {
      this.writeLog(LOG_TYPES.ERROR, 'core', 'CLI 请求到达但 cli:commands 里没有待执行指令', { event: CLI_REQUEST_EVENT });
      return;
    }

    const cmd = String(entry.cmd ?? '');
    const args = (entry.args ?? {}) as Record<string, unknown>;
    this.writeLog(LOG_TYPES.CLI_COMMAND, source, 'CLI 指令: ' + cmd, { command: cmd });

    const running = (m: ModuleSlot): boolean => m.status === 'running' && !!m.def?.onEvent;
    const result: Record<string, unknown> = { cmd };
    try {
      switch (cmd) {
        case 'event': {
          const name = String(args.name ?? '');
          if (!name) throw new Error('event 指令缺少 name');
          await this.sendEvent(name, args.data, source);
          result.result = { delivered: name };
          break;
        }
        case 'start': {
          const name = String(args.module ?? '');
          if (!name) throw new Error('start 指令缺少 module');
          await this.startModule(name, 'cli');
          result.result = { module: name, status: this.modules.get(name)?.status };
          break;
        }
        case 'stop': {
          const name = String(args.module ?? '');
          if (!name) throw new Error('stop 指令缺少 module');
          await this.stopModule(name);
          result.result = { module: name, status: this.modules.get(name)?.status };
          break;
        }
        case 'send': {
          // 定向发送：无论目标模块是否声明了 listen，都直接把事件信息送达；targets '*' = 广播
          const name = String(args.name ?? '');
          if (!name) throw new Error('send 指令缺少 name');
          const targets = args.targets;
          const all = targets === undefined || targets === null || targets === '*';
          const wanted = all
            ? null
            : (Array.isArray(targets)
                ? targets.map(String)
                : String(targets).split(',').map((s) => s.trim()).filter(Boolean));
          const recipients = all
            ? [...this.modules.values()].filter(running)
            : wanted!.map((nm) => this.modules.get(nm)).filter((m): m is ModuleSlot => !!m && running(m));
          const payload: CoreEvent = { name, data: args.data };
          if (recipients.length === 0) {
            this.writeLog(LOG_TYPES.EVENT_DROP, source, name, { event: name, data: args.data, note: 'cli 定向发送: 无有效接收模块' });
          } else {
            this.writeLog(LOG_TYPES.EVENT, source, name, { event: name, data: args.data, recipients: recipients.map((m) => m.name), directed: true });
            for (const m of recipients) {
              try {
                await m.def!.onEvent!(m.ctx!, payload);
              } catch (err) {
                this.writeLog(LOG_TYPES.ERROR, m.name, '处理定向事件失败: ' + (err instanceof Error ? err.message : String(err)), {
                  event: name,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }
          result.result = { recipients: recipients.map((m) => m.name) };
          break;
        }
        case 'state': {
          const modules = [...this.modules.values()].map((m) => ({ name: m.name, status: m.status, startedAt: m.startedAt, error: m.error }));
          result.result = { modules, arrays: this.arrays.list() };
          break;
        }
        case 'exit': {
          // 退出：先写结果 + 完成门铃（CLI 收到后才能读到 core:results），再停核心
          result.ok = true;
          result.result = { stopped: true };
          this.arrays.get(CORE_RESULTS_ARRAY).push(result);
          await this.sendEvent(CLI_DONE_EVENT, {}, 'core');
          await this.stop();
          return;
        }
        default:
          throw new Error('未知 CLI 指令: ' + cmd);
      }
      result.ok = true;
      entry.status = 'done';
    } catch (err) {
      result.ok = false;
      result.error = err instanceof Error ? err.message : String(err);
      entry.status = 'error';
      this.writeLog(LOG_TYPES.ERROR, 'core', 'CLI 指令执行失败: ' + (err instanceof Error ? err.message : String(err)), { command: cmd });
    }
    this.arrays.get(CORE_RESULTS_ARRAY).push(result);
    await this.sendEvent(CLI_DONE_EVENT, {}, 'core');
  }

  // ==================== 模块配置热加载（监听模块文件夹） ====================

  private handleConfigLoad(cfg: ModuleConfig, yamlPath: string): void {
    this.modules.set(cfg.name, {
      name: cfg.name,
      config: cfg,
      yamlPath,
      status: 'stopped',
    });
    this.writeLog(LOG_TYPES.CONFIG_LOAD, cfg.name, `加载配置 ${cfg.name}`, {
      module: cfg.name,
      file: cfg.file,
    });
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
    this.writeLog(LOG_TYPES.CONFIG_UPDATE, cfg.name, `更新配置 ${cfg.name}`, {
      module: cfg.name,
      file: cfg.file,
    });
    if (wasRunning) {
      // 配置变化：重启模块以应用新配置（旧数组随停止消失，start 重新映射新对象）
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
    this.writeLog(LOG_TYPES.CONFIG_REMOVE, name, `移除配置 ${name}`, { module: name });
  }

  // ==================== 公共数组（映射语义） ====================

  /** 公开数组：把模块的数组对象映射到名字（存引用，不拷贝）。 */
  exposeArray(name: string, owner: string, items: unknown[] = []): void {
    this.arrays.expose(name, owner, items);
  }

  /** 取消公开数组（仅拥有者）。 */
  unexposeArray(name: string, owner: string): void {
    this.arrays.unexpose(name, owner);
  }

  /** 拉取特定数组：返回被映射的对象引用（O(1)），像原生数组一样直接使用。 */
  array<T = any>(name: string): T[] {
    return this.arrays.get<T>(name);
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

  /** 模块自有日志（模块显式请求核心记录，type=module-log）。 */
  logModule(moduleName: string, ...parts: unknown[]): void {
    this.writeLog(LOG_TYPES.MODULE_LOG, moduleName, parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '), {
      module: moduleName,
    });
  }
}
