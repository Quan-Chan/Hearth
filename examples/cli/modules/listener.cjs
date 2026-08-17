// 普通监听模块：按 YAML 声明的 listen 收事件（与定向发送形成对照）。
module.exports = {
  name: 'listener',
  start(ctx) {
    ctx.exposeArray('listener:got', []);
    ctx.log('listener 已就绪（监听 hello / ping:*）');
  },
  onEvent(ctx, event) {
    ctx.array('listener:got').push({ event: event.name, data: event.data, at: Date.now() });
    ctx.log('listener 收到事件: ' + event.name);
  },
};
