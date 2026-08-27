const CAP = 30000;
let session = 0;
function play(ctx, n) {
  if (n >= CAP) {
    session++;
    setTimeout(() => {
      ctx.sendTo('ghost-module-' + Math.floor(Math.random() * 100), { stray: true }).catch(() => {});
      ctx.sendTo('core', { cmd: 'bogus-cmd-' + session, args: {} }).catch(() => {});
      play(ctx, 0);
    }, 500);
    return;
  }
  setImmediate(() => ctx.sendTo('nester', { ping: n + 1 }).catch(() => {}));
}
module.exports = {
  name: 'echo-client',
  start(ctx) { setTimeout(() => play(ctx, 0), 80); },
  onMessage(ctx, msg) {
    const n = msg.data && msg.data.pong ? msg.data.pong : 0;
    play(ctx, n);
  },
  onEvent() {},
  stop() {},
};
