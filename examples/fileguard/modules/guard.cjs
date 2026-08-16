// ============================================================
// guard.cjs —— 隔离胶水层（文件管道模式，不跑 HTTP）
// 职责：核心与"外部进程"之间唯一的通道，白名单校验 + 文件交换。
//   inbox   : 外部进程投放事件文件（{event, data} JSON）-> 校验后注入核心
//   outbox  : 核心定期把白名单数组导出为 JSONL，外部进程自己拉取
//   rejected: 越权/非法请求的存放处（并记 error 日志）
// 外部进程只能接触这三个目录，够不到核心内存与其他数据。
// ============================================================
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'guard',
  start(ctx) {
    const cfg = ctx.config.config || {};
    const workDir = path.resolve(__dirname, cfg.workDir || '../work');
    this.inbox = path.join(workDir, 'inbox');
    this.outbox = path.join(workDir, 'outbox');
    this.processed = path.join(workDir, 'processed');
    this.rejected = path.join(workDir, 'rejected');
    for (const d of [this.inbox, this.outbox, this.processed, this.rejected]) {
      fs.mkdirSync(d, { recursive: true });
    }
    this.allowEvents = cfg.allowEvents || [];
    this.exports = cfg.exports || [];
    this.pollMs = cfg.pollMs || 500;
    this.timer = null;
    this.busy = false;

    ctx.log(
      '守卫就绪 · 允许事件: ' + this.allowEvents.join(', ') +
      ' · 导出数组: ' + this.exports.map((e) => e.name).join(', ') +
      ' · 收件箱: ' + this.inbox,
    );

    // 周期任务：收件箱 -> 事件；数组 -> outbox
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      void this.pump(ctx).finally(() => {
        this.busy = false;
      });
    }, this.pollMs);
  },
  async pump(ctx) {
    // ① 收件箱：读取外部进程投放的事件文件
    let files = [];
    try {
      files = fs.readdirSync(this.inbox).filter((f) => f.endsWith('.json'));
    } catch {
      return;
    }
    for (const f of files) {
      const src = path.join(this.inbox, f);
      let req;
      try {
        req = JSON.parse(fs.readFileSync(src, 'utf8'));
      } catch (e) {
        fs.renameSync(src, path.join(this.rejected, f + '.badjson'));
        ctx.log('拒绝: ' + f + '（不是合法 JSON）');
        continue;
      }
      // 白名单校验：只允许特定事件
      if (!this.allowEvents.includes(req.event)) {
        fs.renameSync(src, path.join(this.rejected, f));
        ctx.log('拒绝越权事件: ' + req.event + '（不在白名单）');
        continue;
      }
      try {
        await ctx.sendEvent(req.event, req.data);
        fs.renameSync(src, path.join(this.processed, f));
        ctx.log('注入事件: ' + req.event + ' ← ' + f);
      } catch (e) {
        fs.renameSync(src, path.join(this.rejected, f));
        ctx.log('注入失败: ' + req.event + '（' + e.message + '）');
      }
    }
    // ② outbox：把白名单数组导出为 JSONL（外部进程自己拉）
    for (const exp of this.exports) {
      try {
        const items = ctx.array(exp.name);
        const file = path.join(this.outbox, exp.file || exp.name + '.jsonl');
        fs.writeFileSync(file, items.map((x) => JSON.stringify(x)).join('\n') + (items.length ? '\n' : ''));
      } catch (e) {
        ctx.log('导出失败: ' + exp.name + '（' + e.message + '）');
      }
    }
  },
  stop() {
    if (this.timer) clearInterval(this.timer);
  },
};
