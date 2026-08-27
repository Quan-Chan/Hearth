let seen = 0;
let explosions = 0;
module.exports = {
  name: 'sponge',
  start(ctx) { ctx.exposeArray('sponge-stats', [0]); },
  onEvent(ctx, ev) {
    seen++;
    ctx.array('sponge-stats')[0] = seen;
    if (seen % 20000 === 0) ctx.log('海绵已吸收', seen, '个事件');
    if (seen % 7000 === 0) {
      explosions++;
      throw new Error('海绵周期性自爆 #' + explosions + '（第 ' + seen + ' 个事件处）');
    }
  },
  stop() {},
};
