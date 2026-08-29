/**
 * 事件派发器：事件广播与定向通道的出口。
 *
 * 三条通道（对应 docs/实现/事件派发.md）：
 *  - 事件广播（sendEvent）：两段式全名（来源:事件名）匹配两份索引——
 *    startIndex（启动未运行模块）与 listenIndex（转发给监听者），无人认领记 event-drop；
 *  - 定向发送事件（sendDirected）：只投递指定的运行中模块，不走事件路由；
 *  - 定向信息（sendTo）：点对点直通，目标为 core 时转交 CLI 指令协议，
 *    目标为模块时要求其实现 onMessage（显式订阅），失败隔离。
 *
 * 索引与启停无关：配置变更时由核心调用 rebuildIndexes 重建，模块启停不碰索引。
 *
 * 依赖注入：构造时传入 ConnectCore 与 ModuleManager 实例（只做类型引用），
 * 事件启动模块经由 manager.startModule，投递目标查询经由 manager.slots/getSlot。
 */
import { LOG_TYPES } from './logFormat';
import { MatchIndex } from './MatchIndex';
import type { ConnectCore } from './ConnectCore';
import type { ModuleManager } from './ModuleManager';
import type { CoreEvent, DirectedMessage, ModuleSlot } from '../types';

/** 深拷贝事件 data：每个接收者拿到独立副本。不可克隆的值（函数/符号）回退为原引用。 */
function cloneData(data: unknown): unknown {
  try {
    return structuredClone(data);
  } catch {
    return data;
  }
}

export class EventDispatcher {
  /** 事件比对索引：startEvents 与 listen 各自一份（配置变更时重建，模块启停不碰索引）。 */
  private readonly startIndex = new MatchIndex<ModuleSlot>();
  private readonly listenIndex = new MatchIndex<ModuleSlot>();

  constructor(
    private readonly core: ConnectCore,
    private readonly manager: ModuleManager,
  ) {}

  /** 重建事件比对索引：从当前全部槽位的配置全量重建（配置加载/更新/移除时由核心调用）。 */
  rebuildIndexes(slots: ModuleSlot[]): void {
    const start: { pattern: string; slot: ModuleSlot }[] = [];
    const listen: { pattern: string; slot: ModuleSlot }[] = [];
    for (const m of slots) {
      for (const p of m.config.startEvents ?? []) start.push({ pattern: p, slot: m });
      for (const p of m.config.listen ?? []) listen.push({ pattern: p, slot: m });
    }
    this.startIndex.rebuild(start);
    this.listenIndex.rebuild(listen);
  }

  /** 核心方法 3：发送事件消息。核心比对事件：启动匹配的模块 + 向监听模块转发。
   *  事件为两段式：事件名 = 来源:事件名，来源段由这里按调用方自动拼装；
   *  调用方（模块 ctx.sendEvent / 核心自产 / 宿主）只负责给事件名段与内容 data。 */
  async sendEvent(name: string, data?: unknown, source: string = 'external'): Promise<void> {
    if (!this.core.started) throw new Error('Connect-Core not started, cannot send event');
    // 停机期间冻结事件面：外部与模块的事件一律拒绝
    if (this.core.stopping && source !== 'core') {
      throw new Error('Connect-Core is stopping, cannot send event');
    }
    await this.dispatch(name, data, source);
  }

  /** 事件派发的实际执行体：sendEvent 校验后的内部通道。 */
  private async dispatch(name: string, data?: unknown, source: string = 'external'): Promise<void> {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('event name must be a non-empty string');
    }
    // 两段式事件名：来源段由核心按调用方自动拼装（模块名 / core / external），模块无法伪造
    const fullName = source + ':' + name;
    const event: CoreEvent = { name: fullName, data };

    // 同一事件可兼两种角色：对"没在跑"是启动信号（startEvents），对"在跑"是工作指令（listen）。
    // 启动依赖与运行期订阅共用同一套事件名，核心按模块当前状态自动选择行为。
    // 1) 比对启动事件：未运行的模块若 startEvents 匹配，则启动它（索引查找，跳过全量比对）
    const toStart = this.dedupSorted(this.startIndex.lookup(fullName)).filter(
      (m) => m.status !== 'running' && m.config.enabled,
    );
    for (const m of toStart) {
      await this.manager.startModule(m.name, fullName);
    }

    // 2) 比对监听事件：收集匹配的监听模块，记录核心动作（转发或丢弃）
    const listeners = this.dedupSorted(this.listenIndex.lookup(fullName)).filter((m) => this.isDeliverable(m));
    if (listeners.length === 0) {
      this.core.writeLog(LOG_TYPES.EVENT_DROP, source, fullName, { event: fullName, data });
    } else {
      this.core.writeLog(LOG_TYPES.EVENT, source, fullName, {
        event: fullName,
        data,
        recipients: listeners.map((m) => m.name),
      });
    }

    // 3) 向监听模块发送事件消息（单个模块失败不影响其他模块）
    await this.deliverTo(listeners, event, `failed to handle event ${fullName}: `);
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

  /** 逐个派发事件消息：单个模块失败只记 error 日志，不影响其他模块。
   *  data 按接收者独立拷贝（structuredClone）：每个监听者拿到一份原始信息的副本，
   *  修改自己的副本不影响其他监听者。data 只承载信息，可变共享数据走公共数组。
   *  拷贝失败（不可克隆的值，如函数）时回退为原引用。 */
  private async deliverTo(recipients: ModuleSlot[], event: CoreEvent, failPrefix: string): Promise<void> {
    for (const m of recipients) {
      try {
        const copy: CoreEvent = event.data === undefined ? event : { name: event.name, data: cloneData(event.data) };
        await m.def!.onEvent!(m.ctx!, copy);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.core.writeLog(LOG_TYPES.ERROR, m.name, failPrefix + message, { event: event.name, error: message });
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
    if (!this.core.started) throw new Error('Connect-Core not started, cannot send event');
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('event name must be a non-empty string');
    }
    const recipients =
      targets === null
        ? this.manager.slots().filter((m) => this.isDeliverable(m))
        : targets
            .map((nm) => this.manager.getSlot(nm))
            .filter((m): m is ModuleSlot => !!m && this.isDeliverable(m));
    const fullName = source + ':' + name;
    if (recipients.length === 0) {
      this.core.writeLog(LOG_TYPES.EVENT_DROP, source, fullName, { event: fullName, data, note: 'directed send: no valid recipients' });
    } else {
      this.core.writeLog(LOG_TYPES.EVENT, source, fullName, { event: fullName, data, recipients: recipients.map((m) => m.name), directed: true });
      await this.deliverTo(recipients, { name: fullName, data }, 'failed to handle directed event: ');
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
    if (!this.core.started) throw new Error('Connect-Core not started, cannot send directed message');
    if (this.core.stopping && source !== 'core') {
      throw new Error('Connect-Core is stopping, cannot send directed message');
    }
    const message: DirectedMessage = { source, data };

    // 核心 = 可寻址收件方：指令处理器执行后，结果由它直接回传给发起方
    if (target === 'core') {
      await this.core.handleCliMessage(message);
      return true;
    }

    // 模块接收方：运行中且实现了 onMessage 才会收到（不实现 = 不订阅定向消息）
    const slot = this.manager.getSlot(target);
    if (slot && slot.status === 'running' && slot.def && slot.def.onMessage && slot.ctx) {
      try {
        await slot.def.onMessage(slot.ctx, message);
        return true;
      } catch (err) {
        const em = err instanceof Error ? err.message : String(err);
        this.core.writeLog(LOG_TYPES.ERROR, target, 'failed to handle directed message: ' + em, { target: target, error: em });
        // 返回值表示"有没有接收方"：对方处理失败只记 error，接收方存在就算送达。
        return true;
      }
    }

    this.core.writeLog(LOG_TYPES.EVENT_DROP, source, 'directed message not delivered', { target: target, data: data, note: 'target missing, not running, or no onMessage' });
    return false;
  }
}