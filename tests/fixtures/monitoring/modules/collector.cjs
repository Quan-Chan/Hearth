// 指标采集器：维护最新指标（按名称去重）
module.exports = {
  name: 'collector',
  start(ctx) {
    ctx.exposeArray('metrics:latest', []);
  },
  onEvent(ctx, event) {
    if (event.name !== 'app:metric') return;
    const m = event.data;
    const latest = ctx.pullArray('metrics:latest');
    const idx = latest.findIndex((x) => x.name === m.name);
    if (idx >= 0) {
      // 同名指标：更新（set 覆盖）
      ctx.editArray('metrics:latest', { type: 'set', index: idx, value: { name: m.name, value: m.value, at: Date.now() } });
    } else {
      ctx.editArray('metrics:latest', { type: 'push', value: { name: m.name, value: m.value, at: Date.now() } });
    }
  },
};
