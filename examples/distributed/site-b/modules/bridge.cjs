// ============================================================
// bridge.cjs —— 分布式胶水层（配置驱动，通用）
// 作用：让 Connect-Core 获得"跨进程/跨机器"能力，业务模块无感。
//   forward: 本地事件 -> POST 到远端（远端桥接模块注入本地事件总线）
//   mirror : 定期拉取远端数组 -> 全量镜像到本地数组（远端数据本地可见）
// 配置示例（YAML config 段）：
//   config:
//     remote: http://127.0.0.1:3082
//     pollMs: 1000
//     forward:
//       - local: "order:sync"
//         to: "order:sync"
//     mirror:
//       - local: "mirror:remote-done"
//         remote: "orders:done"
// ============================================================
module.exports = {
  name: 'bridge',
  start(ctx) {
    const cfg = ctx.config.config || {};
    this.remote = cfg.remote || 'http://127.0.0.1:3081';
    this.pollMs = cfg.pollMs || 1000;
    this.forward = cfg.forward || [];
    this.mirror = cfg.mirror || [];
    this.timer = null;
    // 先公开镜像数组
    for (const m of this.mirror) {
      ctx.exposeArray(m.local, []);
    }
    ctx.log('胶水层就绪，远端=' + this.remote + '，转发 ' + this.forward.length + ' 项，镜像 ' + this.mirror.length + ' 项');
    // 定期拉取远端数组 -> 镜像到本地
    this.timer = setInterval(async () => {
      for (const m of this.mirror) {
        try {
          const res = await fetch(this.remote + '/api/array?name=' + encodeURIComponent(m.remote));
          if (!res.ok) continue;
          const items = await res.json();
          const arr = ctx.array(m.local);
          arr.length = 0;
          arr.push(...items);
        } catch (e) {
          /* 远端暂不可达，跳过本轮 */
        }
      }
    }, this.pollMs);
  },
  async onEvent(ctx, event) {
    // 本地事件 -> 转发到远端
    for (const f of this.forward) {
      if (event.name !== f.local) continue;
      try {
        await fetch(this.remote + '/api/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: f.to || f.local, data: event.data }),
        });
        ctx.log('转发事件 ' + event.name + ' -> ' + this.remote);
      } catch (e) {
        ctx.log('转发失败: ' + e.message);
      }
    }
  },
  stop() {
    if (this.timer) clearInterval(this.timer);
  },
};
