let wins = 0;
let fails = 0;
module.exports = {
  name: 'duelist-a',
  start(ctx) {
    try { ctx.exposeArray('throne-a', [0]); } catch (e) { }
    try { ctx.exposeArray('throne', ['a init']); } catch (e) { }
  },
  onEvent(ctx, ev) {
    if (ev.name !== 'tick') return;
    try {
      ctx.exposeArray('throne', ['a coup #' + (++wins)]);
    } catch (e) {
      fails++;
      try { ctx.unexposeArray('throne'); } catch (e2) { }
      try { const t = ctx.array('throne'); t.push('a taunt'); } catch (e3) { }
    }
    try { ctx.array('throne-a')[0] = wins * 100000 + fails; } catch (e4) { }
  },
  stop() {},
};
