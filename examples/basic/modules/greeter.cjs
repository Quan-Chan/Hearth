// 问候模块：core:startup 启动，监听 greet 事件
module.exports = {
  name: 'greeter',
  start(ctx) {
    ctx.exposeArray('greetings', []);
    ctx.log('问候模块已就绪');
  },
  onEvent(ctx, event) {
    if (event.name !== 'greet') return;
    const text = '你好, ' + event.data.name + '!';
    ctx.editArray('greetings', { type: 'push', value: text });
    ctx.log('收到问候:', event.data.name);
  },
};
