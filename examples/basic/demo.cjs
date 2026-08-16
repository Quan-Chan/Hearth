/**
 * 演示脚本：启动即整机 —— 启动核心，模块自动就绪，事件链式协作。
 * 运行：node examples/basic/demo.cjs  （或 npm run demo）
 *
 * 事件链：echo 事件 -> greeter 收到并转为 greet 事件 -> 写入 greetings 公共数组
 * 日志：只记录核心自己干的事情（三字段：type/source/message），按类别分组展示。
 */
const path = require('path');
const fs = require('fs');
const { startCore, formatLogEntry } = require('../../dist/index.js');

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

  console.log('\n=== 4. 发送一个无人监听的事件（应记录 event-drop） ===');
  await core.sendEvent('no:one-listens', { note: '测试丢弃' });

  console.log('\n=== 5. 查看公共数组 greetings（实时引用，原生数组） ===');
  console.log(core.array('greetings'));

  console.log('\n=== 6. 关闭核心（模块停止，其数组自动消失） ===');
  await core.stop();

  console.log('\n=== 事件流水日志（连续时间线：发生什么就记录什么） ===');
  const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean);
  const entries = lines.map((l) => JSON.parse(l));
  for (const e of entries) {
    console.log(formatLogEntry(e));
  }
}

main().catch((err) => {
  console.error('演示失败:', err);
  process.exit(1);
});