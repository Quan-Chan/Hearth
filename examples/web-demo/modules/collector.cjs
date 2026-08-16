// 采集器：core:startup 启动，公开数据数组，接收产生/清空事件
module.exports = {
  name: 'collector',
  start(ctx) {
    ctx.exposeArray('data:store', []);
    ctx.log('采集器就绪');
  },
  onEvent(ctx, event) {
    if (event.name === 'app:produce') {
      // 原生数组语法，直接 push
      ctx.array('data:store').push(event.data);
    } else if (event.name === 'app:clear') {
      ctx.array('data:store').length = 0;
      ctx.log('数据已清空');
    }
  },
};
