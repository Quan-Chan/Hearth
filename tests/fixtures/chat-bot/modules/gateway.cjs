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
      ctx.array('chat:history').push({ type: 'message', user: msg.user, text: msg.text, room: msg.room });
      const users = ctx.array('chat:users');
      if (!users.some((u) => u.name === msg.user)) {
        ctx.array('chat:users').push({ name: msg.user, joinedAt: Date.now() });
      }
    } else if (event.name === 'chat:reply') {
      const r = event.data;
      ctx.array('chat:history').push({ type: 'reply', user: r.user, text: r.text });
    }
  },
};