/**
 * Connect-Core 公共入口。
 * 启动核心 == 启动整个软件：startCore() 会启动核心并让所有模块按事件自动启动。
 */
export { ConnectCore } from './core/ConnectCore';
export { ModuleContext } from './core/ModuleContext';
export { EventStreamLog } from './core/EventStreamLog';
export { ArrayRegistry, applyOp } from './core/ArrayRegistry';
export { eventMatches, anyEventMatches, patternToRegExp } from './core/EventMatcher';
export { ConfigWatcher, parseModuleConfig } from './core/ConfigWatcher';
export { LOG_TYPES, categoryOf, formatLogEntry } from './core/logFormat';
export type { LogType, LogCategory } from './core/logFormat';
export { loadModuleProgram } from './module/loadModule';
export type {
  ArrayOp,
  ConnectCoreOptions,
  CoreEvent,
  LogEntry,
  ModuleConfig,
  ModuleDefinition,
  ModuleRuntimeInfo,
} from './types';

import { ConnectCore } from './core/ConnectCore';
import type { ConnectCoreOptions } from './types';

/** 创建核心（不会自动启动）。 */
export function createCore(options: ConnectCoreOptions = {}): ConnectCore {
  return new ConnectCore(options);
}

/** 启动整个软件：创建核心并启动。模块按事件自动加载、启动。 */
export async function startCore(options: ConnectCoreOptions = {}): Promise<ConnectCore> {
  const core = new ConnectCore(options);
  await core.start();
  return core;
}