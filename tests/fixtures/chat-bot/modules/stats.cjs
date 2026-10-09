// 统计器：通配符监听 chat:*，统计事件数量
module.exports = {
  name: 'stats',
  start(ctx) {
    ctx.exposeObject('stats', { items: [{ key: 'events', count: 0 }] });
  },
  onEvent(ctx) {
    const stats = ctx.object('stats').items;
    const idx = stats.findIndex((s) => s.key === 'events');
    ctx.object('stats').items[idx] = { key: 'events', count: stats[idx].count + 1 };
  },
};