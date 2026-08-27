let stats = { grab: 0, miss: 0, conflict: 0, poison: 0 };
let timer = null;
module.exports = {
  name: 'vulture',
  start(ctx) { ctx.exposeArray('vulture-stats', [stats]); },
  onEvent(ctx, ev) {
    if (ev.name !== 'tick') return;
    // 踩空：拉不存在的数组
    try { ctx.array('nonexistent-' + Math.random()); } catch (e) { stats.miss++; }
    // 抢名：试图公开别人已占用的名字
    try { ctx.exposeArray('shared-feed', ['劫持']); } catch (e) { stats.conflict++; }
    // 抓取+污染：在 glutton 翻新数组的竞态窗口里反复尝试
    let round = 0;
    const iv = setInterval(() => {
      try {
        const arr = ctx.array('shared-feed');
        stats.grab++;
        if (arr.length > 0) { arr[arr.length - 1] = '被秃鹫污染'; stats.poison++; }
        else arr.push('秃鹫投毒');
      } catch (e) { /* 数组恰好被翻新掉 */ }
      if (++round >= 8) clearInterval(iv);
    }, 25);
  },
  stop(ctx) { if (timer) clearInterval(timer); },
};
