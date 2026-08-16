/**
 * 文件管道式隔离胶水层演示：核心侧服务器。
 * 启动：node examples/fileguard/server.cjs
 * 外部进程不通过 HTTP 与核心交互，只通过 work/ 目录：
 *   - work/inbox    外部进程投放事件文件（JSON），guard 校验后注入核心
 *   - work/outbox   guard 定期导出白名单数组（JSONL），外部进程自己拉
 *   - work/rejected 越权/非法请求的存放处
 */
const path = require('path');
const { startCore } = require('../../dist/index.js');

async function main() {
  const MODULE_DIR = path.join(__dirname, 'modules');
  const LOG_FILE = path.join(__dirname, 'logs', 'event-stream.log');
  const core = await startCore({ moduleDir: MODULE_DIR, logFile: LOG_FILE, watch: true, pollIntervalMs: 200 });

  // eslint-disable-next-line no-console
  console.log('[核心] 已启动: ' + core.listModules().map((m) => m.name + '(' + m.status + ')').join(', '));
  // eslint-disable-next-line no-console
  console.log('[核心] 外部进程通道: ' + path.join(__dirname, 'work'));
  // 保持进程存活
  setInterval(() => {}, 60_000);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('启动失败:', err);
  process.exit(1);
});
