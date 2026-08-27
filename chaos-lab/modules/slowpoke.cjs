module.exports = {
  name: 'slowpoke',
  start() {},
  onEvent() {},
  stop(ctx) { return new Promise(r => setTimeout(r, 3000)); },
};
