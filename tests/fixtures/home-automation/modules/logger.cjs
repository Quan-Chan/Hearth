// 安全日志：通配符监听 home:*，原样记录所有家庭事件
module.exports = {
  name: 'logger',
  start(ctx) {
    ctx.exposeArray('home:log', []);
  },
  onEvent(ctx, event) {
    ctx.array('home:log').push({ event: event.name, data: event.data, at: Date.now() });
  },
};
