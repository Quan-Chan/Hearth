// 调度器：接收任务提交，定时到期后发出 task:due 事件
const timers = new Map();

module.exports = {
  name: 'scheduler',
  start(ctx) {
    ctx.exposeArray('tasks:queue', []);
    ctx.exposeArray('tasks:done', []);
  },
  onEvent(ctx, event) {
    if (event.name === 'task:submit') {
      const t = event.data;
      ctx.editArray('tasks:queue', { type: 'push', value: { id: t.id, name: t.name, status: 'queued' } });
      const delay = typeof t.delayMs === 'number' ? t.delayMs : 10;
      const timer = setTimeout(() => {
        timers.delete(t.id);
        ctx.sendEvent('task:due', { id: t.id, name: t.name });
      }, delay);
      timers.set(t.id, timer);
    } else if (event.name === 'task:cancel') {
      const timer = timers.get(event.data.id);
      if (timer) {
        clearTimeout(timer);
        timers.delete(event.data.id);
      }
      const queue = ctx.pullArray('tasks:queue');
      const idx = queue.findIndex((x) => x.id === event.data.id);
      if (idx >= 0) ctx.editArray('tasks:queue', { type: 'removeAt', index: idx });
    }
  },
  stop() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  },
};
