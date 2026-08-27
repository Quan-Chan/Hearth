let used = false;
module.exports = {
  name: 'e-freezer',
  start() {},
  onEvent(ctx, ev) {
    if (ev.name !== 'freeze' || used) return;
    used = true;
    const end = Date.now() + 3000; // 同步占用线程 3 秒：整个进程此刻谁也动不了
    while (Date.now() < end) { /* 忙等 */ }
  },
  stop() {},
};
