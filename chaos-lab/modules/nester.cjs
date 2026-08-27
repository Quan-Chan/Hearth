let served = 0;
module.exports = {
  name: 'nester',
  start() {},
  onMessage(ctx, msg) {
    served++;
    const n = msg.data && msg.data.ping ? msg.data.ping : 0;
    setImmediate(() => ctx.sendTo(msg.source, { pong: n + 1 }).catch(() => {}));
    if (served % 20000 === 0) ctx.log('回声服务已应答', served);
  },
  onEvent() {},
  stop() {},
};
