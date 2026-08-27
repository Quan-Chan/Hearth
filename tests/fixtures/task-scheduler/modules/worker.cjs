// 执行器：任务到期后执行（模拟），写入完成结果
module.exports = {
  name: 'worker',
  onEvent(ctx, event) {
    if (!event.name.endsWith(':task:due')) return;
    const t = event.data;
    ctx.array('public:scheduler:done').push({ id: t.id, name: t.name, status: 'done', completedAt: Date.now() });
    ctx.sendEvent('task:done', { id: t.id, name: t.name });
  },
};
