module.exports = {
  name: 'b-after',
  start(ctx) { ctx.exposeArray('b-status', [0, 0]); },
  onEvent(ctx, ev) {
    if (ev.name !== 'request') return;
    const st = ctx.array('b-status');
    st[0] += 1;
    st[1] = Date.now(); // 记录收到时刻，用于判定是否被前座拖延
  },
  stop() {},
};
