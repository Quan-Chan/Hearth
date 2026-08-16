// 订单审计（site-a 业务模块）：收到远端执行回执，登记审计
module.exports = {
  name: 'order-audit',
  start(ctx) {
    ctx.exposeArray('orders:audit', []);
    ctx.log('订单审计就绪');
  },
  onEvent(ctx, event) {
    if (event.name !== 'order:done') return;
    ctx.array('orders:audit').push({ ...event.data, auditedAt: Date.now() });
    ctx.log('订单回执已登记: ' + event.data.id + ' → ' + event.data.status);
  },
};
