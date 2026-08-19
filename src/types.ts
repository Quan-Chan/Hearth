/**
 * Connect-Core 共享类型定义。
 *
 * 设计要点（对应 REQUIREMENTS.md）：
 * - 事件是纯字符串消息信号（Event.name）；data 为可选载荷，不参与匹配。
 * - 模块间的数据交换通过"公共数组"完成：拉取快照 + 结构化解编辑。
 */
import type { ModuleContext } from './core/ModuleContext';

/** 事件：纯字符串消息信号。data 可选，仅作附带信息，匹配只看 name。 */
export interface CoreEvent {
  /** 事件名，例如 "core:startup"、"chat:receive" */
  name: string;
  /** 可选载荷 */
  data?: unknown;
}

/** 模块 YAML 配置文件解析后的形态。 */
export interface ModuleConfig {
  /** 模块名（全局唯一，作为模块身份标识） */
  name: string;
  /** 模块程序文件路径（相对 YAML 文件所在目录） */
  file: string;
  /** 启动事件：出现该事件时框架核心启动此模块 */
  startEvents?: string[];
  /** 监听事件：出现该事件时框架核心向模块发送事件消息 */
  listen?: string[];
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 透传给模块的自定义配置（通过 ctx.config 读取） */
  config?: Record<string, unknown>;
}

/** 模块运行时状态。 */
export interface ModuleRuntimeInfo {
  name: string;
  config: ModuleConfig;
  status: 'running' | 'stopped' | 'failed';
  startedAt?: number;
  error?: string;
}

/** 模块程序（被加载的"程序"）的导出形态。 */
export interface ModuleDefinition {
  name?: string;
  /** 模块启动钩子：被核心启动时调用 */
  start?(ctx: ModuleContext): void | Promise<void>;
  /** 模块关闭钩子：被核心关闭时调用 */
  stop?(ctx: ModuleContext): void | Promise<void>;
  /** 事件处理：核心向模块发送事件消息时调用 */
  onEvent?(ctx: ModuleContext, event: CoreEvent): void | Promise<void>;
}

/** 核心启动选项。 */
export interface ConnectCoreOptions {
  /** 模块文件夹（YAML 配置所在目录），默认 ./modules */
  moduleDir?: string;
  /** 事件流水日志文件路径，默认 ./logs/event-stream.log */
  logFile?: string;
  /** 是否监听模块文件夹变化（热加载），默认 true */
  watch?: boolean;
  /** 监听轮询间隔 ms，默认 200 */
  pollIntervalMs?: number;
  /** 事件比对索引（MatchIndex）的字节预算：空间换时间的上限，默认 8MB（≈8000 个条件入索引，超出进溢出表） */
  indexBudgetBytes?: number;
  /** 是否把日志同步输出到控制台，默认 false */
  logToConsole?: boolean;
}

/** 日志条目：原样记录所有发生的事情（事件流水）。t 由日志自动填充。 */
export interface LogEntry {
  /** ISO 时间戳 */
  t?: string;
  /** 条目类型：core:start / core:stop / event / module:start / ... */
  type: string;
  [key: string]: unknown;
}
