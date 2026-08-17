// 传感器：维护传感器状态（home:sensors）
module.exports = {
  name: 'sensor',
  start(ctx) {
    ctx.exposeArray('home:sensors', [{ room: 'living', motion: false }]);
  },
  onEvent(ctx, event) {
    if (event.name !== 'home:motion') return;
    const m = event.data;
    const sensors = ctx.array('home:sensors');
    const idx = sensors.findIndex((s) => s.room === m.room);
    if (idx >= 0) ctx.array('home:sensors')[idx] = { room: m.room, motion: m.motion };
    else ctx.array('home:sensors').push({ room: m.room, motion: m.motion });
  },
};