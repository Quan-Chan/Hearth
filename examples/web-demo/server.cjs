/**
 * Connect-Core Web 演示服务器：用户通过网页控制整个软件。
 * 启动：node examples/web-demo/server.cjs  （或 npm run demo:web）
 * 访问：http://127.0.0.1:3081
 *
 * 演示的核心框架特性：
 *  - 启动核心 = 启动整机（模块按事件自动启动）
 *  - 模块去另一个模块的公共数组里拿数据（映射语义，原生数组）
 *  - 下游模块基于上游模块产生的事件被唤起启动（alarm/notifier）
 *  - 停止模块 -> 其数组自动消失；热加载新模块（写 YAML 即生效）
 *  - 事件流水日志（三字段：type/source/message）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { startCore, formatLogEntry, categoryOf } = require('../../dist/index.js');

const ROOT = __dirname;
const MODULE_DIR = path.join(ROOT, 'modules');
const LOG_FILE = path.join(ROOT, 'logs', 'event-stream.log');
const PORT = Number(process.env.PORT || 3081);

async function main() {
  const core = await startCore({
    moduleDir: MODULE_DIR,
    logFile: LOG_FILE,
    watch: true,
    pollIntervalMs: 200,
  });

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
      // 静态页面
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(path.join(ROOT, 'public', 'index.html')));
        return;
      }
      // 全量状态：模块 + 数组 + 日志（按类别分组）
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const arrays = core.listArrays().map((name) => ({
          name,
          owner: core.arrayOwner(name),
          items: core.array(name),
        }));
        const logs = core.log.all().slice(-300);
        send(res, 200, {
          started: core.started,
          modules: core.listModules(),
          arrays,
          // 连续时间线：按发生顺序逐条输出（一行一条，需要分区时前端按 type 着色/过滤即可）
          logs: logs.map((e) => ({
            line: formatLogEntry(e),
            type: String(e.type),
            category: categoryOf(String(e.type)),
          })),
          logCount: core.log.all().length,
        });
        return;
      }
      // 产生数据（触发 app:produce，走完整流水线）
      if (req.method === 'POST' && url.pathname === '/api/produce') {
        const b = await readBody(req);
        const count = Math.min(Math.max(Number(b.count) || 1, 1), 50);
        const max = Math.min(Math.max(Number(b.max) || 100, 1), 1000);
        for (let i = 0; i < count; i++) {
          await core.sendEvent('app:produce', {
            id: Date.now() + '-' + i,
            label: '数据-' + i,
            value: Math.floor(Math.random() * max) + 1,
          });
        }
        send(res, 200, { ok: true, count });
        return;
      }
      // 清空数据
      if (req.method === 'POST' && url.pathname === '/api/clear') {
        await core.sendEvent('app:clear');
        send(res, 200, { ok: true });
        return;
      }
      // 发送自定义事件
      if (req.method === 'POST' && url.pathname === '/api/event') {
        const b = await readBody(req);
        if (typeof b.name !== 'string' || !b.name) return send(res, 400, { error: '缺少事件名' });
        await core.sendEvent(b.name, b.data);
        send(res, 200, { ok: true });
        return;
      }
      // 手动启动/停止模块（演示停止后数组消失）
      if (req.method === 'POST' && (url.pathname === '/api/module/start' || url.pathname === '/api/module/stop')) {
        const b = await readBody(req);
        if (url.pathname.endsWith('/start')) await core.startModule(String(b.name), 'manual');
        else await core.stopModule(String(b.name));
        send(res, 200, { ok: true });
        return;
      }
      // 热加载新模块：服务器写 YAML + 程序，ConfigWatcher 自动加载启动
      if (req.method === 'POST' && url.pathname === '/api/module/add') {
        const b = await readBody(req);
        const name = String(b.name || '').trim();
        if (!/^[a-z0-9_-]{1,32}$/i.test(name)) return send(res, 400, { error: '模块名只能包含字母、数字、-_' });
        const listen = Array.isArray(b.listen)
          ? b.listen.map(String).map((s) => s.trim()).filter(Boolean)
          : String(b.listen || '').split(',').map((s) => s.trim()).filter(Boolean);
        if (listen.length === 0) return send(res, 400, { error: '至少指定一个监听事件' });
        const yamlPath = path.join(MODULE_DIR, name + '.yaml');
        if (fs.existsSync(yamlPath)) return send(res, 400, { error: '模块 ' + name + ' 已存在' });
        const listenList = listen.map((e) => '  - "' + e + '"').join('\n');
        const program =
          'module.exports = {\n' +
          "  name: '" + name + "',\n" +
          "  start(ctx) { ctx.exposeArray('" + name + ":records', []); ctx.log('模块 " + name + " 已就绪'); },\n" +
          '  onEvent(ctx, event) {\n' +
          '    if (![' + listen.map((e) => "'" + e + "'").join(', ') + '].includes(event.name)) return;\n' +
          "    ctx.array('" + name + ":records').push({ event: event.name, at: Date.now() });\n" +
          "    ctx.log('" + name + " 收到事件: ' + event.name);\n" +
          '  },\n' +
          '};\n';
        fs.writeFileSync(path.join(MODULE_DIR, name + '.cjs'), program);
        const yaml = 'name: ' + name + '\nfile: ./' + name + '.cjs\nstartEvents:\n  - "core:startup"\nlisten:\n' + listenList + '\n';
        fs.writeFileSync(yamlPath, yaml);
        send(res, 200, { ok: true, name, listen });
        return;
      }
      // 移除模块（删 YAML，watcher 停止模块并移除）
      if (req.method === 'POST' && url.pathname === '/api/module/remove') {
        const b = await readBody(req);
        const name = String(b.name || '');
        const yamlPath = path.join(MODULE_DIR, name + '.yaml');
        if (!fs.existsSync(yamlPath)) return send(res, 404, { error: '未找到模块 ' + name });
        fs.rmSync(yamlPath);
        const cjsPath = path.join(MODULE_DIR, name + '.cjs');
        if (fs.existsSync(cjsPath)) fs.rmSync(cjsPath);
        send(res, 200, { ok: true });
        return;
      }
      send(res, 404, { error: '接口不存在' });
    } catch (err) {
      send(res, 500, { error: String((err && err.message) || err) });
    }
  });

  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log('');
    // eslint-disable-next-line no-console
    console.log('==============================================');
    // eslint-disable-next-line no-console
    console.log('  Connect-Core Web 演示已启动');
    // eslint-disable-next-line no-console
    console.log('  打开浏览器: http://127.0.0.1:' + PORT);
    // eslint-disable-next-line no-console
    console.log('==============================================');
    // eslint-disable-next-line no-console
    console.log('已加载模块: ' + core.listModules().map((m) => m.name + '(' + m.status + ')').join(', '));
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('启动失败:', err);
  process.exit(1);
});