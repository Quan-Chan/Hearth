/**
 * 模块程序加载器：把 YAML 里 file 指向的"程序"加载为 ModuleDefinition。
 * 支持：
 *  - .cjs / .js  -> CommonJS require（清除缓存以支持热更新）
 *  - .mjs / .ts  -> 动态 import（ESM）
 *  - 导出对象（{ start, stop, onEvent }）或工厂函数（() => ({...})）
 */
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { ModuleDefinition } from '../types';

export async function loadModuleProgram(filePath: string): Promise<ModuleDefinition> {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`模块程序文件不存在: ${abs}`);
  const ext = path.extname(abs).toLowerCase();
  let loaded: unknown;
  if (ext === '.mjs' || ext === '.ts') {
    // 注意：tsc 在 CJS 输出下会把 import() 编译成 require()，导致 ESM 加载失败。
    // 用 Function 包装得到真正的动态 import。
    const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<unknown>;
    loaded = await dynamicImport(pathToFileURL(abs).href);
  } else {
    // CommonJS：清缓存后 require，保证 YAML 更新后重新加载最新代码
    delete require.cache[abs];
    loaded = require(abs);
  }
  let def: unknown = loaded;
  if (loaded && typeof loaded === 'object' && 'default' in (loaded as Record<string, unknown>)) {
    def = (loaded as Record<string, unknown>).default;
  }
  if (typeof def === 'function') {
    def = await (def as () => unknown)();
  }
  if (typeof def !== 'object' || def === null) {
    throw new Error(`模块程序导出必须是对象或工厂函数: ${abs}`);
  }
  return def as ModuleDefinition;
}
