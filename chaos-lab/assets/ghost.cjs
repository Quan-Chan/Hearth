// 幽灵模块：被破坏者批量投放/回收，稀释监听池
let n = 0;
module.exports = {
  name: 'ghost',
  start(ctx) { n = 0; },
  onEvent(ctx, ev) { n++; if (n % 5000 === 0) ctx.log('ghost 已处理', n); },
  stop() {},
};
