// 调度器：接收任务提交，定时到期后发出 task:due 事件
const timers = new Map();

module.exports = {
  name: 'scheduler',
  start(ctx) {
    ctx.exposeObject('queue', { items: [] });
    ctx.exposeObject('done', { items: [] });
  },
  onEvent(ctx, event) {
    if (event.name.endsWith(':task:submit')) {
      const t = event.data;
      ctx.object('queue').items.push({ id: t.id, name: t.name, status: 'queued' });
      const delay = typeof t.delayMs === 'number' ? t.delayMs : 10;
      const timer = setTimeout(() => {
        timers.delete(t.id);
        ctx.sendEvent('task:due', { id: t.id, name: t.name });
      }, delay);
      timers.set(t.id, timer);
    } else if (event.name.endsWith(':task:cancel')) {
      const timer = timers.get(event.data.id);
      if (timer) {
        clearTimeout(timer);
        timers.delete(event.data.id);
      }
      const queue = ctx.object('queue').items;
      const idx = queue.findIndex((x) => x.id === event.data.id);
      if (idx >= 0) ctx.object('queue').items.splice(idx, 1);
    }
  },
  stop() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  },
};