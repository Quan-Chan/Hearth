/**
 * 外部进程（隔离沙箱客户端）：不跑 HTTP，自己拉文件玩。
 *  1. 自己拉取 outbox 库存文件，打印报告
 *  2. 投放事件文件（stock:add）请求核心入库
 *  3. 再拉一次，看到库存变化
 *  4. 投放越权事件（core:stop），验证被 guard 拒绝
 */
const fs = require('fs');
const path = require('path');

const WORK = path.join(__dirname, 'work');
const inbox = path.join(WORK, 'inbox');
const outbox = path.join(WORK, 'outbox');
const rejected = path.join(WORK, 'rejected');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 外部进程自己拉取 outbox 文件 */
function pullInventory() {
  const file = path.join(outbox, 'inventory-items.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** 外部进程投放事件文件 */
function dropEvent(fileName, event, data) {
  fs.writeFileSync(path.join(inbox, fileName), JSON.stringify({ event, data }));
  console.log('[外部进程] 投放事件文件: ' + fileName + ' -> 事件 ' + event + ' ' + JSON.stringify(data));
}

async function main() {
  console.log('========== 外部进程（文件管道客户端）开始 ==========');
  console.log('我的活动范围只有: ' + WORK);

  // ① 自己拉：查看当前库存
  console.log('\n--- 第 1 步：自己拉取 outbox 库存 ---');
  console.log('当前库存:', pullInventory());

  // ② 投放事件：请求核心入库
  console.log('\n--- 第 2 步：投放事件文件请求入库 ---');
  dropEvent('req-1.json', 'stock:add', { sku: 'SWORD-01', qty: 5 });
  dropEvent('req-2.json', 'stock:add', { sku: 'BOW-01', name: '长弓', qty: 3 });

  // 等核心处理 + 导出
  console.log('\n等待核心处理并导出（1.8s）...');
  await sleep(1800);

  // ③ 再拉一次：看到库存变化（核心的响应也是文件）
  console.log('\n--- 第 3 步：再拉一次，库存变化了 ---');
  console.log('当前库存:', pullInventory());

  // ④ 越权尝试：投放不在白名单的事件
  console.log('\n--- 第 4 步：尝试越权（投放 core:stop）---');
  dropEvent('evil-1.json', 'core:stop', { why: '想关掉核心' });
  await sleep(1000);
  const rejectedFiles = fs.existsSync(rejected) ? fs.readdirSync(rejected) : [];
  console.log('越权请求去向:', rejectedFiles.length ? rejectedFiles.map((f) => 'work/rejected/' + f).join(', ') : '(无)');

  // ⑤ 拉取事件流水日志（核心的日志文件也可以直接读）
  console.log('\n--- 第 5 步：自己拉核心的事件流水日志（tail） ---');
  const logFile = path.join(__dirname, 'logs', 'event-stream.log');
  if (fs.existsSync(logFile)) {
    const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean).slice(-8);
    for (const l of lines) {
      const e = JSON.parse(l);
      console.log('  ' + e.t.slice(11, 23) + ' [' + e.type + '] ' + e.source + ': ' + e.message + (e.data ? ' ' + JSON.stringify(e.data) : ''));
    }
  }
  console.log('\n========== 外部进程结束 ==========');
}

main().catch((e) => {
  console.error('外部进程出错:', e);
  process.exit(1);
});
