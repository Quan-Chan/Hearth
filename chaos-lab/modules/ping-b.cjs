let hops = 0;
module.exports = {
  name: 'ping-b',
  start() {},
  onEvent(ctx, ev) {
    hops++;
    if (hops % 10000 === 0) ctx.log('乒乓 B 已', hops, '跳');
    const d = 1 + Math.floor(Math.random() * 4);
    setTimeout(() => ctx.sendEvent('loop:a', { n: ev.data ? ev.data.n + 1 : 0 }).catch(() => {}), d);
  },
  stop() {},
};
