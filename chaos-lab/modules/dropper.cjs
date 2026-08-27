let n = 0;
function deep(k) { return k <= 0 ? 0 : 1 + deep(k - 1); }
module.exports = {
  name: 'dropper',
  start() {},
  onEvent(ctx, ev) {
    if (ev.name !== 'tick' || ++n % 5 !== 0) return;
    try {
      deep(150000); // 同步深递归 → RangeError: Maximum call stack size exceeded
    } catch (e) {
      // 吞掉？不——偶尔让异常裸抛给内核，测 deliverTo 的隔离
      if (n % 10 === 0) throw e;
    }
  },
  stop() {},
};
