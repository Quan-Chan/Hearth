// 回声模块：不监听任何事件（listen 为空）。
// 只能通过 CLI 的定向发送（send 指令）把自己的事件信息送达。
// 响应模式：
//  (a) 处理完广播 echo:done 事件（"已完成/有信息"信号）；
//  (b) 实际内容放进公开数组 echo:out，别的模块/CLI 直接拉取。
module.exports = {
  name: 'echo',
  start(ctx) {
    ctx.exposeArray('echo:out', []);
    ctx.log('echo 已就绪（不监听事件，等定向发送）');
  },
  onEvent(ctx, event) {
    ctx.array('echo:out').push({ event: event.name, data: event.data, at: Date.now() });
    ctx.log('echo 收到定向事件: ' + event.name);
    ctx.sendEvent('echo:done', { name: event.name }); // 广播"已完成"
  },
};
