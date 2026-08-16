/**
 * 分布式胶水层演示：Connect-Core 站点服务器。
 * 启动：node examples/distributed/server.cjs a   （订单中心，端口 3081）
 *       node examples/distributed/server.cjs b   （执行中心，端口 3082）
 *
 * 两个站点各自是一个完整的 Connect-Core；bridge 胶水层模块负责跨站点：
 *  - POST /api/event  胶水层把远端事件注入本站事件总线（业务模块无感接收）
 *  - GET  /api/array  胶水层拉取本站数组（远端镜像数据）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { startCore, formatLogEntry } = require('../../dist/index.js');

const SITES = {
  a: { port: 3091, dir: 'site-a', title: '订单中心 (site-a)' },
  b: { port: 3092, dir: 'site-b', title: '执行中心 (site-b)' },
};

async function main() {
  const site = SITES[process.argv[2]] || SITES.a;
  const ROOT = __dirname;
  const MODULE_DIR = path.join(ROOT, site.dir, 'modules');
  const LOG_FILE = path.join(ROOT, site.dir, 'logs', 'event-stream.log');

  const core = await startCore({ moduleDir: MODULE_DIR, logFile: LOG_FILE, watch: true, pollIntervalMs: 200 });

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
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        res.end(html.replace('__TITLE__', site.title).replace('__PORT__', String(site.port)));
        return;
      }
      // 胶水层接口：注入远端事件
      if (req.method === 'POST' && url.pathname === '/api/event') {
        const b = await readBody(req);
        if (typeof b.name !== 'string' || !b.name) return send(res, 400, { error: '缺少事件名' });
        await core.sendEvent(b.name, b.data);
        send(res, 200, { ok: true, event: b.name });
        return;
      }
      // 胶水层接口：拉取数组
      if (req.method === 'GET' && url.pathname === '/api/array') {
        const name = url.searchParams.get('name');
        if (!name || !core.listArrays().includes(name)) return send(res, 404, { error: '数组不存在: ' + name });
        send(res, 200, core.array(name));
        return;
      }
      // 本站点状态
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const arrays = core.listArrays().map((name) => ({ name, owner: core.arrayOwner(name), items: core.array(name) }));
        send(res, 200, {
          title: site.title,
          port: site.port,
          modules: core.listModules(),
          arrays,
          logs: core.log.all().slice(-200).map((e) => formatLogEntry(e)),
        });
        return;
      }
      send(res, 404, { error: '接口不存在' });
    } catch (err) {
      send(res, 500, { error: String((err && err.message) || err) });
    }
  });

  server.listen(site.port, () => {
    // eslint-disable-next-line no-console
    console.log('[' + site.title + '] http://127.0.0.1:' + site.port + '  模块: ' + core.listModules().map((m) => m.name).join(', '));
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('启动失败:', err);
  process.exit(1);
});
