// 处理器：从 collector 的数组拿数据（跨模块），加工后写入自己的数组
module.exports = {
  name: 'processor',
  start(ctx) {
    ctx.exposeArray('data:processed', []);
    ctx.log('处理器就绪');
  },
  onEvent(ctx, event) {
    if (event.name !== 'app:produce') return;
    // ① 去另一个模块（collector）的数组里拿数据
    const store = ctx.array('data:store');
    const last = store[store.length - 1];
    if (!last) return;
    // ② 加工（值翻倍）后写入自己的数组
    const processed = { id: last.id, label: last.label + '×2', value: last.value * 2, processedAt: Date.now() };
    ctx.array('data:processed').push(processed);
    // ③ 发出处理完成事件，唤起下游模块
    ctx.sendEvent('app:processed', { id: last.id });
  },
};
