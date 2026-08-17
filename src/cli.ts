/**
 * Connect-Core 命令行入口：启动它等于启动整个软件。
 * 用法：node dist/cli.js [connect-core.yaml]
 * 配置文件示例：
 *   core:
 *     moduleDir: ./modules
 *     logFile: ./logs/event-stream.log
 *     watch: true
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

  // 保持进程存活：核心启动后持续监听模块文件夹并响应事件
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

main().catch((err: Error) => {
  // eslint-disable-next-line no-console
  console.error('[connect-core] 启动失败:', err.message);
  process.exit(1);
});