// 回声模块：core:startup 启动，echo 事件转成 greet 事件（模块链式协作）
module.exports = {
  name: 'echo',
  onEvent(ctx, event) {
    if (event.name !== 'echo') return;
    ctx.sendEvent('greet', { name: event.data.text });
  },
};
