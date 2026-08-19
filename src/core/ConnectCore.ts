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
import { MatchIndex } from './MatchIndex';
import type { MatchIndexStats } from './MatchIndex';
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

/** 事件比对索引的默认字节预算（空间换时间上限，≈8000 个条件入索引）。 */
const DEFAULT_INDEX_BUDGET_BYTES = 8 * 1024 * 1024;
/** CLI 修改预算的下限（防误设把索引完全关掉）。 */
const MIN_INDEX_BUDGET_BYTES = 512 * 1024;

interface ModuleSlot {
  name: string;
  config: ModuleConfig;
  yamlPath: string;
  def?: ModuleDefinition;
  ctx?: ModuleContext;
  status: 'running' | 'stopped' | 'failed';
  startedAt?: number;
  error?: string;
  /** 加载序号：索引查找后按此恢复与全量遍历一致的顺序 */
  seq: number;
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
  /** 事件比对索引：startEvents 与 listen 各自一份（配置变更时重建，模块启停不碰索引）。 */
  private startIndex = new MatchIndex<ModuleSlot>();
  private listenIndex = new MatchIndex<ModuleSlot>();
  private slotSeq = 0;
  private watcher?: ConfigWatcher;
  private startedFlag = false;

  constructor(options: ConnectCoreOptions = {}) {
    this.options = {
      moduleDir: path.resolve(options.moduleDir ?? './modules'),
      logFile: path.resolve(options.logFile ?? './logs/event-stream.log'),
      watch: options.watch ?? true,
      pollIntervalMs: options.pollIntervalMs ?? 200,
      indexBudgetBytes: options.indexBudgetBytes ?? DEFAULT_INDEX_BUDGET_BYTES,
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
      await this.handleCliRequest(source);
      return;
    }

    this.occurred.add(name);

    // 1) 比对启动事件：未运行的模块若 startEvents 匹配，则启动它（索引查找，跳过全量比对）
    const toStart = this.dedupSorted(this.startIndex.lookup(name)).filter(
      (m) => m.status !== 'running' && m.config.enabled,
    );
    for (const m of toStart) {
      await this.startModule(m.name, name);
    }

    // 2) 比对监听事件：收集匹配的监听模块，记录核心动作（转发或丢弃）
    const listeners = this.dedupSorted(this.listenIndex.lookup(name)).filter((m) => this.isDeliverable(m));
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
    await this.deliverTo(listeners, event, `处理事件 ${name} 失败: `);
  }

  // ==================== 事件派发辅助 ====================

  /** 模块是否接收事件（运行中且实现了 onEvent）。 */
  private isDeliverable(m: ModuleSlot): boolean {
    return m.status === 'running' && !!m.def?.onEvent;
  }

  /** 索引查找可能同槽命中多次（重复条件）：去重并按加载顺序排列，保持与原全量遍历一致的顺序。 */
  private dedupSorted(list: ModuleSlot[]): ModuleSlot[] {
    const seen = new Set<ModuleSlot>();
    const out: ModuleSlot[] = [];
    for (const m of list) {
      if (!seen.has(m)) {
        seen.add(m);
        out.push(m);
      }
    }
    return out.sort((a, b) => a.seq - b.seq);
  }

  /** 逐个派发事件消息：单个模块失败只记 error 日志，不影响其他模块（失败隔离）。 */
  private async deliverTo(recipients: ModuleSlot[], event: CoreEvent, failPrefix: string): Promise<void> {
    for (const m of recipients) {
      try {
        await m.def!.onEvent!(m.ctx!, event);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.writeLog(LOG_TYPES.ERROR, m.name, failPrefix + message, { event: event.name, error: message });
      }
    }
  }

  // ==================== CLI 请求协议（门铃 + 数组） ====================

  /**
   * CLI 指令派发表：cmd -> 处理器。每个处理器只做三件事——解析参数、执行、把结果写进
   * result.result；抛错统一由 handleCliRequest 捕获并记为失败（不影响其他指令）。
   * 返回 true 表示已自行完成收尾（写结果 + 响完成门铃）——仅 exit 需要在停核心前这么做。
   */
  private readonly cliHandlers: Record<
    string,
    (args: Record<string, unknown>, result: Record<string, unknown>, source: string) => Promise<boolean | void>
  > = {
    // 生成一个自定义事件（来源沿用请求方）
    event: async (args, result, source) => {
      const name = String(args.name ?? '');
      if (!name) throw new Error('event 指令缺少 name');
      await this.sendEvent(name, args.data, source);
      result.result = { delivered: name };
    },
    // 开启模块（即使没有事件触发）
    start: async (args, result) => {
      const name = String(args.module ?? '');
      if (!name) throw new Error('start 指令缺少 module');
      await this.startModule(name, 'cli');
      result.result = { module: name, status: this.modules.get(name)?.status };
    },
    // 关闭模块（其公开数组随之消失）
    stop: async (args, result) => {
      const name = String(args.module ?? '');
      if (!name) throw new Error('stop 指令缺少 module');
      await this.stopModule(name);
      result.result = { module: name, status: this.modules.get(name)?.status };
    },
    // 定向发送：目标无需声明 listen；targets 缺失/'*' = 广播给所有运行中且实现了 onEvent 的模块
    send: async (args, result, source) => {
      const name = String(args.name ?? '');
      if (!name) throw new Error('send 指令缺少 name');
      const wanted =
        args.targets === undefined || args.targets === null || args.targets === '*'
          ? null
          : Array.isArray(args.targets)
            ? args.targets.map(String)
            : String(args.targets).split(',').map((s) => s.trim()).filter(Boolean);
      const recipients =
        wanted === null
          ? [...this.modules.values()].filter((m) => this.isDeliverable(m))
          : wanted.map((nm) => this.modules.get(nm)).filter((m): m is ModuleSlot => !!m && this.isDeliverable(m));
      if (recipients.length === 0) {
        this.writeLog(LOG_TYPES.EVENT_DROP, source, name, { event: name, data: args.data, note: 'cli 定向发送: 无有效接收模块' });
      } else {
        this.writeLog(LOG_TYPES.EVENT, source, name, { event: name, data: args.data, recipients: recipients.map((m) => m.name), directed: true });
        await this.deliverTo(recipients, { name, data: args.data }, '处理定向事件失败: ');
      }
      result.result = { recipients: recipients.map((m) => m.name) };
    },
    // 查询模块与公共数组清单
    state: async (_args, result) => {
      result.result = {
        modules: [...this.modules.values()].map((m) => ({ name: m.name, status: m.status, startedAt: m.startedAt, error: m.error })),
        arrays: this.arrays.list(),
      };
    },
    // 查询/调整事件比对索引（字节预算）：index -> 查看；index budget <MB> -> 修改预算并重建索引
    index: async (args, result) => {
      const action = String(args.action ?? 'view');
      if (action === 'budget') {
        const mb = Number(args.mb);
        if (!Number.isFinite(mb) || mb <= 0) throw new Error('index budget 需要正数 MB');
        this.options.indexBudgetBytes = Math.max(Math.round(mb * 1024 * 1024), MIN_INDEX_BUDGET_BYTES);
        this.rebuildIndexes();
        result.result = { updated: true, ...this.indexStats() };
      } else {
        result.result = this.indexStats();
      }
    },
    // 优雅关闭：先写结果 + 响完成门铃（让 CLI 读到），再停核心；已自行收尾，标记 selfDone
    exit: async (_args, result) => {
      result.ok = true;
      result.result = { stopped: true };
      this.arrays.get(CORE_RESULTS_ARRAY).push(result);
      await this.sendEvent(CLI_DONE_EVENT, {}, 'core');
      await this.stop();
      return true;
    },
  };

  /**
   * 处理 CLI 请求（门铃协议，由 sendEvent 拦截 cli:request 后调用）：
   *  ① 从 cli:commands（CLI 拥有的公开数组）取第一条未处理的指令；
   *  ② 按 cliHandlers 派发表执行它，并把该条目标记为已处理（失败记为 error）；
   *  ③ 把执行结果写入 core:results（核心自己的公开数组）；
   *  ④ 广播 cli:done 完成门铃，CLI 收到后自己读 core:results 的最新一条来展示。
   * 终端是串行的，无需 id 关联：事件只当门铃，内容/结果全走数组。
   */
  private async handleCliRequest(source: string): Promise<void> {
    // 结果信箱惰性创建：只有真的用到 CLI 协议时才出现，普通核心保持零污染
    if (!this.arrays.has(CORE_RESULTS_ARRAY)) this.exposeArray(CORE_RESULTS_ARRAY, 'core', []);

    const commands = this.arrays.get<Record<string, unknown>>(CLI_COMMANDS_ARRAY);
    const entry = commands.find((c) => c.status !== 'done' && c.status !== 'error');
    if (!entry) {
      this.writeLog(LOG_TYPES.ERROR, 'core', 'CLI 请求到达但 cli:commands 里没有待执行指令', { event: CLI_REQUEST_EVENT });
      return;
    }

    const cmd = String(entry.cmd ?? '');
    const handler = this.cliHandlers[cmd];
    this.writeLog(LOG_TYPES.CLI_COMMAND, source, 'CLI 指令: ' + cmd, { command: cmd });

    const result: Record<string, unknown> = { cmd };
    let selfDone = false;
    try {
      if (!handler) throw new Error('未知 CLI 指令: ' + cmd);
      selfDone = (await handler((entry.args ?? {}) as Record<string, unknown>, result, source)) === true;
      result.ok = true;
      entry.status = 'done';
    } catch (err) {
      result.ok = false;
      result.error = err instanceof Error ? err.message : String(err);
      entry.status = 'error';
      this.writeLog(LOG_TYPES.ERROR, 'core', 'CLI 指令执行失败: ' + (err instanceof Error ? err.message : String(err)), { command: cmd });
    }
    // 除 exit（已自行收尾）外：结果必达 CLI——成功或失败都推入 core:results 并响完成门铃
    if (!selfDone) {
      this.arrays.get(CORE_RESULTS_ARRAY).push(result);
      await this.sendEvent(CLI_DONE_EVENT, {}, 'core');
    }
  }

  // ==================== 模块配置热加载（监听模块文件夹） ====================

  /** 重建事件比对索引：从当前模块配置全量重建（配置加载/更新/移除与 CLI 改预算时调用）。 */
  private rebuildIndexes(): void {
    const start: { pattern: string; slot: ModuleSlot }[] = [];
    const listen: { pattern: string; slot: ModuleSlot }[] = [];
    for (const m of this.modules.values()) {
      for (const p of m.config.startEvents ?? []) start.push({ pattern: p, slot: m });
      for (const p of m.config.listen ?? []) listen.push({ pattern: p, slot: m });
    }
    this.startIndex.rebuild(start, this.options.indexBudgetBytes);
    this.listenIndex.rebuild(listen, this.options.indexBudgetBytes);
  }

  /** 索引状态（CLI index 指令展示用）。 */
  private indexStats(): { budgetBytes: number; start: MatchIndexStats; listen: MatchIndexStats } {
    return {
      budgetBytes: this.options.indexBudgetBytes,
      start: this.startIndex.stats(),
      listen: this.listenIndex.stats(),
    };
  }

  private handleConfigLoad(cfg: ModuleConfig, yamlPath: string): void {
    this.modules.set(cfg.name, {
      name: cfg.name,
      config: cfg,
      yamlPath,
      status: 'stopped',
      seq: ++this.slotSeq,
    });
    this.rebuildIndexes();
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
      seq: prev?.seq ?? ++this.slotSeq,
    });
    this.rebuildIndexes();
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
    this.rebuildIndexes();
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
