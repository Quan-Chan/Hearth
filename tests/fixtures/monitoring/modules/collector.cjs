// 指标采集器：维护最新指标（按名称去重）
module.exports = {
  name: 'collector',
  start(ctx) {
    ctx.exposeObject('latest', { items: [] });
  },
  onEvent(ctx, event) {
    if (!event.name.endsWith(':app:metric')) return;
    const m = event.data;
    const latest = ctx.object('latest').items;
    const idx = latest.findIndex((x) => x.name === m.name);
    if (idx >= 0) {
      // 同名指标：更新（set 覆盖）
      ctx.object('latest').items[idx] = { name: m.name, value: m.value, at: Date.now() };
    } else {
      ctx.object('latest').items.push({ name: m.name, value: m.value, at: Date.now() });
    }
  },
};