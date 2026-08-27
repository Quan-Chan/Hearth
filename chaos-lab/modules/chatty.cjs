let burst = 0;
let timer = null;
module.exports = {
  name: 'chatty',
  start(ctx) {
    timer = setInterval(() => {
      burst++;
      for (let i = 0; i < 40; i++) {
        // 每条事件名都独一无二：持续喂大核心的 occurred 历史
        ctx.sendEvent('noise:' + burst + ':' + i + ':' + Math.random().toString(36).slice(2, 8),
          { pad: 'x'.repeat(2048) }).catch(() => {});
      }
      if (burst % 30 === 0) {
        ctx.sendEvent('noise:monster:' + burst, { pad: 'y'.repeat(512 * 1024) }).catch(() => {});
      }
    }, 500);
  },
  onEvent() {},
  stop() { if (timer) clearInterval(timer); timer = null; },
};
