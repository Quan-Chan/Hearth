// 安全日志：通配符监听 home:*，原样记录所有家庭事件
module.exports = {
  name: 'logger',
  start(ctx) {
    ctx.exposeArray('events', []);
  },
  onEvent(ctx, event) {
    ctx.array('events').push({ event: event.name, data: event.data, at: Date.now() });
  },
};
