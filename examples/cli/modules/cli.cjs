/**
 * CLI 模块（可选模块）：把核心变成命令行可操作的软件。
 *
 * 与核心的联动关系（没有它就不可用）：
 *  - 所有指令以事件形式发给核心的 CLI 命令面（core:cli:*），由核心拦截执行；
 *  - 核心的回复（core:cli:reply-state）是普通事件，本模块通过 YAML listen 接收；
 *  - 启动时先发一条 core:cli:state 自检，收不到回复则 CLI 不可用并退出。
 *
 * 设计原则（核心保持极简，高级功能都在本模块）：
 *  - 查看日志：直接读日志文件（JSONL）自行 grep / 截断 / 时间线，核心不参与；
 *  - 查看状态：核心只回模块/数组的"名字与状态"，实际数组内容由本模块 ctx.array() 自己拉。
 *
 * 指令：
 *   event <名称> [JSON]           生成一个自定义事件
 *   start <模块>                  开启模块（即使没有事件）
 *   stop <模块>                   关闭模块
 *   send <目标|*> <名称> [JSON]   定向发送事件（目标可逗号分隔，或 * 广播；无需对方监听）
 *   state                        查看模块与公共数组（内容由本模块自行拉取）
 *   log [过滤词] [条数]           查看日志时间线（grep + 尾部截断，读文件实现）
 *   help / exit
 */
const readline = require('readline');
const fs = require('fs');
const path = require('path');

let rl = null;
let linked = false; // 与核心命令面联动是否成功
let pendingPing = null;
let pingTimer = null;
let exiting = false;

/** 解析可选 JSON 参数：能解析成 JSON 就用 JSON，否则当作原始字符串。 */
function parseArg(s) {
  if (s === undefined) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** 时间线单行格式化（与核心 formatLogEntry 同风格，纯 CLI 端实现）。 */
function fmt(e) {
  const t = String(e.t || '').slice(11, 23);
  let line = t + ' [' + e.type + '] ' + e.source + ': ' + e.message;
  const extra = [];
  if (e.event !== undefined && e.type !== 'event' && e.type !== 'event-drop') extra.push('event=' + e.event);
  if (Array.isArray(e.recipients) && e.recipients.length) extra.push('转发=' + e.recipients.join(','));
  if (e.data !== undefined) extra.push('data=' + JSON.stringify(e.data));
  if (e.reason !== undefined) extra.push('reason=' + e.reason);
  if (e.error !== undefined) extra.push('error=' + String(e.error));
  if (Array.isArray(e.removedArrays) && e.removedArrays.length) extra.push('清理数组=' + e.removedArrays.join(','));
  return extra.length ? line + '  [' + extra.join('  ') + ']' : line;
}

function logFileOf(ctx) {
  const cfg = (ctx.config && ctx.config.config) || {};
  return path.resolve(__dirname, cfg.logFile || '../logs/event-stream.log');
}

function doExit(ctx) {
  if (exiting) return;
  exiting = true;
  // 优雅关闭：让核心停止（会先广播 core:shutdown、停模块、落盘并关闭日志流）
  ctx.sendEvent('core:cli:stop-core', {}).catch((err) => console.log('核心停止请求失败: ' + err.message));
  setTimeout(() => process.exit(0), 150);
}

function helpText() {
  return [
    '可用指令:',
    '  event <名称> [JSON]          生成一个自定义事件',
    '  start <模块>                 开启模块（即使没有事件）',
    '  stop <模块>                  关闭模块',
    '  send <目标|*> <名称> [JSON]  定向发送事件（目标=模块名，逗号分隔；* 广播）',
    '  state                        查看模块与公共数组',
    '  log [过滤词] [条数]          查看日志时间线（读文件 grep）',
    '  help / exit',
  ].join('\n');
}

/** 指令分发（全部走事件/数组，不直接翻核心内部）。 */
function runCommand(ctx, line) {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0];
  const record = { cmd: cmd, line: line.trim(), at: Date.now() };
  ctx.array('cli:response').push(record); // 开放响应通道：别的模块也能读到 CLI 干了什么

  const fail = (err) => console.log('✖ ' + (err && err.message ? err.message : String(err)));
  const fire = (name, data) => ctx.sendEvent(name, data).catch(fail);

  switch (cmd) {
    case 'event': {
      const name = parts[1];
      if (!name) return console.log('用法: event <名称> [JSON]');
      const data = parseArg(parts[2]);
      fire(name, data);
      console.log('→ 已生成事件: ' + name);
      break;
    }
    case 'start': {
      const name = parts[1];
      if (!name) return console.log('用法: start <模块>');
      fire('core:cli:start-module', { name: name });
      console.log('→ 已请求启动模块: ' + name);
      break;
    }
    case 'stop': {
      const name = parts[1];
      if (!name) return console.log('用法: stop <模块>');
      fire('core:cli:stop-module', { name: name });
      console.log('→ 已请求关闭模块: ' + name);
      break;
    }
    case 'send': {
      const targets = parts[1];
      const name = parts[2];
      if (!targets || !name) return console.log('用法: send <目标|*> <名称> [JSON]');
      const data = parseArg(parts[3]);
      fire('core:cli:send-event', { targets: targets === '*' ? '*' : targets.split(',').map((s) => s.trim()).filter(Boolean), name: name, data: data });
      console.log('→ 已请求定向发送 ' + name + ' -> ' + targets);
      break;
    }
    case 'state': {
      fire('core:cli:state', {});
      console.log('→ 正在查询核心状态...');
      break;
    }
    case 'log': {
      // 日志流是异步落盘的：给一个宏任务让缓冲区先刷出去，再读文件，避免漏掉刚发生的事件
      setTimeout(() => {
        const file = logFileOf(ctx);
        if (!fs.existsSync(file)) return console.log('日志文件不存在: ' + file);
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
        const pattern = parts[1] || null;
        const count = parts[2] ? parseInt(parts[2], 10) : 0;
        let entries = lines.map((l) => {
          try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);
        if (pattern) {
          entries = entries.filter((e) => String(e.type).includes(pattern) || String(e.source).includes(pattern) || String(e.message).includes(pattern));
        }
        const tail = count > 0 ? entries.slice(-count) : entries;
        for (const e of tail) console.log(fmt(e));
        console.log('(时间线共 ' + entries.length + ' 条匹配' + (count > 0 ? '，显示最后 ' + tail.length + ' 条' : '') + ')');
      }, 30);
      break;
    }
    case 'help':
      console.log(helpText());
      break;
    case 'exit':
    case 'quit':
      console.log('正在关闭核心...');
      doExit(ctx);
      break;
    default:
      console.log('未知指令: ' + cmd + ' （输入 help 查看帮助）');
  }
}

module.exports = {
  name: 'cli',
  async start(ctx) {
    ctx.exposeArray('cli:response', []); // 响应模式(b)：公开数组，别的模块可读 CLI 的活动
    ctx.log('CLI 模块启动，正在与核心建立联动...');

    rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    // 联动自检：能收到 core:cli:reply-state 回复，说明核心支持 CLI 命令面
    pingTimer = setTimeout(() => {
      if (linked) return;
      console.log('✖ 核心未响应 CLI 命令面（core:cli:*），CLI 不可用。请确认核心已集成 CLI 支持。');
      ctx.log('核心未响应 CLI 命令面，CLI 不可用');
      if (rl) rl.close();
    }, 2000);
    ctx.sendEvent('core:cli:state', {}).catch((err) => console.log('联动自检失败: ' + err.message));

    rl.on('line', (line) => {
      if (!line.trim()) { rl.prompt(); return; }
      runCommand(ctx, line);
      rl.prompt();
    });
    rl.on('SIGINT', () => {
      console.log('(Ctrl+C 再按一次可退出，或输入 exit)');
      rl.prompt();
    });
    rl.on('close', () => {
      console.log('CLI 会话结束');
      if (!process.stdin.isTTY && !exiting) doExit(ctx); // 管道输入 EOF（冒烟/脚本用）自动优雅退出
    });
    rl.prompt();
  },
  async onEvent(ctx, event) {
    if (event.name !== 'core:cli:reply-state') return;
    if (!linked) {
      linked = true;
      if (pingTimer) clearTimeout(pingTimer);
      console.log('☑ CLI 已与核心联动（core:cli:* 命令面可用）。输入 help 查看指令。');
    }
    const d = event.data || {};
    const modules = d.modules || [];
    const arrays = d.arrays || [];
    console.log('--- 核心状态 ---');
    for (const m of modules) {
      console.log('  模块 ' + m.name + '  [' + m.status + ']' + (m.error ? '  error=' + m.error : ''));
    }
    if (arrays.length === 0) {
      console.log('  (无公共数组)');
    } else {
      for (const name of arrays) {
        // 响应模式(b)：实际内容不进事件，由 CLI 自己拉公开数组
        let items;
        try {
          const arr = ctx.array(name);
          items = arr.length > 5 ? JSON.stringify(arr.slice(0, 5)) + ' ... 共 ' + arr.length + ' 项' : JSON.stringify(arr);
        } catch (err) {
          items = '(拉取失败)';
        }
        console.log('  数组 ' + name + ' = ' + items);
      }
    }
    ctx.log('CLI 查询核心状态完成');
  },
  async stop() {
    if (rl) rl.close();
  },
};
