// 心跳模块：每 300ms 发一次 hb:tick 事件，记录实际间隔 —— 用来证明核心事件循环是否被阻塞
module.exports = {
  name: 'heartbeat',
  start(ctx) {
    ctx.exposeArray('hb:ticks', []);
    let last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const dt = now - last;
      last = now;
      ctx.sendEvent('hb:tick', { at: now, dt });
    }, 300);
    ctx.log('心跳启动（每 300ms 一跳）');
  },
  onEvent(ctx, event) {
    if (event.name !== 'hb:tick') return;
    ctx.array('hb:ticks').push(event.data);
    if (ctx.array('hb:ticks').length > 200) ctx.array('hb:ticks').shift();
  },
  stop() {
    if (this.timer) clearInterval(this.timer);
  },
};
