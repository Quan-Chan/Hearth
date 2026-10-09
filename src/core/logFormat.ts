/**
 * 统一日志体系：只记录"核心框架自己干的事情"。
 *
 * 每条日志三字段主结构：
 *   1. type    日志类型：核心的动作（event / event-drop / module-start / config-load / ...）
 *   2. source  日志来源：动作主要涉及的对象（core / external / 模块名）
 *   3. message 日志信息：具体内容（如事件名、原因描述）
 *
 * 命名统一 kebab-case（域-动作）；附加字段（event/data/recipients/reason/error）保留结构化数据。
 * 日志是一条连续的时间线：发生什么就记录什么，按时间顺序逐条输出（formatLogEntry）。
 * 需要分区/过滤时直接按 type 过滤（categoryOf / byCategory），不在展示层做分区。
 */
import type { LogEntry } from '../types';

/** 全部日志类型（常量集中管理，命名统一）。 */
export const LOG_TYPES = {
  // 核心生命周期
  CORE_START: 'core-start',
  CORE_STOP: 'core-stop',
  // 事件处理：核心收到事件后的动作
  EVENT: 'event', // 收到并转发给监听模块
  EVENT_DROP: 'event-drop', // 收到但无模块匹配，丢弃
  // 模块生命周期（核心启动/关闭/跳过模块）
  MODULE_START: 'module-start',
  MODULE_STOP: 'module-stop',
  MODULE_SKIP: 'module-skip',
  MODULE_START_TIMEOUT: 'module-start-timeout', // 模块启动超过期限未完成，放弃等待
  MODULE_RESTART: 'module-restart', // 模块请求重启：核心验证新代码后停旧启新
  // 配置热加载（监听模块文件夹）
  CONFIG_LOAD: 'config-load',
  CONFIG_UPDATE: 'config-update',
  CONFIG_REMOVE: 'config-remove',
  // 模块自定义日志（模块显式请求核心记录）
  MODULE_LOG: 'module-log',
  // CLI 指令（可选 cli 模块经 core:cli:* 命令面发来的管理请求）
  CLI_COMMAND: 'cli-command',
  // 错误（启动失败、事件处理失败、配置解析失败等）
  ERROR: 'error',
} as const;

export type LogType = (typeof LOG_TYPES)[keyof typeof LOG_TYPES];

/** 日志类别（用于分组展示/过滤）。 */
export type LogCategory = 'core' | 'event' | 'module' | 'config' | 'log' | 'error';

const TYPE_TO_CATEGORY: Record<string, LogCategory> = {
  'core-start': 'core',
  'core-stop': 'core',
  event: 'event',
  'event-drop': 'event',
  'module-start': 'module',
  'module-stop': 'module',
  'module-skip': 'module',
  'module-start-timeout': 'module',
  'module-restart': 'module',
  'config-load': 'config',
  'config-update': 'config',
  'config-remove': 'config',
  'module-log': 'log',
  'cli-command': 'module',
  error: 'error',
};

/** 展示层单字段的最大显示字符数；存储层完整（见 EventStreamLog），截断只发生在渲染时。 */
export const DISPLAY_TRUNCATE_CHARS = 2048;

/** 展示层文本缩短：超长部分以省略号 + 原始长度标注替代，信息本体以落盘文件为准。 */
export function truncateDisplay(text: string, max: number = DISPLAY_TRUNCATE_CHARS): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `...[truncated, original ${text.length} chars]`;
}

/** 由 type 得到类别。 */
export function categoryOf(type: string): LogCategory {
  return TYPE_TO_CATEGORY[type] ?? 'error';
}

/** 单行日志：HH:MM:SS.mmm [type] source: message  附加关键字段。 */
export function formatLogEntry(entry: LogEntry): string {
  const t = (entry.t ?? '').slice(11, 23);
  let line = t + ' [' + entry.type + '] ' + entry.source + ': ' + entry.message;
  const extra: string[] = [];
  if (Array.isArray(entry.recipients) && entry.recipients.length > 0) {
    extra.push('recipients=' + entry.recipients.join(','));
  }
  if (entry.data !== undefined) {
    // 展示层缩短：文件里存的是完整内容，这里只为显示截断
    extra.push('data=' + truncateDisplay(JSON.stringify(entry.data)));
  }
  if (entry.reason !== undefined) {
    extra.push('reason=' + entry.reason);
  }
  if (entry.error !== undefined) {
    extra.push('error=' + String(entry.error));
  }
  if (entry.file !== undefined) {
    extra.push('file=' + String(entry.file));
  }
  if (entry.removedObjects !== undefined && Array.isArray(entry.removedObjects) && entry.removedObjects.length > 0) {
    extra.push('removedObjects=' + entry.removedObjects.join(','));
  }
  return extra.length > 0 ? line + '  [' + extra.join('  ') + ']' : line;
}

/** 日志类型 -> 类别过滤（等价于对 JSONL 做 grep），展示层不做分区。 */
export function filterByCategory(entries: LogEntry[], category: LogCategory): LogEntry[] {
  return entries.filter((e) => categoryOf(String(e.type)) === category);
}