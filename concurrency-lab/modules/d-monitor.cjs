module.exports = {
  name: 'd-monitor',
  start(ctx) { ctx.exposeArray('d-status', [0, 0]); },
  onEvent(ctx, ev) {
    if (ev.name !== 'beat') return;
    const st = ctx.array('d-status');
    st[0] += 1;
    st[1] = Date.now();
  },
  stop() {},
};
