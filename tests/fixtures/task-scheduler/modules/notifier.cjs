// 通知器：任务完成时产生通知
module.exports = {
  name: 'notifier',
  start(ctx) {
    ctx.exposeArray('notifications', []);
  },
  onEvent(ctx, event) {
    if (!event.name.endsWith(':task:done')) return;
    ctx.array('notifications').push({ id: event.data.id, text: '任务 ' + event.data.name + ' 已完成' });
  },
};
