let timer = null;
module.exports = {
  name: 'clock',
  start(ctx) {
    const ms = (ctx.config.config && ctx.config.config.intervalMs) || 250;
    timer = setInterval(() => { ctx.sendEvent('tick', { t: Date.now() }).catch(() => {}); }, ms);
  },
  onEvent() {},
  stop() { if (timer) clearInterval(timer); timer = null; },
};
