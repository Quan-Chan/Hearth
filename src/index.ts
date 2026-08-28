/**
 * Connect-Core 公共入口。
 *
 * 使用方式决定启动形态（启动核心 == 启动整个软件）：
 *  - createCore() 只构造不出手：调用方拿到核心句柄后自行决定何时 core.start()；
 *  - startCore()  一步到位：创建即启动，模块按 YAML 的 startEvents 看"核心启动"事件自动拉起。
 * 其余导出把各内部件（事件比对 / 索引 / 数组注册表 / 日志 / 配置监听 / 模块加载）摊开，
 * 供需要精细操控或复用底层件的高级用法使用。
 */
export { ConnectCore } from './core/ConnectCore';
export { ModuleContext } from './core/ModuleContext';
export { EventStreamLog } from './core/EventStreamLog';
export { ArrayRegistry } from './core/ArrayRegistry';
export { eventMatches, anyEventMatches, patternToRegExp } from './core/EventMatcher';
export { ConfigWatcher, parseModuleConfig } from './core/ConfigWatcher';
export { MatchIndex } from './core/MatchIndex';
export { LOG_TYPES, categoryOf, formatLogEntry, truncateDisplay } from './core/logFormat';
export type { LogType, LogCategory } from './core/logFormat';
export { loadModuleProgram } from './module/loadModule';
export type {
  ConnectCoreOptions,
  CoreEvent,
  DirectedMessage,
  LogEntry,
  ModuleConfig,
  ModuleDefinition,
  ModuleRuntimeInfo,
} from './types';

import { ConnectCore } from './core/ConnectCore';
import type { ConnectCoreOptions } from './types';

/** 创建核心（只构造不启动）：适合需要先装配、后择机 start() 的宿主。 */
export function createCore(options: ConnectCoreOptions = {}): ConnectCore {
  return new ConnectCore(options);
}

/** 启动整个软件：创建核心并立即启动，模块按事件自动加载、启动。 */
export async function startCore(options: ConnectCoreOptions = {}): Promise<ConnectCore> {
  const core = new ConnectCore(options);
  await core.start();
  return core;
}
