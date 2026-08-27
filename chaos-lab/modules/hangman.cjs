module.exports = {
  name: 'hangman',
  start() { return new Promise(() => {}); }, // 永不 resolve：核心的 startModule 将永久悬挂
  onEvent() {},
  stop() {},
};
