// 任务网关（核心侧胶水层）：把重计算任务"卸载"到外部进程
//  任务  -> work/tasks/xxx.json （写文件，立即回执，核心不计算、不阻塞）
//  结果  <- work/results/xxx.json （轮询拉回，转为 task:done 事件）
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'task-gateway',
  start(ctx) {
    const workDir = path.resolve(__dirname, '../work');
    this.tasksDir = path.join(workDir, 'tasks');
    this.resultsDir = path.join(workDir, 'results');
    fs.mkdirSync(this.tasksDir, { recursive: true });
    fs.mkdirSync(this.resultsDir, { recursive: true });
    this.timer = null;
    this.busy = false;
    ctx.log('任务网关就绪：任务写 ' + this.tasksDir + '，结果拉 ' + this.resultsDir);
    // 轮询结果目录：拉回结果 -> 发 task:done 事件
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      let files = [];
      try {
        files = fs.readdirSync(this.resultsDir).filter((f) => f.endsWith('.json'));
      } catch {
        this.busy = false;
        return;
      }
      void (async () => {
        for (const f of files) {
          try {
            const res = JSON.parse(fs.readFileSync(path.join(this.resultsDir, f), 'utf8'));
            fs.rmSync(path.join(this.resultsDir, f));
            await ctx.sendEvent('task:done', res);
            ctx.log('拉回结果: ' + f + ' -> task:done');
          } catch (e) {
            ctx.log('结果处理失败: ' + f + '（' + e.message + '）');
          }
        }
        this.busy = false;
      })();
    }, 200);
  },
  onEvent(ctx, event) {
    if (event.name !== 'task:compute') return;
    const t = event.data;
    // 只写文件，不计算 —— 立即回执，核心零负担
    fs.writeFileSync(
      path.join(this.tasksDir, 't-' + t.id + '.json'),
      JSON.stringify({ id: t.id, n: t.n, submittedAt: Date.now() }),
    );
    ctx.log('任务已卸载给外部进程: ' + t.id + '（n=' + t.n + '）');
  },
  stop() {
    if (this.timer) clearInterval(this.timer);
  },
};
