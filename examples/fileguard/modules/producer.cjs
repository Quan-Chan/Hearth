// 库存模块（核心侧业务）：维护库存数组，处理库存事件
module.exports = {
  name: 'producer',
  start(ctx) {
    ctx.exposeArray('inventory:items', [
      { sku: 'SWORD-01', name: '铁剑', qty: 10 },
      { sku: 'SHIELD-01', name: '木盾', qty: 8 },
    ]);
    ctx.log('库存模块就绪');
  },
  onEvent(ctx, event) {
    if (event.name === 'stock:add') {
      const items = ctx.array('inventory:items');
      const found = items.find((i) => i.sku === event.data.sku);
      if (found) found.qty += Number(event.data.qty) || 1;
      else items.push({ sku: event.data.sku, name: event.data.name || event.data.sku, qty: Number(event.data.qty) || 1 });
      ctx.log('入库: ' + event.data.sku + ' +' + (Number(event.data.qty) || 1));
    } else if (event.name === 'stock:clear') {
      ctx.array('inventory:items').length = 0;
      ctx.log('库存已清空');
    }
  },
};
