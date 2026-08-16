/**
 * 演示脚本：启动即整机 —— 启动核心，模块自动就绪，事件链式协作。
 * 运行：node examples/basic/demo.cjs  （或 npm run demo）
 *
 * 事件链：echo 事件 -> greeter 收到并转为 greet 事件 -> 写入 greetings 公共数组
 */
const path = require('path');
const fs = require('fs');
const { startCore } = require('../../dist/index.js');

async function main() {
  const moduleDir = path.join(__dirname, 'modules');
  const logFile = path.join(__dirname, 'logs', 'event-stream.log');
  fs.rmSync(path.dirname(logFile), { recursive: true, force: true }); // 全新日志

  console.log('=== 1. 启动核心（= 启动整个软件） ===');
  const core = await startCore({ moduleDir, logFile, watch: false });
  console.log('已加载模块:', core.listModules().map((m) => m.name + '(' + m.status + ')').join(', '));

  console.log('\n=== 2. 发送事件：echo（回声模块转 greet，问候模块应答） ===');
  await core.sendEvent('echo', { text: '世界' });
  await core.sendEvent('echo', { text: 'Connect-Core' });

  console.log('\n=== 3. 发送事件：greet（直接问候） ===');
  await core.sendEvent('greet', { name: 'Node.js' });

  console.log('\n=== 4. 查看公共数组 greetings ===');
  console.log(core.pullArray('greetings'));

  console.log('\n=== 5. 关闭核心 ===');
  await core.stop();

  console.log('\n=== 事件流水日志（logs/event-stream.log） ===');
  const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const e = JSON.parse(line);
    const t = e.t.slice(11, 23);
    let msg = t + '  [' + e.type + ']';
    if (e.event) msg += ' ' + e.event + (e.source ? '  (source=' + e.source + ')' : '');
    if (e.module) msg += '  module=' + e.module;
    if (e.reason) msg += '  reason=' + e.reason;
    if (e.message) msg += '  message=' + e.message;
    if (e.array) msg += '  array=' + e.array + '  owner=' + (e.owner || '');
    if (e.data !== undefined) msg += '  data=' + JSON.stringify(e.data);
    console.log(msg);
  }
}

main().catch((err) => {
  console.error('演示失败:', err);
  process.exit(1);
});
