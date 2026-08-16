// 订单执行器（site-b 业务模块）：收到远端同步来的订单，执行并回执
module.exports = {
  name: 'order-executor',
  start(ctx) {
    ctx.exposeArray('orders:done', []);
    ctx.log('订单执行器就绪');
  },
  onEvent(ctx, event) {
    if (event.name !== 'order:sync') return;
    const order = event.data;
    // 模拟执行（真实场景：调用仓库系统）
    const done = { id: order.id, goods: order.goods, status: 'done', executedAt: Date.now() };
    ctx.array('orders:done').push(done);
    ctx.log('执行订单: ' + order.id + ' ' + order.goods);
    // 回执交给胶水层转发回订单中心
    ctx.sendEvent('order:done', done);
  },
};
