/**
 * Connect-Core 核心：一个极简的中间层，同时是整个软件的核心层。
 *
 * 职责（对应 REQUIREMENTS.md 第 3 节"框架核心方法"）：
 *   1. 启动模块        -> startModule
 *   2. 关闭模块        -> stopModule（关闭时其公开数组自动取消映射、自然消失）
 *   3. 发送事件消息    -> sendEvent（比对事件：启动匹配模块 + 向监听模块转发）
 * 框架其余功能：
 *   - 自产事件：核心启动时产生 "core:startup"
 *   - 监听模块文件夹：ConfigWatcher 热加载 YAML（新增/修改/删除）
 *   - 日志：只记录核心自己干的事情（三字段：type/source/message，见 logFormat.ts）
 *   - 公共数组：映射语义，公开者把数组对象映射到名字，所有人共享同一对象
 *   - CLI 指令协议：委托给 CliProtocol（独立文件）；目标为 core 的定向信息被转交
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
 *   stop() -> 逐个调用模块 stop() 等返回"已关闭"（超时强制关闭）-> 关闭日志。
 *
 * 文件组织（一个文件 = 一个功能部分，避免碎片化）：
 *   - 本文件：核心类本体 —— 生命周期 / 核心方法 / 事件派发 / 配置热加载 / 公共数组 API / 查询；
 *   - CliProtocol.ts：CLI 指令协议（定向指令 + 结果回传），独立成文件；
 *   - 其余每个 core/*.ts 一个功能部分（见 README §6 目录结构）。
 */
import * as path from 'path';
import { EventStreamLog } from './EventStreamLog';
import { ArrayRegistry } from './ArrayRegistry';
import { ConfigWatcher } from './ConfigWatcher';
import { ModuleContext } from './ModuleContext';
import { anyEventMatches } from './EventMatcher';
import { MatchIndex } from './MatchIndex';
import { CliProtocol } from './CliProtocol';
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

/** 日志内存副本的默认条数上限（超出丢最旧的；落盘文件不受影响）。 */
const DEFAULT_MAX_LOG_MEMORY_ENTRIES = 20000;
/** 停止等待上限的默认值（毫秒）：停机时等待全部模块返回"已关闭"的总时限，超时强制关闭。 */
const DEFAULT_STOP_TIMEOUT_MS = 20000;
/** 判定是否为"人为/配置驱动"的启动：可解除启动超时后的自动重试锁定。 */
function isManualishStart(reason?: string): boolean {
  return reason === 'manual' || reason === 'cli' || reason === 'config-load' || reason === 'config-update' || reason === 'restart';
}

/** 模块槽位：一个 YAML 配置对应的全部运行时状态。 */
interface ModuleSlot {
  name: string;
  config: ModuleConfig;
  yamlPath: string;
  def?: ModuleDefinition;
  ctx?: ModuleContext;
  status: 'running' | 'stopped' | 'failed' | 'starting';
  /** 加载序号：索引查找后按此恢复与全量遍历一致的顺序 */
  seq: number;
  /** 启动代数：关闭/取消会使旧的启动尝试作废（陈旧结果不得写回状态） */
  startSeq: number;
  /** 进行中的启动过程：同一模块同时只允许一次启动尝试，防止事件风暴重复拉起 */
  inflightStart?: Promise<void>;
  /** 启动超时后置位：不再因事件自动重试（悬挂函数无法终止，重复尝试只会堆积），
   *  需手动启动或配置更新解锁。 */
  startTimedOut?: boolean;
}

/** 模块启动原因 -> 人类可读描述（用于 module-start 日志的 message）。 */
function describeStartReason(reason?: string): string {
  if (!reason || reason === 'manual') return '手动启动';
  if (reason === 'config-load') return '配置加载，启动事件已发生';
  if (reason === 'config-update') return '配置更新，重新启动';
  if (reason === 'restart') return '模块请求重启';
  return `事件 ${reason} 匹配启动条件`;
}

export class ConnectCore {
  /** 事件流水日志（只记录核心自己干的事情）。 */
  readonly log: EventStreamLog;
  /** 核心选项（已解析为绝对路径）。 */
  readonly options: Required<ConnectCoreOptions>;

  private arrays = new ArrayRegistry();
  private modules = new Map<string, ModuleSlot>();
  /** 事件比对索引：startEvents 与 listen 各自一份（配置变更时重建，模块启停不碰索引）。 */
  private startIndex = new MatchIndex<ModuleSlot>();
  private listenIndex = new MatchIndex<ModuleSlot>();
  private slotSeq = 0;
  private watcher?: ConfigWatcher;
  private startedFlag = false;
  /** CLI 指令协议处理器（惰性创建：只有真的收到定向指令才实例化，普通核心零污染）。 */
  private cliProtocolInst?: CliProtocol;
  /** 停机中标记：置位后拒绝外部事件/启动/配置变更，保证关闭过程是事务。 */
  private stoppingFlag = false;
  /** 进程级兜底：开启 guardProcess 的核心集合与已安装的处理句柄。 */
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
  }

  get started(): boolean {
    return this.startedFlag;
  }

  /** 统一日志出口：记录一条核心自己的日志（三字段：type/source/message + 附加字段）。
   *  协议/管理面（如 CliProtocol）也从这里记录，保证所有核心动作进入事件流水。 */
  writeLog(type: LogType, source: string, message: string, extra: Record<string, unknown> = {}): void {
    this.log.record({ type, source, message, ...extra });
  }

  /** 进程级兜底（guardProcess 开启时安装一次，全部开启者共享）：
   *  模块私下发起的异步失败与漏网的同步异常不再杀死进程，只进事件流水。
   *  注意：捕获 uncaughtException 后进程会带伤继续运行，宿主需自行权衡。 */
  private static installProcessGuard(): void {
    if (ConnectCore.processGuardInstalled) return;
    ConnectCore.processGuardInstalled = true;
    const fmt = (e: unknown): string => (e instanceof Error ? (e.stack ?? e.message) : String(e));
    process.on('unhandledRejection', (reason) => {
      const text = '捕获未处理的异步失败(Promise): ' + fmt(reason);
      if (ConnectCore.guardedCores.size === 0) console.error('[connect-core] ' + text);
      for (const core of ConnectCore.guardedCores) core.writeLog(LOG_TYPES.ERROR, 'core', text);
    });
    process.on('uncaughtException', (err) => {
      const text = '捕获未捕获异常(进程继续运行): ' + fmt(err);
      if (ConnectCore.guardedCores.size === 0) console.error('[connect-core] ' + text);
      for (const core of ConnectCore.guardedCores) core.writeLog(LOG_TYPES.ERROR, 'core', text);
    });
  }

  // ==================== 生命周期：启动核心 == 启动整个软件 ====================

  async start(): Promise<void> {
    if (this.startedFlag) throw new Error('Connect-Core 已经启动，请勿重复启动');
    this.startedFlag = true;
    if (this.options.guardProcess) {
      ConnectCore.guardedCores.add(this);
      ConnectCore.installProcessGuard();
    }
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
    await this.sendEvent('startup', undefined, 'core');
  }

  /** 停止整个软件。协议很简单：
   *  ① 对每个运行模块调用 stop() 钩子——stop() 返回（resolve）即该模块"已关闭"；
   *  ② 等待全部模块返回"已关闭"：全部返回 → 关闭自己；超过 stopTimeoutMs 仍未返回 → 强制关闭。
   */
async stop(): Promise<void> {
    if (!this.startedFlag || this.stoppingFlag) return;
    this.stoppingFlag = true;
    // 冻结文件面：停机期间不再加载/更新/移除配置，杜绝"关到一半冒出新模块"的复活竞态。
    await this.watcher?.stop();
    // ① 触发全部运行模块的停止逻辑，收集"已关闭"承诺（stop() 返回即"已关闭"）
    const closing: Promise<void>[] = [];
    for (const m of [...this.modules.values()]) {
      if (m.status === 'stopped' || m.status === 'failed') continue;
      if (m.status === 'starting') {
        // 启动尚未完成：作废这次启动（代数+1，陈旧结果不得写回），真正的启动流程稍后自行收尾。
        m.startSeq++;
        m.status = 'stopped';
        m.inflightStart = undefined;
        const cancelled = this.arrays.removeOwner(m.name);
        this.writeLog(LOG_TYPES.MODULE_STOP, m.name, '启动过程中被取消，模块停止', {
          module: m.name,
          removedArrays: cancelled,
        });
        continue;
      }
      const close = (async () => {
        try {
          await m.def?.stop?.(m.ctx!);
        } catch (err) {
          this.writeLog(LOG_TYPES.ERROR, m.name, `关闭钩子失败: ${err instanceof Error ? err.message : String(err)}`, {
            module: m.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        m.status = 'stopped';
        // 模块关闭 -> 其公开数组映射全部注销（数据随拥有者消失，不留残档）。
        const removed = this.arrays.removeOwner(m.name);
        this.writeLog(
          LOG_TYPES.MODULE_STOP,
          m.name,
          removed.length > 0 ? `关闭模块，清理 ${removed.length} 个公共数组` : '关闭模块',
          { module: m.name, removedArrays: removed },
        );
      })();
      closing.push(close);
    }
    // ② 等待全部"已关闭"：全部返回 -> 关闭自己；超时 -> 强制关闭
    const allClosed = Promise.all(closing).then(() => true).catch(() => true);
    const timeout = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), this.options.stopTimeoutMs);
      timer.unref?.();
    });
    const closed = await Promise.race([allClosed, timeout]);
    if (!closed) {
      const pending = [...this.modules.values()].filter((m) => m.status === 'running').map((m) => m.name);
      this.writeLog(
        LOG_TYPES.ERROR,
        'core',
        `停止超时：${this.options.stopTimeoutMs}ms 内还有模块未返回"已关闭"，强制关闭` + (pending.length > 0 ? `：${pending.join(', ')}` : ''),
        { timeoutMs: this.options.stopTimeoutMs, pending },
      );
    }
    // ③ 收尾：核心自身的数组也遵守"拥有者消失即注销"的数组规则。
    this.arrays.removeOwner('core');
    this.startedFlag = false;
    this.stoppingFlag = false;
    this.writeLog(LOG_TYPES.CORE_STOP, 'core', '核心关闭');
    await this.log.close();
  }  /** 立即重新扫描模块文件夹（测试/管理用）。 */
  async rescanModules(): Promise<void> {
    if (this.stoppingFlag) return;
    await this.watcher?.rescan();
  }

  // ==================== 框架核心方法 ====================

  /** 核心方法 1：启动模块。reason 为触发启动的事件名（用于日志）。
   *  启动全程有"代数"护航：关闭/取消会使旧的启动尝试作废，陈旧结果不得写回状态。
   *  同一模块同时只允许一次启动尝试；可配置超时（YAML 的 startTimeoutMs 或核心选项），
   *  超时只放弃等待并记日志——悬挂的启动函数本身无法终止，但会被锁住不再自动重试。
   *  每次启动都从磁盘重新加载模块程序（重启因此拿到最新代码）。 */
  async startModule(name: string, reason?: string): Promise<void> {
    return this.startModuleCore(name, reason, undefined);
  }

  /** 请求自身重启：模块（或宿主）替换代码文件后调用本方法，核心先验证新代码再停旧启新。
   *   - 新代码（loadModuleProgram）加载失败：记录 error、返回 false，旧实例继续运行不受影响
   *     （原子替换：验证不过就绝不更换，模块无需担心替换过程中途出错）；
   *   - 加载成功：停止旧实例（其公开数组随拥有者消失）→ 用已验证的 def 直接启动新实例，
   *     不重新加载（避免工厂函数重复求值产生的副作用）；
   *   - 状态保存与恢复、版本管理都是模块自己的职责（核心不迁移任何模块变量、不记录版本）。
   *  返回是否完成替换。 */
  async reloadModule(name: string): Promise<boolean> {
    const slot = this.modules.get(name);
    if (!slot) throw new Error(`未知模块: ${name}`);
    if (!this.startedFlag) throw new Error('核心未启动，不能重启模块');
    if (this.stoppingFlag) {
      this.writeLog(LOG_TYPES.MODULE_SKIP, name, '核心正在关闭，跳过重启', { module: name, reason: 'core-stopping' });
      return false;
    }
    if (slot.inflightStart) {
      this.writeLog(LOG_TYPES.MODULE_SKIP, name, '模块启动/重启进行中，跳过重启', {
        module: name,
        reason: 'restart-in-progress',
      });
      return false;
    }
    if (!slot.config.enabled) {
      this.writeLog(LOG_TYPES.MODULE_SKIP, name, '模块被禁用，跳过重启', { module: name, reason: 'disabled' });
      return false;
    }
    // ① 先验证新代码：加载失败则保留旧实例继续运行（重启不会"换到一半坏掉"）
    let def: ModuleDefinition;
    try {
      def = await loadModuleProgram(slot.config.file);
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      this.writeLog(LOG_TYPES.ERROR, name, `重启失败: 新代码加载出错，保留旧实例继续运行: ${em}`, {
        module: name,
        error: em,
      });
      return false;
    }
    this.writeLog(LOG_TYPES.MODULE_RESTART, name, '模块请求重启：验证通过，停旧启新', {
      module: name,
      file: slot.config.file,
    });
    // ② 停止旧实例（stop() 返回即"已关闭"；数组随旧拥有者消失）
    if (slot.status === 'running' || slot.status === 'starting') {
      await this.stopModule(name);
    }
    // ③ 重新启动（用已验证的 def，不重复加载）
    await this.startModuleCore(name, 'restart', def);
    return true;
  }  /** 启动的实际执行体：preloadedDef 提供时不再加载代码（重启复用已验证的 def）；
   *  不提供则每次启动都从磁盘加载（配置更新/事件启动的常规路径）。 */
  private async startModuleCore(name: string, reason: string | undefined, preloadedDef?: ModuleDefinition): Promise<void> {
    const slot = this.modules.get(name);
    if (!slot) throw new Error(`未知模块: ${name}`);
    if (!this.startedFlag) throw new Error('核心未启动，不能启动模块');
    if (this.stoppingFlag) {
      this.writeLog(LOG_TYPES.MODULE_SKIP, name, '核心正在关闭，跳过启动', { module: name, reason: 'core-stopping' });
      return;
    }
    // 幂等：事件密集到达时同模块可能被多次点名，已在跑/正在启动/被禁用的直接跳过。
    if (slot.status === 'running') {
      this.writeLog(LOG_TYPES.MODULE_SKIP, name, '模块已在运行，跳过启动', {
        module: name,
        reason: 'already-running',
      });
      return;
    }
    if (slot.inflightStart) {
      this.writeLog(LOG_TYPES.MODULE_SKIP, name, '模块启动进行中，跳过重复启动', {
        module: name,
        reason: 'start-in-progress',
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
    if (slot.startTimedOut && !isManualishStart(reason)) {
      this.writeLog(LOG_TYPES.MODULE_SKIP, name, '此前启动超时已放弃自动重试，需手动启动或更新配置解锁', {
        module: name,
        reason: 'start-timeout-lock',
      });
      return;
    }
    slot.startSeq++;
    const seq = slot.startSeq;
    slot.status = 'starting';
    const timeoutMs = Math.max(0, Math.round(slot.config.startTimeoutMs ?? this.options.defaultStartTimeoutMs ?? 0));
    const run = (async () => {
      try {
        const def = preloadedDef ?? (await loadModuleProgram(slot.config.file));
        const ctx = new ModuleContext(this, name, slot.config);
        // 等待启动函数完成；配置了超时则只等到期限——超时不终止函数本身（JS 无法强杀），只是不再等它。
        let timedOut = false;
        let startError: unknown;
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = (): void => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };
          const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; finish(); }, timeoutMs) : null;
          Promise.resolve()
            .then(() => def.start?.(ctx))
            .then(finish, (e) => { startError = e; finish(); });
          if (timer) timer.unref();
        });
        if (timedOut) {
          if (seq !== slot.startSeq || this.stoppingFlag || !this.startedFlag) return; // 已被取消，结果作废
          slot.startTimedOut = true;
          slot.status = 'failed';
          this.writeLog(LOG_TYPES.MODULE_START_TIMEOUT, name,
            `启动超时：超过 ${timeoutMs}ms 未完成，放弃等待并标记失败（自动重试已锁定）`,
            { module: name, timeoutMs });
          return;
        }
        if (startError) throw startError;
        // 启动完成前若已被关闭/取消：立即回收这次启动，不写入运行状态（防复活）。
        if (seq !== slot.startSeq || this.stoppingFlag || !this.startedFlag) {
          try { await def.stop?.(ctx); } catch { /* 回收失败忽略：核心都在关了 */ }
          if (seq === slot.startSeq) slot.status = 'stopped';
          return;
        }
        slot.def = def;
        slot.ctx = ctx;
        slot.status = 'running';
        slot.startTimedOut = false;
        this.writeLog(LOG_TYPES.MODULE_START, name, describeStartReason(reason), {
          module: name,
          file: slot.config.file,
          reason: reason ?? 'manual',
        });
      } catch (err) {
        if (seq !== slot.startSeq) return; // 陈旧尝试，结果作废
        slot.status = 'failed';
        const em = err instanceof Error ? err.message : String(err);
        this.writeLog(LOG_TYPES.ERROR, name, `启动失败: ${em}`, {
          module: name,
          error: em,
        });
      } finally {
        if (seq === slot.startSeq) slot.inflightStart = undefined;
      }
    })();
    slot.inflightStart = run;
    await run;
  }

  /** 核心方法 2：关闭单个模块。关闭后其公开的数组自动取消映射（自然消失，不留残档）。
   *  停止一个模块：调用其 stop() 钩子并等待返回——模块的 stop() 返回即"已关闭"。
   *  （全局停机由 stop() 统一广播 + 等待 + 超时强制关闭；本方法用于 CLI 停止指令、
   *  配置 enabled:false、以及模块请求重启时的停止环节。）
   */
async stopModule(name: string): Promise<void> {
    const slot = this.modules.get(name);
    if (!slot) throw new Error(`未知模块: ${name}`);
    if (slot.status === 'starting') {
      // 启动尚未完成：作废这次启动（代数+1，陈旧结果不得写回），真正的启动流程稍后自行收尾。
      slot.startSeq++;
      slot.status = 'stopped';
      slot.inflightStart = undefined;
      const cancelled = this.arrays.removeOwner(name);
      this.writeLog(LOG_TYPES.MODULE_STOP, name, '启动过程中被取消，模块停止', {
        module: name,
        removedArrays: cancelled,
      });
      return;
    }
    if (slot.status !== 'running') {
      this.writeLog(LOG_TYPES.MODULE_SKIP, name, '模块未在运行，跳过关闭', {
        module: name,
        reason: 'not-running',
      });
      return;
    }
    // 停止单个模块：调用 stop() 钩子并等待其返回——模块的 stop() 返回即"已关闭"。
    // （全局停机走 stop() 的并行等待 + 超时强制关闭；这里用于单模块的停止指令/配置禁用）
    try {
      await slot.def?.stop?.(slot.ctx!);
    } catch (err) {
      this.writeLog(LOG_TYPES.ERROR, name, `关闭钩子失败: ${err instanceof Error ? err.message : String(err)}`, {
        module: name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    slot.status = 'stopped';
    // 模块关闭 -> 其公开数组映射全部注销（数据随拥有者消失，不留残档）。
    const removed = this.arrays.removeOwner(name);
    this.writeLog(
      LOG_TYPES.MODULE_STOP,
      name,
      removed.length > 0 ? `关闭模块，清理 ${removed.length} 个公共数组` : '关闭模块',
      { module: name, removedArrays: removed },
    );
  }  /** 核心方法 3：发送事件消息。核心比对事件：启动匹配的模块 + 向监听模块转发。
   *  事件为两段式：事件名 = 来源:事件名，来源段由这里按调用方自动拼装；
   *  调用方（模块 ctx.sendEvent / 核心自产 / 宿主）只负责给事件名段与内容 data。 */
  async sendEvent(name: string, data?: unknown, source: string = 'external'): Promise<void> {
    if (!this.startedFlag) throw new Error('Connect-Core 未启动，不能发送事件');
    // 停机期间冻结事件面：外部与模块的事件一律拒绝（核心自产的关闭广播走 dispatch 内部通道）
    if (this.stoppingFlag && source !== 'core') {
      throw new Error('Connect-Core 正在关闭，不能再发送事件');
    }
    return this.dispatch(name, data, source);
  }

  /** 事件派发的实际执行体：sendEvent 校验后的内部通道。 */
  private async dispatch(name: string, data?: unknown, source: string = 'external'): Promise<void> {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('事件名必须是非空字符串');
    }
    // 两段式事件名：来源段由核心按调用方自动拼装（模块名 / core / external），模块无法伪造
    const fullName = source + ':' + name;
    const event: CoreEvent = { name: fullName, data };

    // 同一事件可兼两种角色：对"没在跑"是启动信号（startEvents），对"在跑"是工作指令（listen）。
    // 1) 比对启动事件：未运行的模块若 startEvents 匹配，则启动它（索引查找，跳过全量比对）
    const toStart = this.dedupSorted(this.startIndex.lookup(fullName)).filter(
      (m) => m.status !== 'running' && m.config.enabled,
    );
    for (const m of toStart) {
      await this.startModule(m.name, fullName);
    }

    // 2) 比对监听事件：收集匹配的监听模块，记录核心动作（转发或丢弃）
    const listeners = this.dedupSorted(this.listenIndex.lookup(fullName)).filter((m) => this.isDeliverable(m));
    if (listeners.length === 0) {
      this.writeLog(LOG_TYPES.EVENT_DROP, source, fullName, { event: fullName, data });
    } else {
      this.writeLog(LOG_TYPES.EVENT, source, fullName, {
        event: fullName,
        data,
        recipients: listeners.map((m) => m.name),
      });
    }

    // 3) 向监听模块发送事件消息（单个模块失败不影响其他模块）
    await this.deliverTo(listeners, event, `处理事件 ${fullName} 失败: `);
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
   * 与 sendEvent 的区别：不比对启动条件、不走事件路由表。
   * 事件名同样为两段式（来源:事件名），来源段按调用方拼装。
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
    const fullName = source + ':' + name;
    if (recipients.length === 0) {
      this.writeLog(LOG_TYPES.EVENT_DROP, source, fullName, { event: fullName, data, note: '定向发送: 无有效接收模块' });
    } else {
      this.writeLog(LOG_TYPES.EVENT, source, fullName, { event: fullName, data, recipients: recipients.map((m) => m.name), directed: true });
      await this.deliverTo(recipients, { name: fullName, data }, '处理定向事件失败: ');
    }
    return recipients.map((m) => m.name);
  }

  // ==================== 定向信息（信息直达：模块对模块 点对点直通） ====================

  /**
   * 定向发送一条纯消息（信息直达）：直接投递给指定的接收方，不经事件比对、不进公共数组。
   *  - target === 'core'：核心作为可寻址收件方（如 CLI 指令），结果由核心用 sendTo 直接回传；
   *  - target === 模块名：投递给"运行中且实现了 onMessage"的模块（显式 opt-in），失败隔离；
   *  - 其余：没有接收方，记日志并返回 false。
   * 消息带 source（发送者模块名，自动打、不可伪造）+ 内容 data。返回是否送达。
   */
  async sendTo(target: string, data?: unknown, source: string = 'external'): Promise<boolean> {
    if (!this.startedFlag) throw new Error('Connect-Core 未启动，不能发送定向消息');
    if (this.stoppingFlag && source !== 'core') {
      throw new Error('Connect-Core 正在关闭，不能再发送定向消息');
    }
    const message: DirectedMessage = { source, data };

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

  // ==================== CLI 指令协议（委托 CliProtocol） ====================

  /** 惰性获取 CLI 指令协议处理器：只有真的收到定向指令才创建，普通核心保持零污染。 */
  private get cliProtocol(): CliProtocol {
    if (!this.cliProtocolInst) this.cliProtocolInst = new CliProtocol(this);
    return this.cliProtocolInst;
  }

  // ==================== 模块配置热加载（监听模块文件夹） ====================

  /** 重建事件比对索引：从当前模块配置全量重建（配置加载/更新/移除时调用）。 */
  private rebuildIndexes(): void {
    const start: { pattern: string; slot: ModuleSlot }[] = [];
    const listen: { pattern: string; slot: ModuleSlot }[] = [];
    for (const m of this.modules.values()) {
      for (const p of m.config.startEvents ?? []) start.push({ pattern: p, slot: m });
      for (const p of m.config.listen ?? []) listen.push({ pattern: p, slot: m });
    }
    this.startIndex.rebuild(start);
    this.listenIndex.rebuild(listen);
  }

  /** 配置加载：接受注册返回 true；拒绝（模块名已被其他 YAML 占用）返回 false。
   *  同名模块一律不准注册 —— 名字是模块的全局身份，允许顶替等于允许"伪装成同名模块"上线
   *  （防注入风险）。拒绝的文件不被 watcher 记账，每轮扫描都会重新请求并各记一条 error，
   *  持续可见直到同名问题被修复（与坏 YAML 的"每轮重试提醒"同语义）。 */
  private handleConfigLoad(cfg: ModuleConfig, yamlPath: string): boolean {
    if (this.stoppingFlag) return true; // 停机中：文件面已冻结，此处只兜住在途扫描的收尾
    const existing = this.modules.get(cfg.name);
    if (existing) {
      // 已有同名模块：无论其是否运行，一律拒绝新文件注册
      this.writeLog(LOG_TYPES.ERROR, cfg.name,
        `配置加载被拒绝：模块名 ${cfg.name} 已被 ${existing.yamlPath} 注册（同名模块不允许安装）`,
        { module: cfg.name, file: cfg.file, conflict: existing.yamlPath },
      );
      return false;
    }
    this.modules.set(cfg.name, {
      name: cfg.name,
      config: cfg,
      yamlPath,
      status: 'stopped',
      seq: ++this.slotSeq,
      startSeq: 0,
    });
    this.rebuildIndexes();
    this.writeLog(LOG_TYPES.CONFIG_LOAD, cfg.name, `加载配置 ${cfg.name}`, {
      module: cfg.name,
      file: cfg.file,
    });
    return true;
  }

  /** 配置更新：本文件（yamlPath 相同）的更新照常应用返回 true；
   *  别的文件来抢同名模块名（yamlPath 不同）返回 false —— 拒绝顶替，防同名伪装。
   *  **YAML 更新只重载 YAML 本身，不重载代码、不重启模块**（代码重载由模块自行发起，
   *  见 requestReload）。应用范围：
   *   - 更新模块注册（config 字段）与比对索引（startEvents/listen 变化即时生效）；
   *   - 运行中的模块：刷新其 ctx.config 引用（模块自行决定何时读取/如何应用新配置），
   *     实例与代码不动；
   *   - 配置把 enabled 改为 false：停止运行中的模块（配置驱动的停止，同样不重载代码）；
   */
  private async handleConfigUpdate(cfg: ModuleConfig, yamlPath: string): Promise<boolean> {
    if (this.stoppingFlag) return true; // 停机中：不再应用任何配置变化
    const prev = this.modules.get(cfg.name);
    // 同名不同文件：本文件不是该模块名当前归属的 YAML，拒绝应用（模块名全局唯一，先注册者保留）
    if (prev && prev.yamlPath !== yamlPath) {
      this.writeLog(LOG_TYPES.ERROR, cfg.name,
        `配置更新被拒绝：模块名 ${cfg.name} 已被 ${prev.yamlPath} 占用（同名模块不允许安装）`,
        { module: cfg.name, file: cfg.file, conflict: prev.yamlPath },
      );
      return false;
    }
    const wasRunning = prev?.status === 'running';
    this.modules.set(cfg.name, {
      name: cfg.name,
      config: cfg,
      yamlPath,
      status: wasRunning ? 'running' : prev?.status ?? 'stopped',
      def: prev?.def,
      ctx: prev?.ctx,
      seq: prev?.seq ?? ++this.slotSeq,
      startSeq: (prev?.startSeq ?? 0) + 1, // 配置更新使旧代启动全部作废
    });
    // 运行中的模块：只刷新配置引用，不重启、不重载代码
    if (wasRunning && prev?.ctx) {
      prev.ctx.refreshConfig(cfg);
    }
    this.rebuildIndexes();
    this.writeLog(LOG_TYPES.CONFIG_UPDATE, cfg.name, `更新配置 ${cfg.name}（YAML 层生效，模块实例与代码不动）`, {
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
    const slot = this.modules.get(name);
    if (!slot) return;
    if (slot.status === 'running') await this.stopModule(name);
    this.modules.delete(name);
    this.rebuildIndexes();
    this.writeLog(LOG_TYPES.CONFIG_REMOVE, name, `移除配置 ${name}`, { module: name });
  }

  // ==================== 公共数组（映射语义） ====================

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

  // ==================== 查询与模块日志 ====================

  listModules(): ModuleRuntimeInfo[] {
    return [...this.modules.values()].map((m) => ({
      name: m.name,
      config: m.config,
      status: m.status,
    }));
  }

  getModule(name: string): ModuleRuntimeInfo | undefined {
    const m = this.modules.get(name);
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