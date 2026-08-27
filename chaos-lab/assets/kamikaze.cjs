// 自毁模块：启动 2 秒后通过官方 CLI 协议命令核心 exit（不可预测的自我终止）
module.exports = {
  name: 'kamikaze',
  start(ctx) {
    setTimeout(() => {
      ctx.log('执行自毁指令：请求核心退出');
      ctx.sendTo('core', { cmd: 'exit' }).catch(() => {});
    }, 2000).unref?.();
  },
  onEvent() {},
  stop() {},
};
