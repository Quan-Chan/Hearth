/**
 * Connect-Core 启动入口：一个命令行外衣里的"整机开关"。
 *
 * 执行逻辑：
 *  1. 读配置：默认取命令行第 2 个参数或当前目录 connect-core.yaml；
 *     有则解析出 core 段的启动选项，没有则全部走默认值。
 *  2. 启动核心（startCore）：核心扫描模块目录、发出 core:startup，
 *     所有依赖该事件的模块自动启动——到这步，"整机"其实已经起来了。
 *  3. 驻留：核心的模块监听轮询器是 unref 的（不阻止进程退出），所以这里用一个
 *     永不触发的定时器占住事件循环，让进程活到用户主动关闭。
 *  4. 收尾：SIGINT / SIGTERM 时优雅关闭——逐个停止模块（各自 stop() 收尾）、落盘日志、退出。
 *     再逆序停止、落盘日志、退出。
 *
 * 用法：node dist/connect-core.js [connect-core.yaml]
 * 配置示例（connect-core.yaml）：
 *   core:
 *     moduleDir: ./modules        # 模块（YAML 配置）所在目录
 *     logFile: ./logs/event-stream.log
 *     watch: true                 # 是否监听模块目录变化（热加载）
 */
import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { startCore } from './index';
import type { ConnectCoreOptions } from './types';

async function main(): Promise<void> {
  const configPath = path.resolve(process.argv[2] ?? 'connect-core.yaml');
  const options: ConnectCoreOptions = {};
  if (fs.existsSync(configPath)) {
    const raw = parseYaml(fs.readFileSync(configPath, 'utf8')) as Record<string, any> | null;
    const coreCfg: Record<string, any> = (raw?.core ?? raw ?? {}) as Record<string, any>;
    // YAML 里的相对路径都相对配置文件所在目录解析（而非当前工作目录），
    // 这样即使从任意目录用绝对路径指过来，也能正确定位模块。
    const baseDir = path.dirname(configPath);
    if (coreCfg.moduleDir) options.moduleDir = path.resolve(baseDir, String(coreCfg.moduleDir));
    if (coreCfg.logFile) options.logFile = path.resolve(baseDir, String(coreCfg.logFile));
    if (coreCfg.watch !== undefined) options.watch = Boolean(coreCfg.watch);
    if (coreCfg.logToConsole) options.logToConsole = true;
    // eslint-disable-next-line no-console
    console.log(`[connect-core] 读取配置文件: ${configPath}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[connect-core] 未找到 ${configPath}，使用默认配置`);
  }

  const core = await startCore(options);

  // eslint-disable-next-line no-console
  console.log('[connect-core] 核心已启动');
  // eslint-disable-next-line no-console
  console.log(`[connect-core] 模块目录: ${core.options.moduleDir}`);
  // eslint-disable-next-line no-console
  console.log(`[connect-core] 事件流水: ${core.options.logFile}`);
  // eslint-disable-next-line no-console
  console.log(
    '[connect-core] 已加载模块: ' +
      (core.listModules().map((m) => m.name).join(', ') || '(无)'),
  );

  // 占住事件循环：真正的工作（模块监听 / 事件路由）都挂在核心内部，
  // 这里只需让进程不自然退出；退出由下方信号处理决定。
  setInterval(() => {}, 60_000);

  const shutdown = async (): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log('[connect-core] 正在关闭...');
    await core.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

// 启动失败也要干净退出并给出可诊断的报错，而不是挂在半初始化的状态。
main().catch((err: Error) => {
  // eslint-disable-next-line no-console
  console.error('[connect-core] 启动失败:', err.message);
  process.exit(1);
});
