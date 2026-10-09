// 传感器：维护传感器状态（home:sensors）
module.exports = {
  name: 'sensor',
  start(ctx) {
    ctx.exposeObject('sensors', { items: [{ room: 'living', motion: false }] });
  },
  onEvent(ctx, event) {
    if (!event.name.endsWith(':home:motion')) return;
    const m = event.data;
    const sensors = ctx.object('sensors').items;
    const idx = sensors.findIndex((s) => s.room === m.room);
    if (idx >= 0) ctx.object('sensors').items[idx] = { room: m.room, motion: m.motion };
    else ctx.object('sensors').items.push({ room: m.room, motion: m.motion });
  },
};