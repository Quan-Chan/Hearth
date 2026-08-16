/**
 * 统一日志体系：只记录"核心框架自己干的事情"。
 *
 * 每条日志三字段主结构：
 *   1. type    日志类型：核心的动作（event / event-drop / module-start / config-load / ...）
 *   2. source  日志来源：动作主要涉及的对象（core / external / 模块名）
 *   3. message 日志信息：人类可读的具体内容（如事件名、原因描述）
 *
 * 命名统一 kebab-case（域-动作）；附加字段（event/data/recipients/reason/error）保留结构化数据。
 * 文件落盘 JSONL 原样保真，控制台/演示输出走 formatLogEntry 人类可读格式。
 */
import type { LogEntry } from './EventStreamLog';

/** 全部日志类型（常量集中管理，保证命名统一）。 */
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
  // 配置热加载（监听模块文件夹）
  CONFIG_LOAD: 'config-load',
  CONFIG_UPDATE: 'config-update',
  CONFIG_REMOVE: 'config-remove',
  // 模块自定义日志（模块显式请求核心记录）
  MODULE_LOG: 'module-log',
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
  'config-load': 'config',
  'config-update': 'config',
  'config-remove': 'config',
  'module-log': 'log',
  error: 'error',
};

/** 由 type 得到类别。 */
export function categoryOf(type: string): LogCategory {
  return TYPE_TO_CATEGORY[type] ?? 'error';
}

/** 类别的中文标题（分组展示用）。 */
export const CATEGORY_TITLES: Record<LogCategory, string> = {
  core: '核心生命周期',
  event: '事件处理',
  module: '模块生命周期',
  config: '配置热加载',
  log: '模块日志',
  error: '错误',
};

/** 人类可读单行日志：HH:MM:SS.mmm [type] source: message  附加关键字段。 */
export function formatLogEntry(entry: LogEntry): string {
  const t = (entry.t ?? '').slice(11, 23);
  let line = t + ' [' + entry.type + '] ' + entry.source + ': ' + entry.message;
  const extra: string[] = [];
  // event/event-drop 的 message 就是事件名，不再重复显示 event 字段
  if (entry.event !== undefined && entry.type !== LOG_TYPES.EVENT && entry.type !== LOG_TYPES.EVENT_DROP) {
    extra.push('event=' + entry.event);
  }
  if (Array.isArray(entry.recipients) && entry.recipients.length > 0) {
    extra.push('转发=' + entry.recipients.join(','));
  }
  if (entry.data !== undefined) {
    extra.push('data=' + JSON.stringify(entry.data));
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
  if (entry.removedArrays !== undefined && Array.isArray(entry.removedArrays) && entry.removedArrays.length > 0) {
    extra.push('清理数组=' + entry.removedArrays.join(','));
  }
  return extra.length > 0 ? line + '  [' + extra.join('  ') + ']' : line;
}

/** 把日志按类别分组（演示/人读用），保持时间顺序。 */
export function groupLogEntries(entries: LogEntry[]): { category: LogCategory; title: string; lines: string[] }[] {
  const groups = new Map<LogCategory, string[]>();
  for (const e of entries) {
    const cat = categoryOf(String(e.type));
    const list = groups.get(cat) ?? [];
    list.push(formatLogEntry(e));
    groups.set(cat, list);
  }
  const order: LogCategory[] = ['core', 'event', 'module', 'config', 'log', 'error'];
  return order.filter((c) => groups.has(c)).map((c) => ({ category: c, title: CATEGORY_TITLES[c], lines: groups.get(c)! }));
}
