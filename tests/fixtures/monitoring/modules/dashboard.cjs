// 告警看板：记录所有历史告警
module.exports = {
  name: 'dashboard',
  start(ctx) {
    ctx.exposeObject('history', { items: [] });
  },
  onEvent(ctx, event) {
    if (!event.name.endsWith(':alert:fired')) return;
    ctx.object('history').items.push({ name: event.data.name, value: event.data.value, at: Date.now() });
  },
};
