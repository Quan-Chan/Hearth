let hops = 0;
module.exports = {
  name: 'ping-a',
  start(ctx) { setTimeout(() => ctx.sendEvent('loop:a', { n: 0 }).catch(() => {}), 50); },
  onEvent(ctx, ev) {
    hops++;
    if (hops % 10000 === 0) ctx.log('乒乓 A 已', hops, '跳');
    const d = 1 + Math.floor(Math.random() * 4);
    setTimeout(() => ctx.sendEvent('loop:b', { n: ev.data ? ev.data.n + 1 : 0 }).catch(() => {}), d);
  },
  stop() {},
};
