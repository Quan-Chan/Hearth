// 消息网关：维护聊天记录与在线用户（数据都放在公共对象里）
module.exports = {
  name: 'gateway',
  start(ctx) {
    ctx.exposeObject('history', { items: [] });
    ctx.exposeObject('users', { items: [] });
  },
  onEvent(ctx, event) {
    if (event.name.endsWith(':chat:receive')) {
      const msg = event.data;
      ctx.object('history').items.push({ type: 'message', user: msg.user, text: msg.text, room: msg.room });
      const users = ctx.object('users').items;
      if (!users.some((u) => u.name === msg.user)) {
        ctx.object('users').items.push({ name: msg.user, joinedAt: Date.now() });
      }
    } else if (event.name.endsWith(':chat:reply')) {
      const r = event.data;
      ctx.object('history').items.push({ type: 'reply', user: r.user, text: r.text });
    }
  },
};