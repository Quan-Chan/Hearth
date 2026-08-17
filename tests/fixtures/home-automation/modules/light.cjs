// 灯光控制：有人移动开灯，无人关灯
module.exports = {
  name: 'light',
  start(ctx) {
    ctx.exposeArray('home:lights', [{ room: 'living', on: false }]);
  },
  onEvent(ctx, event) {
    if (event.name !== 'home:motion') return;
    const m = event.data;
    const lights = ctx.array('home:lights');
    const idx = lights.findIndex((l) => l.room === m.room);
    if (idx >= 0) ctx.array('home:lights')[idx] = { room: m.room, on: !!m.motion };
    else ctx.array('home:lights').push({ room: m.room, on: !!m.motion });
  },
};