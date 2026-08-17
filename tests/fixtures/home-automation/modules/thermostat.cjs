// 温控器：温度超过阈值发出制冷事件，维护设备状态
module.exports = {
  name: 'thermostat',
  start(ctx) {
    ctx.exposeArray('home:devices', [{ room: 'living', cooling: false }]);
  },
  onEvent(ctx, event) {
    if (event.name === 'home:temperature') {
      const t = event.data;
      if (t.temp > 26) ctx.sendEvent('home:cooling', { room: t.room });
    } else if (event.name === 'home:cooling') {
      const c = event.data;
      const devices = ctx.array('home:devices');
      const idx = devices.findIndex((d) => d.room === c.room);
      if (idx >= 0) ctx.array('home:devices')[idx] = { room: c.room, cooling: true };
      else ctx.array('home:devices').push({ room: c.room, cooling: true });
    }
  },
};