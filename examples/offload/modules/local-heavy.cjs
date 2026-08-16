// 本地重计算模块（对照实验）：在核心进程内同步计算 —— 会阻塞事件循环
module.exports = {
  name: 'local-heavy',
  start(ctx) {
    ctx.exposeArray('tasks:local-results', []);
    ctx.log('本地重计算模块就绪（同步计算，会阻塞核心）');
  },
  onEvent(ctx, event) {
    if (event.name !== 'task:local') return;
    const t = event.data;
    const start = Date.now();
    const result = heavy(t.n); // 同步 CPU 密集 —— 卡住整个事件循环
    ctx.array('tasks:local-results').push({ id: t.id, n: t.n, result, coreMs: Date.now() - start });
    ctx.log('本地同步计算完成: ' + t.id + ' = ' + result + '（核心内耗时 ' + (Date.now() - start) + 'ms，期间心跳被阻塞）');
  },
};

// 迭代斐波那契模拟 CPU 密集任务（n 次迭代）
// 迭代计算（取模防溢出）：结果稳定可读，计算量由 n 控制
function heavy(n) {
  let a = 1;
  let b = 1;
  for (let i = 0; i < n; i++) {
    const c = (a + b) % 1000000007;
    a = b;
    b = c;
  }
  return b;
}