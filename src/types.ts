/**
 * Connect-Core 共享类型定义。
 *
 * 设计要点（对应需求文档）：
 * - 事件是纯字符串消息信号，两段式：完整事件名（来源:事件名，来源段由核心拼装）
 *   + data（事件内容：模块自己写）；data 不参与匹配。
 * - 模块间的数据交换通过"公共数组"完成：公开者映射数组对象到名字，array() 返回同一对象引用。
 */
import type { ModuleContext } from './core/ModuleContext';

/** 定向信息的基础来源：发送者模块名，由核心自动生成（模块不写、也改不了它）。
 *  'core' = 核心自产；'external' = 宿主代码直接调用；其他 = 该模块发出的。 */
export type DirectedSource = string;

/** 事件：两段式消息信号。
 *  第一段（name）：事件名，两段式字符串（来源:事件名），来源段由核心自动拼装
 *  （模块发出 = 模块名；核心自产 = core；宿主直接调用 = external），事件名段由模块自己定义；
 *  第二段（data）：事件内容（模块自己写，可选）。
 *  匹配使用完整事件名（来源:事件名），data 不参与匹配；响应任意来源的同名事件用通配符（如 "*:greet"）。 */
export interface CoreEvent {
  /** 完整事件名，例如 "core:startup"、"router:command"，来源段由核心拼装 */
  name: string;
  /** 第二段·事件内容：由发出模块自己写的具体内容（可选） */
  data?: unknown;
}

/** 定向信息（信息直达通道）：点对点直通消息。
 *  与事件的区别：没有事件名、不参与匹配、不进公共数组；只发给指定的一个接收方。
 *  source = 发送者模块名（核心自动打、不可伪造），其余全是内容。 */
export interface DirectedMessage {
  /** 来源：发送者模块名，由核心自动生成 */
  source: string;
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
  /** 本模块自己的启动超时（毫秒）：启动函数超过该时长未返回，核心放弃等待并标记失败。
   *  不声明则用核心选项 defaultStartTimeoutMs；两者都没配则不设超时（维持原行为）。 */
  startTimeoutMs?: number;
  /** 透传给模块的自定义配置（通过 ctx.config 读取） */
  config?: Record<string, unknown>;
}

/** 模块运行时状态。
 *  启动时间与失败原因不在此保存：启动与失败都有带时间戳的日志，查日志即可。 */
export interface ModuleRuntimeInfo {
  name: string;
  config: ModuleConfig;
  /** starting = 启动函数尚未返回（可能正在等待，或已配置启动超时在等期限） */
  status: 'running' | 'stopped' | 'failed' | 'starting';
}

/** 模块槽位：一个 YAML 配置对应的全部运行时状态（核心内部使用）。 */
export interface ModuleSlot {
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

/** 模块程序（被加载的"程序"）的导出形态。
 *  模块名不在此声明：唯一来源是 YAML 的 name 字段。 */
export interface ModuleDefinition {
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
  /** 核心日志文件路径，默认 ./logs/event-stream.log */
  logFile?: string;
  /** 是否监听模块文件夹变化（热加载），默认 true */
  watch?: boolean;
  /** 监听轮询间隔 ms，默认 200 */
  pollIntervalMs?: number;
  /** 是否把日志同步输出到控制台，默认 false */
  logToConsole?: boolean;
  /** 进程级守护：捕获模块造成的"没人处理的异步失败"与未捕获异常，只记日志、不让进程退出。默认 false。
   *  注意：开启后 uncaughtException 也不再终止进程，宿主需自行权衡。 */
  guardProcess?: boolean;
  /** 全核默认的模块启动超时（毫秒）；0 或不配 = 不设超时。可被每个模块 YAML 的 startTimeoutMs 覆盖。 */
  defaultStartTimeoutMs?: number;
  /** 日志在内存里最多保留多少条（超出丢最旧的；落盘文件不受影响）。默认 20000。 */
  maxLogMemoryEntries?: number;
  /** 停止等待上限（毫秒）：核心停机时等待**全部**模块返回"已关闭"（stop() 完成）的时限；
   *  超时后强制关闭软件（哪个模块未返回会被记录在错误日志里）。默认 20000。 */
  stopTimeoutMs?: number;
}

/** 日志条目：原样记录所有发生的事情。t 由 record() 自动填充；
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