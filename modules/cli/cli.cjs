/**
 * CLI 模块（可选模块）：一个终端界面，走【信息直达】通道。
 * 它做的事只有两件：把命令用 sendTo 直接发给核心；核心把结果直接回传，onMessage 收到后打印。
 * 外加一个自己读日志文件的 grep 小功能。
 *
 * 信息直达（不走公共数组）：
 *  - 发送：ctx.sendTo('core', { cmd, args })        —— 直接发给核心执行
 *  - 接收：onMessage(ctx, message)                   —— 核心直接把结果回传（message.data = { cmd, ok, result, error }）
 * 任何模块用同样的接口调核心都不互相污染：结果只投递给发起方自己（source = 谁发的就回给谁）。
 */
const readline = require('readline');
const fs = require('fs');
const path = require('path');

let rl = null;

/** 提交指令：直接用信息直达发给核心（无事件名、无公共数组）。返回送达与否由调用方忽略。 */
function ask(ctx, cmd, args) {
  ctx.sendTo('core', { cmd, args: args || {} }).catch(() => {});
}

/** JSON 参数解析：能解析就用 JSON，否则当作原始字符串。 */
function parseArg(s) {
  if (s === undefined) return undefined;
  try { return JSON.parse(s); } catch { return s; }
}

/** 日志时间线单行格式化（cli 端小功能，读文件用；与核心 logFormat.ts 同款展示）。 */
function fmt(e) {
  const t = String(e.t || '').slice(11, 23);
  let line = t + ' [' + e.type + '] ' + e.source + ': ' + e.message;
  const extra = [];
  if (e.event !== undefined && e.type !== 'event' && e.type !== 'event-drop') extra.push('event=' + e.event);
  if (Array.isArray(e.recipients) && e.recipients.length) extra.push('转发=' + e.recipients.join(','));
  if (e.data !== undefined) {
    // 展示层缩短：文件里是完整内容，终端上只为可读性截断（与核心 formatLogEntry 同规则）
    let s = JSON.stringify(e.data);
    if (s.length > 2048) s = s.slice(0, 2048) + '…[截断显示，原始 ' + s.length + ' 字符]';
    extra.push('data=' + s);
  }
  if (e.reason !== undefined) extra.push('reason=' + e.reason);
  if (e.error !== undefined) extra.push('error=' + String(e.error));
  if (Array.isArray(e.removedArrays) && e.removedArrays.length) extra.push('清理数组=' + e.removedArrays.join(','));
  return extra.length ? line + '  [' + extra.join('  ') + ']' : line;
}

function logFileOf(ctx) {
  const cfg = (ctx.config && ctx.config.config) || {};
  return path.resolve(__dirname, cfg.logFile || '../../logs/event-stream.log');
}

/** 列出基础路径下的全部轮转日志文件（<基础名>.<日期>.<序号>.log），按时间顺序排列。 */
function logFilesOf(baseFile) {
  const dir = path.dirname(baseFile);
  const ext = path.extname(baseFile);
  const base = path.basename(baseFile, ext);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^' + esc(base) + '\\.(\\d{4}-\\d{2}-\\d{2})\\.(\\d{3})' + esc(ext) + '$');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => re.test(n)).sort().map((n) => path.join(dir, n));
}

/** 小功能：自己读日志文件按关键字 grep / 尾部截断。核心不参与。轮转文件按序合并。 */
function showLog(ctx, pattern, count) {
  setTimeout(() => {
    const baseFile = logFileOf(ctx);
    const files = logFilesOf(baseFile);
    if (!files.length) {
      console.log('日志文件不存在: ' + baseFile);
    } else {
      const lines = [];
      for (const f of files) {
        for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) if (l) lines.push(l);
      }
      let entries = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      if (pattern) {
        entries = entries.filter((e) => String(e.type).includes(pattern) || String(e.source).includes(pattern) || String(e.message).includes(pattern));
      }
      const tail = count > 0 ? entries.slice(-count) : entries;
      for (const e of tail) console.log(fmt(e));
      console.log('(时间线共 ' + entries.length + ' 条匹配' + (count > 0 ? '，显示最后 ' + tail.length + ' 条' : '') + ')');
    }
    if (rl) rl.prompt(); // 异步读文件的输出打完后重新出示提示符
  }, 30);
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
    '  print                        输出测试文本',
    '  help / exit / quit',
  ].join('\n');
}

/** 指令分发：只整理参数直接发给核心（信息直达），结果异步回来后 onMessage 展示。 */
function run(ctx, line) {
  const parts = line.split(/\s+/);
  const cmd = parts[0];
  switch (cmd) {
    case 'event': {
      const name = parts[1];
      if (!name) return console.log('用法: event <名称> [JSON]');
      ask(ctx, 'event', { name, data: parseArg(parts[2]) });
      console.log('→ 已提交 event ' + name);
      break;
    }
    case 'start': {
      const name = parts[1];
      if (!name) return console.log('用法: start <模块>');
      ask(ctx, 'start', { module: name });
      console.log('→ 已提交 start ' + name);
      break;
    }
    case 'stop': {
      const name = parts[1];
      if (!name) return console.log('用法: stop <模块>');
      ask(ctx, 'stop', { module: name });
      console.log('→ 已提交 stop ' + name);
      break;
    }
    case 'send': {
      const targets = parts[1];
      const name = parts[2];
      if (!targets || !name) return console.log('用法: send <目标|*> <名称> [JSON]');
      ask(ctx, 'send', {
        targets: targets === '*' ? '*' : targets.split(',').map((s) => s.trim()).filter(Boolean),
        name,
        data: parseArg(parts[3]),
      });
      console.log('→ 已提交 send ' + name + ' -> ' + targets);
      break;
    }
    case 'state':
      ask(ctx, 'state', {});
      console.log('→ 已提交 state');
      break;
    case 'log':
      showLog(ctx, parts[1] || null, parts[2] ? parseInt(parts[2], 10) : 0);
      break;
    case 'print':
      console.log('Hello World!'); // 小彩蛋：本地指令，不经过核心
      break;
    case 'help':
      console.log(helpText());
      break;
    case 'exit':
    case 'quit':
      console.log('正在关闭核心...');
      ask(ctx, 'exit', {});
      break;
    default:
      console.log('未知指令: ' + cmd + ' （输入 help 查看帮助）');
  }
}

module.exports = {
  name: 'cli',
  async start(ctx) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on('line', (line) => {
      if (!line.trim()) { rl.prompt(); return; }
      run(ctx, line.trim());
      rl.prompt();
    });
    rl.on('close', () => process.exit(0)); // 管道 EOF / Ctrl+C 直接结束
    // 首个提示符延到本轮事件循环末尾：先让核心启动横幅（connect-core.ts 在 core.start() 之后打印）
    // 全部打完，> 提示符才出现在最下面——否则会被横幅挤到上面，一进去看不到箭头。
    setImmediate(() => rl.prompt());
  },
  // 信息直达接收端：核心把指令结果直接回传到这里（message.data = { cmd, ok, result, error }）
  onMessage(ctx, message) {
    const r = (message && message.data) || {};
    if (!r.cmd) return;
    if (!r.ok) {
      console.log('✖ ' + (r.error || '执行失败'));
    } else if (r.cmd === 'state') {
      const s = r.result || {};
      const modules = s.modules || [];
      const arrays = s.arrays || [];
      console.log('--- 核心状态 ---');
      for (const m of modules) {
        console.log('  模块 ' + m.name + '  [' + m.status + ']' + (m.error ? '  error=' + m.error : ''));
      }
      if (!arrays.length) {
        console.log('  (无公共数组)');
      } else {
        for (const name of arrays) {
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
    } else if (r.cmd === 'exit') {
      // 核心正在关闭；stop() 里负责退出进程
    } else {
      console.log('✔ ' + JSON.stringify(r.result));
    }
    // 异步回复打完后重新出示提示符，提示符保持显示
    if (rl) rl.prompt();
  },
  async stop(ctx) {
    if (rl) rl.close();
    // 等核心把最后的日志写完再退（exit 与 Ctrl+C 都会走到这里）
    setTimeout(() => process.exit(0), 50);
  },
};
