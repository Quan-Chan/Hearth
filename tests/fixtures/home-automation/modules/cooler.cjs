// 空调：收到制冷事件后工作，写模块日志
module.exports = {
  name: 'cooler',
  onEvent(ctx, event) {
    if (!event.name.endsWith(':home:cooling')) return;
    ctx.log('开始制冷:', event.data.room);
  },
};
