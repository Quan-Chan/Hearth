// 任务结果登记：把外部进程算好的结果记入数组
module.exports = {
  name: 'task-audit',
  start(ctx) {
    ctx.exposeArray('tasks:results', []);
    ctx.log('结果登记就绪');
  },
  onEvent(ctx, event) {
    if (event.name !== 'task:done') return;
    const r = event.data;
    ctx.array('tasks:results').push({
      id: r.id,
      n: r.n,
      result: r.result,
      workerMs: r.workerMs,
      receivedAt: Date.now(),
    });
    ctx.log('收到外部计算结果: ' + r.id + ' = ' + r.result + '（外部耗时 ' + r.workerMs + 'ms）');
  },
};
