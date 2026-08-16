// 回声应答：响应 !echo
module.exports = {
  name: 'echo',
  onEvent(ctx, event) {
    if (event.name !== 'chat:command') return;
    const c = event.data;
    if (c.command === 'echo') {
      ctx.sendEvent('chat:reply', { user: c.user, text: c.args.join(' ') });
    }
  },
};
