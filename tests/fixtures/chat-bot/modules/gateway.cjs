// 消息网关：维护聊天记录与在线用户（数据都放在公共数组里）
module.exports = {
  name: 'gateway',
  start(ctx) {
    ctx.exposeArray('history', []);
    ctx.exposeArray('users', []);
  },
  onEvent(ctx, event) {
    if (event.name.endsWith(':chat:receive')) {
      const msg = event.data;
      ctx.array('history').push({ type: 'message', user: msg.user, text: msg.text, room: msg.room });
      const users = ctx.array('users');
      if (!users.some((u) => u.name === msg.user)) {
        ctx.array('users').push({ name: msg.user, joinedAt: Date.now() });
      }
    } else if (event.name.endsWith(':chat:reply')) {
      const r = event.data;
      ctx.array('history').push({ type: 'reply', user: r.user, text: r.text });
    }
  },
};