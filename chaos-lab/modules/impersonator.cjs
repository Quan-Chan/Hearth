const T0 = Date.now();
let n = 0;
let timer = null;
const WEIRD = ['', '**', '?*', 'a?b*c', '\n\tweird', 'core-event-热点', 'core:startup', 'core:shutdown', 'cli:request', 'x'.repeat(50000)];
module.exports = {
  name: 'impersonator',
  start() {},
  onEvent(ctx, ev) {
    if (ev.name !== 'tick') return;
    n++;
    const name = WEIRD[n % WEIRD.length];
    (async () => {
      try { await ctx.sendEvent(name, { fake: true }); } catch (e) { }
    })();
    if (Date.now() - T0 > 45000 && n % 4 === 0) {
      const cmds = [
        { cmd: 'stop', args: { module: Math.random() < 0.5 ? 'duelist-a' : 'duelist-b' } },
        { cmd: 'start', args: { module: Math.random() < 0.5 ? 'duelist-a' : 'duelist-b' } },
        { cmd: 'state', args: {} },
        { cmd: 'no-such-cmd', args: { x: 1 } },
        { cmd: 'event', args: { name: 'impersonated:' + n, data: { via: 'cli' } } },
      ];
      const c = cmds[n % cmds.length];
      ctx.sendTo('core', c).catch(function () {});
    }
  },
  stop() { if (timer) clearInterval(timer); timer = null; },
};
