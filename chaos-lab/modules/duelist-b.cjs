let wins = 0;
let fails = 0;
module.exports = {
  name: 'duelist-b',
  start(ctx) {
    try { ctx.exposeArray('throne-b', [0]); } catch (e) { }
    try { ctx.exposeArray('throne', ['b init']); } catch (e) { }
  },
  onEvent(ctx, ev) {
    if (ev.name !== 'tick') return;
    try {
      ctx.exposeArray('throne', ['b coup #' + (++wins)]);
    } catch (e) {
      fails++;
      try { ctx.unexposeArray('throne'); } catch (e2) { }
      try { const t = ctx.array('throne'); t.push('b taunt'); } catch (e3) { }
    }
    try { ctx.array('throne-b')[0] = wins * 100000 + fails; } catch (e4) { }
  },
  stop() {},
};
