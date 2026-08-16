// 通知器：基于 alarm:fired 事件出现才被核心唤起启动
// 从 alarm 的数组拿数据，记录告警历史
module.exports = {
  name: 'notifier',
  start(ctx) {
    ctx.exposeArray('alarm:history', []);
    ctx.log('通知器启动（由 alarm:fired 事件唤起）');
  },
  onEvent(ctx, event) {
    if (event.name !== 'alarm:fired') return;
    // 去另一个模块（alarm）的数组里拿数据
    const active = ctx.array('alarm:active');
    const last = active[active.length - 1];
    if (!last) return;
    ctx.array('alarm:history').push({ msg: last.msg, max: last.max, notifiedAt: Date.now() });
    ctx.log('发送通知: ' + last.msg);
  },
};
