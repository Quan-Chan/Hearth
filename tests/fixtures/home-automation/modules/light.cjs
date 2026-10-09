// 灯光控制：有人移动开灯，无人关灯
module.exports = {
  name: 'light',
  start(ctx) {
    ctx.exposeObject('lights', { items: [{ room: 'living', on: false }] });
  },
  onEvent(ctx, event) {
    if (!event.name.endsWith(':home:motion')) return;
    const m = event.data;
    const lights = ctx.object('lights').items;
    const idx = lights.findIndex((l) => l.room === m.room);
    if (idx >= 0) ctx.object('lights').items[idx] = { room: m.room, on: !!m.motion };
    else ctx.object('lights').items.push({ room: m.room, on: !!m.motion });
  },
};