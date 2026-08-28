/**
 * CLI 指令协议（核心侧实现）：目标为 core 的定向信息被解释为管理指令。
 *
 * 指令内容与结果全走定向信息：调用方 sendTo('core', { cmd, args })，
 * 核心执行指令（event/start/stop/send/state），结果 { cmd, ok, result, error }
 * 经 sendTo 直接回传发起方；结束指令 exit/quit 先回执再停止核心。
 *
 * 划分：核心只做"执行指令 + 回传结果"的协议，界面、解析、日志展示归可选的 cli 模块端。
 */
import { LOG_TYPES } from './logFormat';
import type { ConnectCore } from './ConnectCore';
import type { DirectedMessage } from '../types';

/** 指令处理器：解析参数、执行、把结果写进 result.result；抛错由 handleDirected 统一捕获。 */
type CliHandler = (args: Record<string, unknown>, result: Record<string, unknown>, source: string) => Promise<void>;

export class CliProtocol {
  private readonly core: ConnectCore;

  /** 指令派发表：cmd -> 处理器。新增指令只加一个条目，解析/执行/回传的公共骨架
   *  （handleDirected）保持不变；每个处理器做三件事——解析参数、执行、把结果写进 result.result。 */
  private readonly handlers: Record<string, CliHandler> = {
    // 生成一个自定义事件（来源沿用请求方；事件名为两段式，来源段由核心拼装）
    event: async (args, result, source) => {
      const name = String(args.name ?? '');
      if (!name) throw new Error('event 指令缺少 name');
      await this.core.sendEvent(name, args.data, source);
      result.result = { delivered: source + ':' + name };
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
    // 查询模块与公共数组清单（数组用匹配拉取 '*' 列出全名）
    state: async (_args, result) => {
      const matched = this.core.array('*') as Record<string, unknown[]>;
      result.result = {
        modules: this.core.listModules().map((m) => ({ name: m.name, status: m.status })),
        arrays: Object.keys(matched),
      };
    },
  };

  constructor(core: ConnectCore) {
    this.core = core;
  }

  /**
   * 处理一条定向指令消息（目标为 core 的 sendTo 被拦截后转交）：
   * cmd/args 取自消息内容 data；执行后把结果 { cmd, ok, result, error } 用 sendTo
   * 直接回传给消息里的发起方（message.source）。
   */
  async handleDirected(message: DirectedMessage): Promise<void> {
    const data = (message.data ?? {}) as Record<string, unknown>;
    const cmd = String(data.cmd ?? '');
    const args = (data.args ?? {}) as Record<string, unknown>;
    const from = message.source;
    this.core.writeLog(LOG_TYPES.CLI_COMMAND, from, 'CLI 指令: ' + cmd, { command: cmd });

    // 结束指令：先把完成信息直接回传发起方，再停核心（先交付结果再关闭）
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
    // 结果直接回传发起方（定向信息，不进任何数组）
    await this.core.sendTo(from, result as Record<string, unknown>, 'core');
  }
}