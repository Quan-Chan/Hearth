let i = 0;
let feed = [];
let timer = null;
let churnTimer = null;
module.exports = {
  name: 'glutton',
  start(ctx) {
    feed = [];
    ctx.exposeArray('shared-feed', feed);
    timer = setInterval(() => {
      for (let k = 0; k < 20; k++) { feed.push({ i: i++, t: Date.now() }); }
      if (feed.length > 60000) feed.splice(0, 30000); // 锯齿式增长，制造 GC 压力但不 OOM
    }, 5);
    churnTimer = setInterval(() => {
      // 快速 取消公开→重新公开 同名数组：与 vulture 的抓取形成竞态窗口
      let round = 0;
      const iv = setInterval(() => {
        try {
          ctx.unexposeArray('shared-feed');
          ctx.exposeArray('shared-feed', (feed = []));
        } catch (e) { /* 自己的数组不该失败，但别让定时器死掉 */ }
        if (++round >= 10) clearInterval(iv);
      }, 30);
    }, 4000);
  },
  onEvent() {},
  stop(ctx) { if (timer) clearInterval(timer); if (churnTimer) clearInterval(churnTimer); timer = null; churnTimer = null; },
};
