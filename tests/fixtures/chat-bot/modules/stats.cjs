// 统计器：通配符监听 chat:*，统计事件数量
module.exports = {
  name: 'stats',
  start(ctx) {
    ctx.exposeArray('chat:stats', [{ key: 'events', count: 0 }]);
  },
  onEvent(ctx) {
    const stats = ctx.array('chat:stats');
    const idx = stats.findIndex((s) => s.key === 'events');
    ctx.editArray('chat:stats', { type: 'set', index: idx, value: { key: 'events', count: stats[idx].count + 1 } });
  },
};