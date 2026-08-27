let t1 = null;
let t2 = null;
module.exports = {
  name: 'pulse',
  start(ctx) {
    t1 = setInterval(function () { ctx.sendEvent('beat').catch(function () {}); }, 300);
    t2 = setInterval(function () { ctx.sendEvent('job', { n: Date.now() }).catch(function () {}); }, 600);
  },
  onEvent() {},
  stop() { clearInterval(t1); clearInterval(t2); },
};
