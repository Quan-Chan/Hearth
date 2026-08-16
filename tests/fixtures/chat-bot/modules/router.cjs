// 命令路由器：识别 ! 开头的消息并转为 chat:command 事件
module.exports = {
  name: 'router',
  onEvent(ctx, event) {
    if (event.name !== 'chat:receive') return;
    const msg = event.data;
    if (typeof msg.text !== 'string' || !msg.text.startsWith('!')) return;
    const [cmd, ...args] = msg.text.slice(1).split(' ');
    ctx.sendEvent('chat:command', { command: cmd, args: args.filter(Boolean), user: msg.user });
  },
};
