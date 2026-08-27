// 传感器：维护传感器状态（home:sensors）
module.exports = {
  name: 'sensor',
  start(ctx) {
    ctx.exposeArray('sensors', [{ room: 'living', motion: false }]);
  },
  onEvent(ctx, event) {
    if (!event.name.endsWith(':home:motion')) return;
    const m = event.data;
    const sensors = ctx.array('sensors');
    const idx = sensors.findIndex((s) => s.room === m.room);
    if (idx >= 0) ctx.array('sensors')[idx] = { room: m.room, motion: m.motion };
    else ctx.array('sensors').push({ room: m.room, motion: m.motion });
  },
};