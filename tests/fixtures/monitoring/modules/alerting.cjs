// 告警器：超过 YAML 配置的阈值则告警
module.exports = {
  name: 'alerting',
  start(ctx) {
    ctx.exposeObject('active', { items: [] });
  },
  onEvent(ctx, event) {
    if (!event.name.endsWith(':app:metric')) return;
    const m = event.data;
    const threshold = ctx.config.config && typeof ctx.config.config.threshold === 'number' ? ctx.config.config.threshold : Infinity;
    if (typeof m.value === 'number' && m.value > threshold) {
      ctx.object('active').items.push({ name: m.name, value: m.value });
      ctx.sendEvent('alert:fired', { name: m.name, value: m.value });
    }
  },
};
