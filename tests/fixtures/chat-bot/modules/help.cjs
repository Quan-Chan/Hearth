// 帮助应答：响应 !help
module.exports = {
  name: 'help',
  onEvent(ctx, event) {
    if (!event.name.endsWith(':chat:command')) return;
    const c = event.data;
    if (c.command === 'help') {
      ctx.sendEvent('chat:reply', { user: c.user, text: '可用命令：!help、!echo <内容>' });
    }
  },
};
