// 变形者A：与B争夺同一个模块名
let ticks = 0;
module.exports = {
  name: 'shapeshifter',
  start(ctx) { ctx.log('形态A上线'); },
  onEvent(ctx, ev) { if (ev.name === 'tick' && ++ticks % 50 === 0) ctx.log('A形态 tick x' + ticks); },
  stop() {},
};
