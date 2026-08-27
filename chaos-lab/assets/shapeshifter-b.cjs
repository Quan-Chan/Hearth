// 变形者B：与A争夺同一个模块名，且一半时间在事件里自爆
let ticks = 0;
module.exports = {
  name: 'shapeshifter',
  start(ctx) { ctx.log('形态B上线'); },
  onEvent(ctx, ev) {
    if (ev.name !== 'tick') return;
    ticks++;
    if (ticks % 2 === 0) throw new Error('形态B自爆 x' + ticks);
    if (ticks % 50 === 1) ctx.log('B形态 tick x' + ticks);
  },
  stop() {},
};
