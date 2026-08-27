// 指标采集器：维护最新指标（按名称去重）
module.exports = {
  name: 'collector',
  start(ctx) {
    ctx.exposeArray('latest', []);
  },
  onEvent(ctx, event) {
    if (!event.name.endsWith(':app:metric')) return;
    const m = event.data;
    const latest = ctx.array('latest');
    const idx = latest.findIndex((x) => x.name === m.name);
    if (idx >= 0) {
      // 同名指标：更新（set 覆盖）
      ctx.array('latest')[idx] = { name: m.name, value: m.value, at: Date.now() };
    } else {
      ctx.array('latest').push({ name: m.name, value: m.value, at: Date.now() });
    }
  },
};