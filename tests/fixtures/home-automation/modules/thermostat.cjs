// 温控器：温度超过阈值发出制冷事件，维护设备状态
module.exports = {
  name: 'thermostat',
  start(ctx) {
    ctx.exposeObject('devices', { items: [{ room: 'living', cooling: false }] });
  },
  onEvent(ctx, event) {
    if (event.name.endsWith(':home:temperature')) {
      const t = event.data;
      if (t.temp > 26) ctx.sendEvent('home:cooling', { room: t.room });
    } else if (event.name.endsWith(':home:cooling')) {
      const c = event.data;
      const devices = ctx.object('devices').items;
      const idx = devices.findIndex((d) => d.room === c.room);
      if (idx >= 0) ctx.object('devices').items[idx] = { room: c.room, cooling: true };
      else ctx.object('devices').items.push({ room: c.room, cooling: true });
    }
  },
};