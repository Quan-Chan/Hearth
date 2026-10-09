/**
 * 模块管理器：模块状态机与槽位注册表。
 *
 * 职责：
 *  - 持有全部模块槽位（modules Map）与注册序号（slotSeq）；
 *  - 启动/停止/重启单个模块（startModule/stopModule/reloadModule）；
 *  - 核心停机时并行停止全部模块并等待"已关闭"（stopAll，超时强制关闭）；
 *  - 配置热加载的槽位增删改（register/applyUpdate/remove，由 Hearth 的
 *    handleConfig* 调用，索引重建与日志由调用方负责）。
 *
 * 启动过程的关键机制：
 *  - 代数（startSeq）：关闭/取消会使旧的启动尝试作废，陈旧结果不得写回状态；
 *  - 单次启动锁（inflightStart）：同一模块同时只允许一次启动尝试；
 *  - 启动超时（startTimeoutMs）：超时只放弃等待并锁定自动重试，悬挂的启动函数
 *    无法终止（JS 没有强杀手段），重复尝试只会堆积。
 *
 * 依赖注入：构造时传入 Hearth 实例（只做类型引用，无运行时循环），
 * 经由 core 访问日志出口（writeLog）、选项（options）、停机标记（stopping）与
 * 对象注销（removeOwnerObjects）。
 */
import { ModuleContext } from './ModuleContext';
import { LOG_TYPES } from './logFormat';
import { loadModuleProgram } from '../module/loadModule';
import type { Hearth } from './Hearth';
import type { ModuleConfig, ModuleDefinition, ModuleSlot } from '../types';

/** 判定是否为"人为/配置驱动"的启动：这类启动可解除启动超时后的自动重试锁定。 */
function isManualishStart(reason?: string): boolean {
  return (
    reason === 'manual' ||
    reason === 'cli' ||
    reason === 'config-load' ||
    reason === 'config-update' ||
    reason === 'restart'
  );
}

/** 模块启动原因 -> 描述（用于 module-start 日志的 message）。 */
function describeStartReason(reason?: string): string {
  if (!reason || reason === 'manual') return 'manual start';
  if (reason === 'config-load') return 'config loaded, start event already fired';
  if (reason === 'config-update') return 'config updated, restarting';
  if (reason === 'restart') return 'module requested restart';
  return `event ${reason} matched start condition`;
}

export class ModuleManager {
  /** 全部模块槽位：name -> 槽（一个 YAML 配置对应全部运行时状态）。 */
  private readonly modules = new Map<string, ModuleSlot>();
  /** 槽位序号：注册顺序即模块加载顺序（索引查找后按 seq 恢复顺序）。 */
  private slotSeq = 0;

  constructor(private readonly core: Hearth) {}

  /** 全部槽位（按注册顺序）：重建比对索引与收集派发目标时使用。 */
  slots(): ModuleSlot[] {
    return [...this.modules.values()];
  }

  getSlot(name: string): ModuleSlot | undefined {
    return this.modules.get(name);
  }

  /** 核心方法 1：启动模块。reason 为触发启动的事件名（用于日志）。
   *  启动全程有"代数"机制：关闭/取消会使旧的启动尝试作废，陈旧结果不得写回状态。
   *  同一模块同时只允许一次启动尝试；可配置超时（YAML 的 startTimeoutMs 或核心选项），
   *  超时只放弃等待并记日志——悬挂的启动函数本身无法终止，同时锁住不再自动重试。
   *  每次启动都从磁盘重新加载模块程序（重启因此拿到最新代码）。 */
  async startModule(name: string, reason?: string): Promise<void> {
    await this.startModuleCore(name, reason, undefined);
  }

  /** 请求自身重启：模块（或宿主）替换代码文件后调用本方法，核心先验证新代码再停旧启新。
   *   - 新代码（loadModuleProgram）加载失败：记录 error、返回 false，旧实例继续运行不受影响
   *     （验证不过就不更换，替换不会中途出错）；
   *   - 加载成功：停止旧实例（其公开对象随拥有者消失）→ 用已验证的 def 直接启动新实例，
   *     不重新加载（避免工厂函数重复求值产生的副作用）；
   *   - 状态保存与恢复、版本管理都是模块自己的职责（核心不迁移任何模块变量、不记录版本）。
   *  返回启动完成或模块已处于运行态为 true；启动被跳过（停机中、启动中、禁用、超时锁定）
   *  或新实例启动失败为 false。 */
  async reloadModule(name: string): Promise<boolean> {
    const slot = this.modules.get(name);
    if (!slot) throw new Error(`unknown module: ${name}`);
    if (!this.core.started) throw new Error('core not started, cannot reload module');
    if (this.core.stopping) {
      this.core.writeLog(LOG_TYPES.MODULE_SKIP, name, 'core is stopping, skip reload', { reason: 'core-stopping' });
      return false;
    }
    if (slot.inflightStart) {
      this.core.writeLog(LOG_TYPES.MODULE_SKIP, name, 'module start/reload in progress, skip reload', {
        reason: 'restart-in-progress',
      });
      return false;
    }
    if (!slot.config.enabled) {
      this.core.writeLog(LOG_TYPES.MODULE_SKIP, name, 'module disabled, skip reload', { reason: 'disabled' });
      return false;
    }
    // ① 先验证新代码：加载失败则保留旧实例继续运行（替换不会中途出错）
    let def: ModuleDefinition;
    try {
      def = await loadModuleProgram(slot.config.file);
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      this.core.writeLog(LOG_TYPES.ERROR, name, `reload failed: new code load error, old instance keeps running: ${em}`, {
        error: em,
      });
      return false;
    }
    this.core.writeLog(LOG_TYPES.MODULE_RESTART, name, 'module reload: verified, stop old and start new', {
      module: name,
      file: slot.config.file,
    });
    // ② 停止旧实例（stop() 返回即"已关闭"；对象随旧拥有者消失）
    if (slot.status === 'running' || slot.status === 'starting') {
      await this.stopModule(name);
    }
    // ③ 重新启动（用已验证的 def，不重复加载）
    // 返回值取自本次启动的真实结果：启动被跳过或失败时为 false
    return this.startModuleCore(name, 'restart', def);
  }

  /** 启动的实际执行体：preloadedDef 提供时不再加载代码（重启复用已验证的 def）；
   *  不提供则每次启动都从磁盘加载（配置更新/事件启动的常规路径）。
   *  返回启动完成后模块是否处于运行态：已在运行的跳过返回 true，停机中、启动中、禁用、
   *  超时锁定等跳过与启动失败均返回 false。 */
  private async startModuleCore(name: string, reason: string | undefined, preloadedDef?: ModuleDefinition): Promise<boolean> {
    const slot = this.modules.get(name);
    if (!slot) throw new Error(`unknown module: ${name}`);
    if (!this.core.started) throw new Error('core not started, cannot start module');
    if (this.core.stopping) {
      this.core.writeLog(LOG_TYPES.MODULE_SKIP, name, 'core is stopping, skip start', { reason: 'core-stopping' });
      return false;
    }
    // 幂等：事件密集到达时同模块可能被多次点名，已在跑/正在启动/被禁用的直接跳过。
    if (slot.status === 'running') {
      this.core.writeLog(LOG_TYPES.MODULE_SKIP, name, 'module already running, skip start', {
        reason: 'already-running',
      });
      return true;
    }
    if (slot.inflightStart) {
      this.core.writeLog(LOG_TYPES.MODULE_SKIP, name, 'module start in progress, skip duplicate start', {
        reason: 'start-in-progress',
      });
      return false;
    }
    if (!slot.config.enabled) {
      this.core.writeLog(LOG_TYPES.MODULE_SKIP, name, 'module disabled, skip start', {
        reason: 'disabled',
      });
      return false;
    }
    if (slot.startTimedOut && !isManualishStart(reason)) {
      this.core.writeLog(LOG_TYPES.MODULE_SKIP, name, 'previous start timed out, auto retry locked; manual start or config update required', {
        reason: 'start-timeout-lock',
      });
      return false;
    }
    slot.startSeq++;
    const seq = slot.startSeq;
    slot.status = 'starting';
    const timeoutMs = Math.max(0, Math.round(slot.config.startTimeoutMs ?? this.core.options.defaultStartTimeoutMs ?? 0));
    // 本次尝试的 promise：闭包内用身份判定启动锁是否仍属于本人（别人接管后不动它的锁）
    let run: Promise<void> | undefined;
    run = (async () => {
      try {
        const def = preloadedDef ?? (await loadModuleProgram(slot.config.file));
        const ctx = new ModuleContext(this.core, name, slot.config);
        // 等待启动函数完成；配置了超时则只等到期限——超时不终止函数本身，只是不再等它。
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
          if (seq !== slot.startSeq || this.core.stopping || !this.core.started) return; // 已被取消，结果作废
          slot.startTimedOut = true;
          slot.status = 'failed';
          this.core.writeLog(LOG_TYPES.MODULE_START_TIMEOUT, name,
            `start timed out: not finished within ${timeoutMs}ms, gave up waiting and marked failed (auto retry locked)`,
            { timeoutMs });
          return;
        }
        if (startError) throw startError;
        // 启动完成前若已被关闭/取消：立即回收这次启动，不写入运行状态。
        // 作废实例在启动过程中公开的对象一并注销，与 stopModule/stopAll 的取消分支同一规则；
        // 此刻启动锁仍由本次尝试持有，同一模块的新启动进不来，注销的只会是本次实例的对象。
        if (seq !== slot.startSeq || this.core.stopping || !this.core.started) {
          try { await def.stop?.(ctx); } catch { /* 回收失败忽略：核心都在关了 */ }
          this.core.removeOwnerObjects(name);
          if (seq === slot.startSeq) slot.status = 'stopped';
          return;
        }
        slot.def = def;
        slot.ctx = ctx;
        slot.status = 'running';
        slot.startTimedOut = false;
        this.core.writeLog(LOG_TYPES.MODULE_START, name, describeStartReason(reason), {
          file: slot.config.file,
          reason: reason ?? 'manual',
        });
      } catch (err) {
        if (seq !== slot.startSeq) return; // 陈旧尝试，结果作废
        slot.status = 'failed';
        const em = err instanceof Error ? err.message : String(err);
        this.core.writeLog(LOG_TYPES.ERROR, name, `start failed: ${em}`, {
          error: em,
        });
      } finally {
        // 只清理本人持有的启动锁：已被别人接管（新尝试或停机收尾）时不动它的锁。
        // 本次尝试被作废（配置更新使代数递增）且无人接管时，状态收敛为未运行，不留在 starting。
        if (slot.inflightStart === run) {
          slot.inflightStart = undefined;
          if (seq !== slot.startSeq && slot.status === 'starting') slot.status = 'stopped';
        }
      }
    })();
    slot.inflightStart = run;
    await run;
    // 本次启动结束时模块是否在运行：跳过分支已各自返回，此处只剩本代真实结果
    return this.getSlot(name)?.status === 'running';
  }

  /** 核心方法 2：关闭单个模块。关闭后其公开的对象自动取消映射。
   *  停止一个模块：调用其 stop() 钩子并等待返回——模块的 stop() 返回即"已关闭"。
   *  （全局停机由 stopAll() 并行等待 + 超时强制关闭；本方法用于 CLI 停止指令、
   *  配置 enabled:false、以及模块请求重启时的停止环节。） */
  async stopModule(name: string): Promise<void> {
    const slot = this.modules.get(name);
    if (!slot) throw new Error(`unknown module: ${name}`);
    if (slot.status === 'starting') {
      // 启动尚未完成：作废这次启动（代数+1，陈旧结果不得写回），真正的启动流程稍后自行收尾。
      slot.startSeq++;
      slot.status = 'stopped';
      slot.inflightStart = undefined;
      const cancelled = this.core.removeOwnerObjects(name);
      this.core.writeLog(LOG_TYPES.MODULE_STOP, name, 'cancelled during start, module stopped', {
        removedObjects: cancelled,
      });
      return;
    }
    if (slot.status !== 'running') {
      this.core.writeLog(LOG_TYPES.MODULE_SKIP, name, 'module not running, skip stop', {
        reason: 'not-running',
      });
      return;
    }
    try {
      await slot.def?.stop?.(slot.ctx!);
    } catch (err) {
      this.core.writeLog(LOG_TYPES.ERROR, name, `stop hook failed: ${err instanceof Error ? err.message : String(err)}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    slot.status = 'stopped';
    // 模块关闭 -> 其公开对象映射全部注销。
    const removed = this.core.removeOwnerObjects(name);
    this.core.writeLog(
      LOG_TYPES.MODULE_STOP,
      name,
      removed.length > 0 ? `module stopped, removed ${removed.length} shared objects` : 'module stopped',
      { removedObjects: removed },
    );
  }

  /** 停止全部模块（核心停机时调用）。
   *  ① 对每个运行模块调用 stop() 钩子——stop() 返回（resolve）即该模块"已关闭"；
   *  ② 等待全部模块返回"已关闭"：全部返回 → 结束；超过 stopTimeoutMs 仍未返回 → 强制关闭
   *    （哪个模块未返回会被记录在错误日志里）。 */
  async stopAll(): Promise<void> {
    const closing: Promise<void>[] = [];
    for (const m of [...this.modules.values()]) {
      if (m.status === 'stopped' || m.status === 'failed') continue;
      if (m.status === 'starting') {
        // 启动尚未完成：作废这次启动（代数+1，陈旧结果不得写回），真正的启动流程稍后自行收尾。
        // 不等它的原因：启动函数可能悬挂（如等待外部资源），停机时限不应被它拖住；
        // 作废后启动流程检测到代数已变，自动回收（调用 stop 并放弃写运行状态）。
        m.startSeq++;
        m.status = 'stopped';
        m.inflightStart = undefined;
        const cancelled = this.core.removeOwnerObjects(m.name);
        this.core.writeLog(LOG_TYPES.MODULE_STOP, m.name, 'cancelled during start, module stopped', {
          removedObjects: cancelled,
        });
        continue;
      }
      const close = (async () => {
        try {
          await m.def?.stop?.(m.ctx!);
        } catch (err) {
          this.core.writeLog(LOG_TYPES.ERROR, m.name, `stop hook failed: ${err instanceof Error ? err.message : String(err)}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        m.status = 'stopped';
        // 模块关闭 -> 其公开对象映射全部注销。
        const removed = this.core.removeOwnerObjects(m.name);
        this.core.writeLog(
          LOG_TYPES.MODULE_STOP,
          m.name,
          removed.length > 0 ? `module stopped, removed ${removed.length} shared objects` : 'module stopped',
          { removedObjects: removed },
        );
      })();
      closing.push(close);
    }
    // 全部返回"已关闭" → 结束；超时 → 强制关闭
    const allClosed = Promise.all(closing).then(() => true).catch(() => true);
    const timeout = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), this.core.options.stopTimeoutMs);
      timer.unref?.();
    });
    const closed = await Promise.race([allClosed, timeout]);
    if (!closed) {
      const pending = [...this.modules.values()].filter((m) => m.status === 'running').map((m) => m.name);
      this.core.writeLog(
        LOG_TYPES.ERROR,
        'core',
        `stop timed out: modules did not return "closed" within ${this.core.options.stopTimeoutMs}ms, forcing close` + (pending.length > 0 ? `: ${pending.join(', ')}` : ''),
        { timeoutMs: this.core.options.stopTimeoutMs, pending },
      );
    }
  }

  /** 配置加载：注册新模块槽位。模块名已被其他 YAML 占用时拒绝（返回 false）——
   *  名字是模块的身份标识，允许顶替等于允许"伪装成同名模块"上线（防注入）。
   *  注册只维护槽位表；索引重建与 config-load 日志由调用方（Hearth）负责。 */
  register(cfg: ModuleConfig, yamlPath: string): boolean {
    if (this.modules.has(cfg.name)) return false;
    this.modules.set(cfg.name, {
      name: cfg.name,
      config: cfg,
      yamlPath,
      status: 'stopped',
      seq: ++this.slotSeq,
      startSeq: 0,
    });
    return true;
  }

  /** 配置更新：应用新配置到槽位（配置层生效，模块实例与代码不动）。
   *   - 就地更新槽位（config 字段）与启动代数（旧代启动全部作废）；
   *   - 运行中的模块：刷新其 ctx.config 引用（模块自行决定何时读取/如何应用新配置）；
   *   - 别的文件来抢同名模块名（yamlPath 不同）返回 false —— 拒绝顶替，防同名伪装。
   *  索引重建、config-update 日志与 enabled:false 的停止决策由调用方（Hearth）负责。
   *  就地更新的原因：在途启动持有的是槽位对象本身，替换对象会让代数递增与状态收敛落在旧对象上，
   *  槽位停在 starting。就地更新让在途启动看到代数已变，收尾时释放启动锁并把状态收敛为未运行。 */
  async applyUpdate(cfg: ModuleConfig, yamlPath: string): Promise<boolean> {
    const prev = this.modules.get(cfg.name);
    // 同名不同文件：本文件不是该模块名当前归属的 YAML，拒绝应用（模块名全库不允许重复，先注册者保留）
    if (prev && prev.yamlPath !== yamlPath) return false;
    // 槽位不存在（本文件首次被应用）：按新注册处理
    if (!prev) {
      this.register(cfg, yamlPath);
      return true;
    }
    const wasRunning = prev.status === 'running';
    prev.config = cfg;
    prev.startSeq++; // 配置更新使旧代启动全部作废：在途启动用旧配置（如旧的 startTimeoutMs），结果不应写回
    prev.startTimedOut = undefined; // 配置更新解除启动超时锁（与手动、CLI、重启同为人为主导的途径）
    // 运行中的模块：只刷新配置引用，不重启、不重载代码
    if (wasRunning && prev.ctx) {
      prev.ctx.refreshConfig(cfg);
    }
    return true;
  }

  /** 配置移除：停止运行中的模块后删除槽位。
   *  索引重建与 config-remove 日志由调用方（Hearth）负责。 */
  async remove(name: string): Promise<void> {
    const slot = this.modules.get(name);
    if (!slot) return;
    if (slot.status === 'running') await this.stopModule(name);
    this.modules.delete(name);
  }
}