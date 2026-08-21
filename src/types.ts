/**
 * Connect-Core 共享类型定义。
 *
 * 设计要点（对应 REQUIREMENTS.md）：
 * - 事件是纯字符串消息信号（Event.name），两段式：head（事件头：核心自动生成的来源）
 *   + data（事件内容：模块自己写）；head/data 都不参与匹配。
 * - 模块间的数据交换通过"公共数组"完成：公开者映射数组对象到名字，array() 返回同一对象引用。
 */
import type { ModuleContext } from './core/ModuleContext';

/** 事件头：两段式事件的第一段，由核心自动生成（模块不写、也改不了它）。 */
export interface EventHead {
  /** 来源：发出该事件的模块名。'core' = 核心自产；'external' = 宿主代码直接调用；
   *  其他 = 该模块发出的。核心按调用方自动打上，模块无法伪造来源。 */
  source: string;
}

/** 事件：两段式消息信号。
 *  第一段 head（事件头：核心自动生成的来源）；第二段 data（事件内容：模块自己写，可选）。
 *  匹配只看 name（纯字符串信号），head 与 data 均不参与匹配。 */
export interface CoreEvent {
  /** 事件名，例如 "core:startup"、"chat:receive" */
  name: string;
  /** 第一段·事件头：由核心自动生成（source = 发出事件的模块） */
  head: EventHead;
  /** 第二段·事件内容：由发出模块自己写的具体内容（可选） */
  data?: unknown;
}

/** 定向信息（信息直达通道）：点对点直通消息。
 *  与事件的区别：没有事件名、不参与匹配、不进公共数组；只发给指定的一个接收方。
 *  只有一个基础头字段（head.source = 发送者模块名，核心自动打、不可伪造），其余全是内容。 */
export interface DirectedMessage {
  /** 基础头信息：只有一个字段——发送者模块的名字 */
  head: EventHead;
  /** 内容：发送方写的"单纯一个信息" */
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
  /** 定向消息处理：核心把别人定向发来的消息交给本模块时调用（不实现就收不到定向消息） */
  onMessage?(ctx: ModuleContext, message: DirectedMessage): void | Promise<void>;
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

/** 日志条目：原样记录所有发生的事情（事件流水）。t 由 record() 自动填充；
 *  type/source/message 为三字段主结构（见 logFormat.ts），附加字段保留结构化信息。 */
export interface LogEntry {
  /** ISO 时间戳 */
  t?: string;
  /** ① 日志类型：核心的动作（kebab-case，如 core-start / event / module-start） */
  type: string;
  /** ② 日志来源：动作涉及的对象（core / external / 模块名） */
  source: string;
  /** ③ 日志信息：人类可读的具体内容 */
  message: string;
  [key: string]: unknown;
}
