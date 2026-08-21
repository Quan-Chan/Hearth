/**
 * CLI 门铃协议（核心侧实现）—— 一个文件 = 一个功能部分。
 *
 * 协议是"约定式"：事件 = 门铃（只响铃，不携带内容），数组 = 内容（真正的数据）。
 * 核心只实现协议本身；界面、解析、日志展示等高级功能全部在可选的 cli 模块端
 * （modules/cli/cli.cjs）。
 *
 * 协议步骤：
 *  ① cli:commands（CLI 拥有）：[{ cmd, args }]       —— CLI 把指令内容写入该公开数组
 *  ② cli:request  事件（门铃）                       —— 请求门铃；ConnectCore.sendEvent 拦截并转交本协议处理
 *  ③ core:results（核心拥有）：[{ cmd, ok, result, error }] —— 执行结果写入该公开数组
 *  ④ cli:done     事件（门铃）                       —— 完成门铃；CLI 收到后读 core:results 最新一条展示
 *
 * 终端是串行的：事件只当门铃、不携带任何数据，无需 id 关联；
 * 指令内容与执行结果全走数组，数组名是双方约定。
 *
 * 划分：核心只做"执行指令 + 回写结果"的协议骨架，解析与展示都归 cli 模块端。
 */
import { LOG_TYPES } from './logFormat';
import type { ConnectCore } from './ConnectCore';
import type { DirectedMessage } from '../types';

/** 门铃协议常量：事件名与数组名是核心和 cli 模块之间的约定（数组名不放进事件）。 */
export const CLI_REQUEST_EVENT = 'cli:request';
export const CLI_DONE_EVENT = 'cli:done';
export const CLI_COMMANDS_ARRAY = 'cli:commands';
export const CORE_RESULTS_ARRAY = 'core:results';

/** CLI 指令处理器：解析参数、执行、把结果写进 result.result；抛错由 handle() 统一捕获。
 *  返回 true 表示已自行完成收尾（写结果 + 响完成门铃）——仅 exit 需要。 */
type CliHandler = (
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  source: string,
) => Promise<boolean | void>;

export class CliProtocol {
  private readonly core: ConnectCore;

  /** 指令派发表：cmd -> 处理器。每个处理器只做三件事——解析参数、执行、把结果写进 result.result。 */
  private readonly handlers: Record<string, CliHandler> = {
    // 生成一个自定义事件（来源沿用请求方）
    event: async (args, result, source) => {
      const name = String(args.name ?? '');
      if (!name) throw new Error('event 指令缺少 name');
      await this.core.sendEvent(name, args.data, source);
      result.result = { delivered: name };
    },
    // 开启模块（即使没有事件触发）
    start: async (args, result) => {
      const name = String(args.module ?? '');
      if (!name) throw new Error('start 指令缺少 module');
      await this.core.startModule(name, 'cli');
      result.result = { module: name, status: this.core.getModule(name)?.status };
    },
    // 关闭模块（其公开数组随之消失）
    stop: async (args, result) => {
      const name = String(args.module ?? '');
      if (!name) throw new Error('stop 指令缺少 module');
      await this.core.stopModule(name);
      result.result = { module: name, status: this.core.getModule(name)?.status };
    },
    // 定向发送：目标无需声明 listen；targets 缺失/'*' = 广播给所有运行中且有 onEvent 的模块
    send: async (args, result, source) => {
      const name = String(args.name ?? '');
      if (!name) throw new Error('send 指令缺少 name');
      const targets =
        args.targets === undefined || args.targets === null || args.targets === '*'
          ? null
          : Array.isArray(args.targets)
            ? args.targets.map(String)
            : String(args.targets)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
      result.result = { recipients: await this.core.sendDirected(targets, name, args.data, source) };
    },
    // 查询模块与公共数组清单
    state: async (_args, result) => {
      result.result = {
        modules: this.core.listModules().map((m) => ({ name: m.name, status: m.status, startedAt: m.startedAt, error: m.error })),
        arrays: this.core.listArrays(),
      };
    },
    // 查询/调整事件比对索引：index -> 查看；index budget <MB> -> 修改字节预算并重建索引
    index: async (args, result) => {
      const action = String(args.action ?? 'view');
      if (action === 'budget') {
        const mb = Number(args.mb);
        if (!Number.isFinite(mb) || mb <= 0) throw new Error('index budget 需要正数 MB');
        result.result = { updated: true, ...this.core.setIndexBudgetBytes(Math.round(mb * 1024 * 1024)) };
      } else {
        result.result = this.core.getIndexStats();
      }
    },
    // 优雅关闭：先写结果 + 响完成门铃（让 CLI 读到），再停核心；已自行收尾，标记 selfDone
    exit: async (_args, result) => {
      result.ok = true;
      result.result = { stopped: true };
      this.core.array(CORE_RESULTS_ARRAY).push(result);
      await this.core.sendEvent(CLI_DONE_EVENT, {}, 'core');
      await this.core.stop();
      return true;
    },
  };

  constructor(core: ConnectCore) {
    this.core = core;
  }

  /**
   * 处理一条 CLI 请求（由 ConnectCore.sendEvent 拦截 cli:request 后转交）：
   *  ① 从 cli:commands（CLI 拥有的公开数组）取第一条未处理的指令；
   *  ② 按派发表执行它，并把该条目标记为已处理（失败记为 error）；
   *  ③ 把执行结果写入 core:results（核心自己的公开数组，惰性创建）；
   *  ④ 广播 cli:done 完成门铃，CLI 收到后自己读 core:results 的最新一条来展示。
   * 单个指令失败只影响该条（结果 ok:false），核心继续可用（失败隔离）。
   */
  async handle(source: string): Promise<void> {
    // 结果信箱惰性创建：只有真的用到 CLI 协议时才出现，普通核心保持零污染
    if (!this.core.listArrays().includes(CORE_RESULTS_ARRAY)) {
      this.core.exposeArray(CORE_RESULTS_ARRAY, 'core', []);
    }
    const commands = this.core.array<Record<string, unknown>>(CLI_COMMANDS_ARRAY);
    // 终端是串行的：一次 cli:request 只执行一条（取第一条未处理的），
    // 其余排在后面等下一次门铃；所以不需要 id 关联，事件和结果的对应天然按序成立。
    const entry = commands.find((c) => c.status !== 'done' && c.status !== 'error');
    if (!entry) {
      this.core.writeLog(LOG_TYPES.ERROR, 'core', 'CLI 请求到达但 cli:commands 里没有待执行指令', {
        event: CLI_REQUEST_EVENT,
      });
      return;
    }
    const cmd = String(entry.cmd ?? '');
    const handler = this.handlers[cmd];
    this.core.writeLog(LOG_TYPES.CLI_COMMAND, source, 'CLI 指令: ' + cmd, { command: cmd });

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
      this.core.writeLog(LOG_TYPES.ERROR, 'core', 'CLI 指令执行失败: ' + (err instanceof Error ? err.message : String(err)), {
        command: cmd,
      });
    }
    // 除 exit（已自行收尾）外：结果必达 CLI——成功或失败都推入 core:results 并响完成门铃
    if (!selfDone) {
      this.core.array(CORE_RESULTS_ARRAY).push(result);
      await this.core.sendEvent(CLI_DONE_EVENT, {}, 'core');
    }
  }

  /**
   * 处理一条定向指令消息（信息直达：ConnectCore.sendTo 以 'core' 为目标时转交）：
   *  cmd/args 取自消息内容 data；执行后把结果 { cmd, ok, result, error } 用 sendTo
   *  直接回传给消息头里的发起方（message.head.source）。
   *  与门铃协议 handle() 的区别：结果不走公共数组、不响 cli:done，而是点对点直达。
   */
  async handleDirected(message: DirectedMessage): Promise<void> {
    const data = (message.data ?? {}) as Record<string, unknown>;
    const cmd = String(data.cmd ?? '');
    const args = (data.args ?? {}) as Record<string, unknown>;
    const from = message.head.source;
    this.core.writeLog(LOG_TYPES.CLI_COMMAND, from, 'CLI 指令: ' + cmd, { command: cmd });

    // 优雅关闭：先把完成信息直接回传发起方，再停核心（与门铃路径"先写结果再关"语义一致）
    if (cmd === 'exit' || cmd === 'quit') {
      await this.core.sendTo(from, { cmd: 'exit', ok: true, result: { stopped: true } }, 'core');
      await this.core.stop();
      return;
    }

    const result: Record<string, unknown> = { cmd };
    try {
      const handler = this.handlers[cmd];
      if (!handler) throw new Error('未知 CLI 指令: ' + cmd);
      await handler(args, result, from);
      result.ok = true;
    } catch (err) {
      result.ok = false;
      result.error = err instanceof Error ? err.message : String(err);
      this.core.writeLog(LOG_TYPES.ERROR, 'core', 'CLI 指令执行失败: ' + (err instanceof Error ? err.message : String(err)), {
        command: cmd,
      });
    }
    // 结果直接回传发起方（信息直达，不经过公共数组/门铃）
    await this.core.sendTo(from, result as Record<string, unknown>, 'core');
  }
}
