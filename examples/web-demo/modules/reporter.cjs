// 统计员：从 processor 的数组拿数据（跨模块），计算统计并广播
module.exports = {
  name: 'reporter',
  start(ctx) {
    ctx.exposeArray('stats:summary', [
      { key: 'total', value: 0 },
      { key: 'avg', value: 0 },
      { key: 'max', value: 0 },
    ]);
    ctx.log('统计员就绪');
  },
  onEvent(ctx, event) {
    if (event.name !== 'app:processed') return;
    // 去另一个模块（processor）的数组里拿数据
    const processed = ctx.array('data:processed');
    const values = processed.map((p) => p.value);
    const summary = ctx.array('stats:summary');
    summary[0] = { key: 'total', value: values.length };
    summary[1] = { key: 'avg', value: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0 };
    summary[2] = { key: 'max', value: values.length ? Math.max(...values) : 0 };
    // 广播统计更新（alarm 模块靠这个事件被唤起启动）
    ctx.sendEvent('stats:updated', { total: summary[0].value, avg: summary[1].value, max: summary[2].value });
  },
};
