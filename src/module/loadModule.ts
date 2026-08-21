/**
 * 模块程序加载器：把 YAML 里 file 指向的"程序"归一化成核心认识的 ModuleDefinition。
 * 支持 CJS 对象、ESM 默认导出、工厂函数（运行时求值）三种写法，统一收敛为
 * { start, stop, onEvent } 钩子集合。
 * 加载点放在每次 startModule（启动即重载）：YAML 更新触发的"重启"因此拿到最新代码（热更新）。
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
    // tsconfig 按 CommonJS 产出，tsc 会把 import() 死编译成 require()，而 require()
    // 拿不到 ESM。用 Function 包一层换来真正的动态 import，ESM/TS 才能被加载。
    const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<unknown>;
    loaded = await dynamicImport(pathToFileURL(abs).href);
  } else {
    // 先清缓存再 require：不删缓存，二次加载会拿到首次启动的旧实现，热更新就失效了。
    delete require.cache[abs];
    loaded = require(abs);
  }
  // 归一化：ESM 常见 default 导出、CJS 直接导出对象或工厂函数，统一取最终形态。
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
