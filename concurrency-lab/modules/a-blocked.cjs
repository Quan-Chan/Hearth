let gate = null;
let openGate = null;
module.exports = {
  name: 'a-blocked',
  start(ctx) { ctx.exposeArray('a-status', [false, 0]); },
  onEvent(ctx, ev) {
    if (ev.name !== 'request') return;
    if (!gate) gate = new Promise(function (r) { openGate = r; });
    // 在事件处理里直接等信息——这就是要验证的"模块等待信息"形态
    return gate.then(function () {
      const st = ctx.array('a-status'); st[0] = true; st[1] = Date.now();
      ctx.log('等待的信息已到达，处理完成');
    });
  },
  onMessage(ctx, msg) {
    if (msg.data && msg.data.info && openGate) openGate(); // 信息到达，开门
  },
  stop() {},
};
