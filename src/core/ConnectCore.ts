/**
 * Connect-Core 核心：一个极简的中间层，同时是整个软件的核心层。
 *
 * 职责（对应 REQUIREMENTS.md 第 3 节"框架核心方法"）：
 *   1. 启动模块        -> startModule
 *   2. 关闭模块        -> stopModule（关闭时其公开数组自动取消映射、自然消失）
 *   3. 发送事件消息    -> sendEvent（比对事件：启动匹配模块 + 向监听模块转发）
 * 框架其余功能：
 *   - 自产事件：核心启动/关闭时产生 "core:startup" / "core:shutdown"
 *   - 监听模块文件夹：ConfigWatcher 热加载 YAML（新增/修改/删除）
 *   - 日志：只记录核心自己干的事情（三字段：type/source/message，见 logFormat.ts）
 *   - 公共数组：映射语义，公开者把数组对象映射到名字，所有人共享同一对象
 *   - CLI 门铃协议：委托给 CliProtocol（独立文件）；这里只负责拦截 cli:request 并转交
 *
 * 启动核心 == 启动整个软件：core.start() 会扫描模块配置并发出 core:startup，
 * 所有依赖该事件的模块自动启动，无需单独启动任何模块。
 *
 * 运行循环（整个软件的心脏，事件的流转路径）：
 *   start() -> 扫描模块目录 -> 重建比对索引 -> 发 core:startup（匹配模块自动启动）。
 *   此后每一次 sendEvent 走同一条三步流水：① 把 startEvents 命中的未运行模块拉起来
 *   （模块间的 DAG 由此涌现）；② 收集 listen 命中的监听者（无人认领则记 event-drop）；
 *   ③ 逐个派发事件消息，单点失败只记 error、不影响其他模块。
 *   配置热加载不重启核心：监听器感知到文件增/改/删，就地 加载/重启/移除 模块并重建索引。
 *   stop() -> 先发 core:shutdown 让模块收尾 -> 逆序停止、注销公共数组 -> 关闭日志。
 *
 * 文件组织（一个文件 = 一个功能部分，避免碎片化）：
 *   - 本文件：核心类本体 —— 生命周期 / 核心方法 / 事件派发 / 配置热加载 / 公共数组 API / 查询；
 *   - CliProtocol.ts：CLI 门铃协议（事件=门铃、数组=内容 的约定式联动），独立成文件；
 *   - 其余每个 core/*.ts 一个功能部分（见 README §6 目录结构）。
 */
import * as path from 'path';
import { EventStreamLog } from './EventStreamLog';
import { ArrayRegistry } from './ArrayRegistry';
import { ConfigWatcher } from './ConfigWatcher';
import { ModuleContext } from './ModuleContext';
import { anyEventMatches } from './EventMatcher';
import { MatchIndex } from './MatchIndex';
import type { MatchIndexStats } from './MatchIndex';
import { CliProtocol, CLI_REQUEST_EVENT } from './CliProtocol';
import { LOG_TYPES } from './logFormat';
import type { LogType } from './logFormat';
import { loadModuleProgram } from '../module/loadModule';
import type {
  ConnectCoreOptions,
  CoreEvent,
  DirectedMessage,
  ModuleConfig,
  ModuleDefinition,
  ModuleRuntimeInfo,
} from '../types';

/** 事件比对索引的默认字节预算（空间换时间上限，≈8000 个条件入索引）。 */
const DEFAULT_INDEX_BUDGET_BYTES = 8 * 1024 * 1024;
/** 事件比对索引预算的下限（防误设把索引完全关掉）。 */
const MIN_INDEX_BUDGET_BYTES = 512 * 1024;

/** 模块槽位：一个 YAML 配置对应的全部运行时状态。 */
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

/** 模块启动原因 -> 人类可读描述（用于 module-start 日志的 message）。 */
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
  /** CLI 门铃协议处理器（惰性创建：只有真的收到 cli:request 才实例化，普通核心零污染）。 */
  private cliProtocolInst?: CliProtocol;

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

  /** 统一日志出口：记录一条核心自己的日志（三字段：type/source/message + 附加字段）。
   *  协议/管理面（如 CliProtocol）也从这里记录，保证所有核心动作进入事件流水。 */
  writeLog(type: LogType, source: string, message: string, extra: Record<string, unknown> = {}): void {
    this.log.record({ type, source, message, ...extra });
  }

  // ==================== 生命周期：启动核心 == 启动整个软件 ====================

  async start(): Promise<void> {
    if (this.startedFlag) throw new Error('Connect-Core 已经启动，请勿重复启动');
    this.startedFlag = true;
    this.writeLog(LOG_TYPES.CORE_START, 'core', '核心启动');

    // 坏 YAML 只记 error、不让核心跟着殉葬。
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
    // 先登记目录里已有的 YAML（模块均为"停"态），再发 core:startup 让匹配者自动启动。
    await this.watcher.start();
    await this.sendEvent('core:startup', undefined, 'core');
  }

  async stop(): Promise<void> {
    if (!this.startedFlag) return;
    // 先广播 core:shutdown：让仍在运行的模块抢在停止前释放资源（定时器、连接等）。
    await this.sendEvent('core:shutdown', undefined, 'core');
    // 逆序停止：模块间有隐式依赖（后起的往往消费先起的），后启动的先停，避免半悬挂。
    const running = [...this.modules.values()].filter((m) => m.status === 'running');
    for (const m of running.reverse()) {
      await this.stopModule(m.name);
    }
    await this.watcher?.stop();
    // 核心（如 CLI 协议的结果信箱 core:results）也遵守"拥有者消失即注销"的数组规则。
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
    // 幂等：事件密集到达时同模块可能被多次点名，已在跑/被禁用的直接跳过。
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
    // 模块关闭 -> 其公开数组映射全部注销（数据随拥有者消失，不留残档）。
    const removed = this.arrays.removeOwner(name);
    this.writeLog(
      LOG_TYPES.MODULE_STOP,
      name,
      removed.length > 0 ? `关闭模块，清理 ${removed.length} 个公共数组` : '关闭模块',
      { module: name, removedArrays: removed },
    );
  }

  /** 核心方法 3：发送事件消息。核心比对事件：启动匹配的模块 + 向监听模块转发。
   *  事件为两段式：head（事件头，由核心按调用方自动生成来源）由这里注入；
   *  调用方（模块 ctx.sendEvent / 核心自产 / 宿主）只负责给事件名与内容 data。 */
  async sendEvent(name: string, data?: unknown, source: string = 'external'): Promise<void> {
    if (!this.startedFlag) throw new Error('Connect-Core 未启动，不能发送事件');
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('事件名必须是非空字符串');
    }
    // 自动生成事件头（第一段）：source = 发出模块名，模块无法伪造
    const event: CoreEvent = { name, head: { source }, data };

    // CLI 请求门铃拦截：cli:request 是核心自己的协议事件（不进普通事件路由，不记入 occurred）
    if (name === CLI_REQUEST_EVENT) {
      await this.cliProtocol.handle(event.head.source);
      return;
    }

    this.occurred.add(name);

    // 同一事件可兼两种角色：对"没在跑"是启动信号（startEvents），对"在跑"是工作指令（listen）。
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

  // ==================== 定向发送（CLI send 指令的底层能力） ====================

  /**
   * 定向发送事件：只投递给指定的运行中模块（目标无需声明 listen）。
   * 与 sendEvent 的区别：不比对启动条件、不加入 occurred、不走事件路由表。
   * targets === null 时广播给所有运行中且实现了 onEvent 的模块（等价 CLI 的 send *）。
   * 返回实际接收方的模块名（顺序即投递顺序）。单个模块失败被隔离，不影响其他接收方。
   */
  async sendDirected(targets: string[] | null, name: string, data?: unknown, source: string = 'external'): Promise<string[]> {
    if (!this.startedFlag) throw new Error('Connect-Core 未启动，不能发送事件');
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('事件名必须是非空字符串');
    }
    const recipients =
      targets === null
        ? [...this.modules.values()].filter((m) => this.isDeliverable(m))
        : targets
            .map((nm) => this.modules.get(nm))
            .filter((m): m is ModuleSlot => !!m && this.isDeliverable(m));
    if (recipients.length === 0) {
      this.writeLog(LOG_TYPES.EVENT_DROP, source, name, { event: name, data, note: 'cli 定向发送: 无有效接收模块' });
    } else {
      this.writeLog(LOG_TYPES.EVENT, source, name, { event: name, data, recipients: recipients.map((m) => m.name), directed: true });
      await this.deliverTo(recipients, { name, head: { source }, data }, '处理定向事件失败: ');
    }
    return recipients.map((m) => m.name);
  }

  // ==================== 定向信息（信息直达：模块对模块 点对点直通） ====================

  /**
   * 定向发送一条纯消息（信息直达）：直接投递给指定的接收方，不经事件比对、不进公共数组。
   *  - target === 'core'：核心作为可寻址收件方（如 CLI 指令），结果由核心用 sendTo 直接回传；
   *  - target === 模块名：投递给"运行中且实现了 onMessage"的模块（显式 opt-in），失败隔离；
   *  - 其余：没有接收方，记日志并返回 false。
   * 消息只有基础头（head.source=发送者模块名，自动打、不可伪造）+ 内容 data。返回是否送达。
   */
  async sendTo(target: string, data?: unknown, source: string = 'external'): Promise<boolean> {
    if (!this.startedFlag) throw new Error('Connect-Core 未启动，不能发送定向消息');
    const message: DirectedMessage = { head: { source }, data };

    // 核心 = 可寻址收件方：指令处理器执行后，结果由它直接回传给发起方
    if (target === 'core') {
      await this.cliProtocol.handleDirected(message);
      return true;
    }

    // 模块接收方：运行中且实现了 onMessage 才会收到（不实现 = 不订阅定向消息）
    const slot = this.modules.get(target);
    if (slot && slot.status === 'running' && slot.def && slot.def.onMessage && slot.ctx) {
      try {
        await slot.def.onMessage(slot.ctx, message);
        return true;
      } catch (err) {
        const em = err instanceof Error ? err.message : String(err);
        this.writeLog(LOG_TYPES.ERROR, target, '处理定向消息失败: ' + em, { target: target, error: em });
        return true; // 已送达（对方处理失败被隔离），接收方存在就算送达
      }
    }

    this.writeLog(LOG_TYPES.EVENT_DROP, source, '定向消息未送达', { target: target, data: data, note: '目标不存在、未在运行或未实现 onMessage' });
    return false;
  }

  // ==================== CLI 门铃协议（委托 CliProtocol） ====================

  /** 惰性获取 CLI 协议处理器：只有真的收到 cli:request 才创建，普通核心保持零污染。 */
  private get cliProtocol(): CliProtocol {
    if (!this.cliProtocolInst) this.cliProtocolInst = new CliProtocol(this);
    return this.cliProtocolInst;
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

  /** 当前事件比对索引状态（核心查询 / CLI index 指令展示用）。 */
  getIndexStats(): { budgetBytes: number; start: MatchIndexStats; listen: MatchIndexStats } {
    return {
      budgetBytes: this.options.indexBudgetBytes,
      start: this.startIndex.stats(),
      listen: this.listenIndex.stats(),
    };
  }

  /** 设置事件比对索引字节预算（下限保护，防误设把索引完全关掉）并重建索引。返回最新索引状态。 */
  setIndexBudgetBytes(byteBudget: number): { budgetBytes: number; start: MatchIndexStats; listen: MatchIndexStats } {
    this.options.indexBudgetBytes = Math.max(Math.round(byteBudget), MIN_INDEX_BUDGET_BYTES);
    this.rebuildIndexes();
    return this.getIndexStats();
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
    // 新模块可能错过 core:startup：其启动事件若在 occurred 历史里出现过，立即补启动。
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
