const fs = require('fs');
const path = require('path');
const YAML_PATH = path.join(__dirname, 'phoenix.yaml');
let gen = 0;
let rewrites = 0;
let timer = null;
function rewrite(self) {
  rewrites++;
  gen++;
  const disable = rewrites % 6 === 0; // 每6次自禁用一次，下次重写再复活
  const text = 'name: phoenix\nfile: ./phoenix.cjs\nstartEvents:\n  - "core:startup"\n  - "tick"\nenabled: ' + (disable ? 'false' : 'true') + '\nconfig:\n  generation: ' + gen + '\n';
  const tmp = YAML_PATH + '.tmp' + Math.random().toString(36).slice(2, 6);
  try {
    if (rewrites % 5 === 0) {
      fs.writeFileSync(YAML_PATH, text); // 直接覆盖：制造半写入窗口
    } else {
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, YAML_PATH); // 整文件替换
    }
  } catch (e) { /* 文件系统干扰失败无所谓 */ }
}
module.exports = {
  name: 'phoenix',
  start(ctx) {
    gen = (ctx.config.config && ctx.config.config.generation) || 0;
    if (Math.random() < 0.3) throw new Error('凤凰第 ' + gen + ' 代孵化失败（30%概率自爆）');
    ctx.log('凤凰第', gen, '代上线');
    timer = setInterval(() => rewrite(), 2000);
  },
  onEvent(ctx, ev) {
    if (ev.name === 'tick' && Math.random() < 0.02) throw new Error('凤凰事件处理自爆');
  },
  stop() { if (timer) clearInterval(timer); timer = null; },
};
