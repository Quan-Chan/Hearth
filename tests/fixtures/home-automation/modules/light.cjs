// 灯光控制：有人移动开灯，无人关灯
module.exports = {
  name: 'light',
  start(ctx) {
    ctx.exposeArray('lights', [{ room: 'living', on: false }]);
  },
  onEvent(ctx, event) {
    if (!event.name.endsWith(':home:motion')) return;
    const m = event.data;
    const lights = ctx.array('lights');
    const idx = lights.findIndex((l) => l.room === m.room);
    if (idx >= 0) ctx.array('lights')[idx] = { room: m.room, on: !!m.motion };
    else ctx.array('lights').push({ room: m.room, on: !!m.motion });
  },
};