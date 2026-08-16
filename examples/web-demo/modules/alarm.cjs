// 告警器：不随 core:startup 启动！基于 stats:updated 事件出现才被核心唤起
// 从 reporter 的数组拿数据，超过 YAML 配置的阈值则告警
module.exports = {
  name: 'alarm',
  start(ctx) {
    ctx.exposeArray('alarm:active', []);
    ctx.log('告警器启动（由 stats:updated 事件唤起）');
  },
  onEvent(ctx, event) {
    if (event.name !== 'stats:updated') return;
    // 去另一个模块（reporter）的数组里拿数据
    const summary = ctx.array('stats:summary');
    const max = summary.find((s) => s.key === 'max')?.value ?? 0;
    const threshold = ctx.config.config && typeof ctx.config.config.threshold === 'number' ? ctx.config.config.threshold : 100;
    if (max > threshold) {
      ctx.array('alarm:active').push({ at: Date.now(), max, threshold, msg: '最大值 ' + max + ' 超过阈值 ' + threshold });
      ctx.log('告警触发: max=' + max + ' > ' + threshold);
      ctx.sendEvent('alarm:fired', { max, threshold });
    }
  },
};
