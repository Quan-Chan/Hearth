// 消息网关：维护聊天记录与在线用户（数据都放在公共数组里）
module.exports = {
  name: 'gateway',
  start(ctx) {
    ctx.exposeArray('chat:history', []);
    ctx.exposeArray('chat:users', []);
  },
  onEvent(ctx, event) {
    if (event.name === 'chat:receive') {
      const msg = event.data;
      ctx.editArray('chat:history', { type: 'push', value: { type: 'message', user: msg.user, text: msg.text, room: msg.room } });
      const users = ctx.pullArray('chat:users');
      if (!users.some((u) => u.name === msg.user)) {
        ctx.editArray('chat:users', { type: 'push', value: { name: msg.user, joinedAt: Date.now() } });
      }
    } else if (event.name === 'chat:reply') {
      const r = event.data;
      ctx.editArray('chat:history', { type: 'push', value: { type: 'reply', user: r.user, text: r.text } });
    }
  },
};
