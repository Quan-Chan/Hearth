// 告警看板：记录所有历史告警
module.exports = {
  name: 'dashboard',
  start(ctx) {
    ctx.exposeArray('alerts:history', []);
  },
  onEvent(ctx, event) {
    if (event.name !== 'alert:fired') return;
    ctx.array('alerts:history').push({ name: event.data.name, value: event.data.value, at: Date.now() });
  },
};
