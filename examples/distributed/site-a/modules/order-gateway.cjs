// 订单网关（site-a 业务模块）：接收新订单，写入待处理数组，发出同步事件
module.exports = {
  name: 'order-gateway',
  start(ctx) {
    ctx.exposeArray('orders:pending', []);
    ctx.log('订单网关就绪');
  },
  onEvent(ctx, event) {
    if (event.name !== 'order:new') return;
    const order = { id: event.data.id, goods: event.data.goods, status: 'pending', at: Date.now() };
    ctx.array('orders:pending').push(order);
    ctx.log('收到新订单: ' + order.id + ' ' + order.goods);
    // 交给胶水层转发到远端执行中心
    ctx.sendEvent('order:sync', order);
  },
};
