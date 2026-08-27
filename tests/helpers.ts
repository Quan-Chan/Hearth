/**
 * 测试辅助工具：临时目录、等待条件、模块夹具生成。
 */
import * as fs from 'fs';
import * as path from 'path';

/** 在 tests/.tmp 下创建唯一临时目录（工作区内，避免沙箱限制）。 */
export function mkTmpDir(prefix: string): string {
  const dir = path.resolve(__dirname, '..', '.tmp', prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 删除目录（含内容）。 */
export function rmDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** 轮询等待条件成立，超时抛错。 */
export async function waitFor(
  fn: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor 超时（${timeoutMs}ms）`);
    }
    await sleep(intervalMs);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 精确拉取公共数组（匹配拉取接口的数组形态断言助手）：模式不含通配符时返回数组引用。 */
export function arr<T = any>(core: { array(pattern: string): unknown }, pattern: string): T[] {
  const r = core.array(pattern);
  if (Array.isArray(r)) return r as T[];
  throw new Error('匹配拉取返回了映射，需要精确名: ' + pattern);
}

/** 写入模块夹具：YAML 配置 + CJS 程序。返回 { yamlPath, programPath }。 */
export function writeModuleFixture(
  dir: string,
  name: string,
  yaml: string,
  program: string,
): { yamlPath: string; programPath: string } {
  const yamlPath = path.join(dir, name + '.yaml');
  const programPath = path.join(dir, name + '.cjs');
  fs.writeFileSync(yamlPath, yaml, 'utf8');
  fs.writeFileSync(programPath, program, 'utf8');
  return { yamlPath, programPath };
}

/** 常用 YAML 模板。 */
export function yamlFor(name: string, opts: { startEvents?: string[]; listen?: string[]; extra?: string } = {}): string {
  const lines = ['name: ' + name, 'file: ./' + name + '.cjs'];
  if (opts.startEvents) lines.push('startEvents: [' + opts.startEvents.map((e) => '"' + e + '"').join(', ') + ']');
  if (opts.listen) lines.push('listen: [' + opts.listen.map((e) => '"' + e + '"').join(', ') + ']');
  if (opts.extra) lines.push(opts.extra);
  return lines.join('\n') + '\n';
}
