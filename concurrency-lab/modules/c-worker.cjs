module.exports = {
  name: 'c-worker',
  start(ctx) { ctx.exposeArray('c-status', [0, 0]); },
  onEvent(ctx, ev) {
    if (ev.name !== 'job') return;
    const st = ctx.array('c-status');
    st[0] += 1;
    st[1] = Date.now();
  },
  stop() {},
};
