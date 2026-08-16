/**
 * 分散线程压力演示：核心侧服务器。
 * 启动：node examples/offload/server.cjs
 * 另开一个进程跑外部计算：node examples/offload/worker.cjs
 *
 * 演示目标：
 *  - 重计算任务卸载到外部进程（文件交互），核心事件循环保持轻快（心跳稳定）
 *  - 对照：task:local 在核心内同步计算，心跳被阻塞
 */
const http = require('http');
const path = require('path');
const { startCore, formatLogEntry } = require('../../dist/index.js');

async function main() {
  const MODULE_DIR = path.join(__dirname, 'modules');
  const LOG_FILE = path.join(__dirname, 'logs', 'event-stream.log');
  const core = await startCore({ moduleDir: MODULE_DIR, logFile: LOG_FILE, watch: true, pollIntervalMs: 200 });

  // eslint-disable-next-line no-console
  console.log('[核心] 已启动: ' + core.listModules().map((m) => m.name + '(' + m.status + ')').join(', '));

  const send = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 1e6) req.destroy();
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          reject(new Error('请求体不是合法 JSON'));
        }
      });
    });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'POST' && url.pathname === '/api/event') {
        const b = await readBody(req);
        await core.sendEvent(b.name, b.data);
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const arrays = core.listArrays().map((name) => ({ name, owner: core.arrayOwner(name), items: core.array(name) }));
        send(res, 200, { modules: core.listModules(), arrays, logs: core.log.all().slice(-100).map((e) => formatLogEntry(e)) });
        return;
      }
      send(res, 404, { error: '接口不存在' });
    } catch (err) {
      send(res, 500, { error: String((err && err.message) || err) });
    }
  });
  server.listen(3083, () => {
    // eslint-disable-next-line no-console
    console.log('[核心] 控制接口: http://127.0.0.1:3083');
  });
  setInterval(() => {}, 60_000);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('启动失败:', err);
  process.exit(1);
});