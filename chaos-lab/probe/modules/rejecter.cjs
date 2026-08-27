module.exports = {
  name: 'rejecter',
  start(ctx) {
    // 手雷1：游离的 Promise 拒绝（无任何 catch）
    setTimeout(function () { Promise.reject(new Error('detached-grenade')); }, 300);
    // 手雷2：对返回 rejected promise 的内核 API 不接 catch（cli:request 在无 cli 模块时必拒绝）
    setTimeout(function () { ctx.sendEvent('cli:request'); }, 600);
  },
  onEvent() {},
  stop() {},
};
