// 温控器：温度超过阈值发出制冷事件，维护设备状态
module.exports = {
  name: 'thermostat',
  start(ctx) {
    ctx.exposeArray('devices', [{ room: 'living', cooling: false }]);
  },
  onEvent(ctx, event) {
    if (event.name.endsWith(':home:temperature')) {
      const t = event.data;
      if (t.temp > 26) ctx.sendEvent('home:cooling', { room: t.room });
    } else if (event.name.endsWith(':home:cooling')) {
      const c = event.data;
      const devices = ctx.array('devices');
      const idx = devices.findIndex((d) => d.room === c.room);
      if (idx >= 0) ctx.array('devices')[idx] = { room: c.room, cooling: true };
      else ctx.array('devices').push({ room: c.room, cooling: true });
    }
  },
};