/**
 * CLI 模块（可选模块）：一个极简的终端界面。
 * 它做的事只有三件：把命令写进 cli:commands 数组、发 cli:request 门铃、
 * 收到 cli:done 后读 core:results 的结果打印出来。外加一个自己读日志文件的 grep 小功能。
 *
 * 协议（约定式）：
 *   cli:commands（CLI 拥有）：[{ cmd, args }] —— 命令内容
 *   cli:request  事件         —— 请求门铃，核心取第一条未处理指令执行
 *   core:results（核心拥有）：[{ cmd, ok, result, error }] —— 执行结果
 *   cli:done     事件         —— 完成门铃，CLI 读 core:results 最新一条展示
 * 终端串行，无需 id 关联；内容/结果全走数组，事件只当门铃。
 */
const readline = require('readline');
const fs = require('fs');
const path = require('path');

let rl = null;
const ARRAY_CMDS = 'cli:commands';
const ARRAY_RESULTS = 'core:results';
const EV_REQUEST = 'cli:request';
const EV_DONE = 'cli:done';

/** 提交指令：写入数组 + 响请求门铃。 */
function ask(ctx, cmd, args) {
  ctx.array(ARRAY_CMDS).push({ cmd, args: args || {} });
  ctx.sendEvent(EV_REQUEST, {}).catch(() => {});
}

/** 简单 JSON 参数解析：能解析就用 JSON，否则当作原始字符串。 */
function parseArg(s) {
  if (s === undefined) return undefined;
  try { return JSON.parse(s); } catch { return s; }
}

/** 日志时间线单行格式化（cli 端小功能，读文件用）。 */
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
  return path.resolve(__dirname, cfg.logFile || '../../logs/event-stream.log');
}

/** 小功能：自己读日志文件按关键字 grep / 尾部截断。核心不参与。 */
function showLog(ctx, pattern, count) {
  setTimeout(() => {
    const file = logFileOf(ctx);
    if (!fs.existsSync(file)) return console.log('日志文件不存在: ' + file);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    let entries = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (pattern) {
      entries = entries.filter((e) => String(e.type).includes(pattern) || String(e.source).includes(pattern) || String(e.message).includes(pattern));
    }
    const tail = count > 0 ? entries.slice(-count) : entries;
    for (const e of tail) console.log(fmt(e));
    console.log('(时间线共 ' + entries.length + ' 条匹配' + (count > 0 ? '，显示最后 ' + tail.length + ' 条' : '') + ')');
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
    '  index [budget <MB>]          查看比对索引状态 / 修改索引内存预算',
    '  log [过滤词] [条数]          查看日志时间线（读文件 grep）',
    '  help / exit',
  ].join('\n');
}

/** 指令分发：只整理参数入数组 + 响门铃，结果异步回来后 onEvent 展示。 */
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
    case 'index': {
      if (parts[1] === 'budget') {
        const mb = parts[2];
        if (!mb || !/^\d+(\.\d+)?$/.test(mb)) return console.log('用法: index budget <MB>');
        ask(ctx, 'index', { action: 'budget', mb: parseFloat(mb) });
        console.log('→ 已提交 index budget ' + mb + 'MB');
      } else {
        ask(ctx, 'index', { action: 'view' });
        console.log('→ 已提交 index（查询比对索引状态）');
      }
      break;
    }
    case 'log':
      showLog(ctx, parts[1] || null, parts[2] ? parseInt(parts[2], 10) : 0);
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
    ctx.exposeArray(ARRAY_CMDS, []); // 指令数组：命令内容放这里
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on('line', (line) => {
      if (!line.trim()) { rl.prompt(); return; }
      run(ctx, line.trim());
      rl.prompt();
    });
    rl.on('close', () => process.exit(0)); // 管道 EOF / Ctrl+C 直接结束
    rl.prompt();
  },
  async onEvent(ctx, event) {
    if (event.name !== EV_DONE) return;
    const result = ctx.array(ARRAY_RESULTS).at(-1); // 串行终端：最新一条就是刚完成的
    if (!result) return;
    if (!result.ok) {
      console.log('✖ ' + (result.error || '执行失败'));
      return;
    }
    if (result.cmd === 'state') {
      const r = result.result || {};
      const modules = r.modules || [];
      const arrays = r.arrays || [];
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
    } else if (result.cmd === 'index') {
      const r = result.result || {};
      console.log('--- 比对索引 ---');
      console.log('  预算 ' + Math.round((r.budgetBytes || 0) / 1024) + ' KB');
      for (const [kind, s] of Object.entries({ start: r.start, listen: r.listen })) {
        if (!s) continue;
        console.log(
          '  ' + kind + ': 已用 ' + Math.round(s.usedBytes / 1024) + ' KB, 索引 ' + s.indexedPatterns +
          ' 条件 (精确 ' + s.exactPatterns + ' / 桶 ' + s.bucketPatterns + ' / 全局 ' + s.globalPatterns +
          ', ' + s.buckets + ' 桶), 溢出 ' + s.overflowPatterns,
        );
      }
      if (r.updated) console.log('  (预算已更新并重建索引)');
    } else if (result.cmd === 'exit') {
      // 核心正在关闭；stop() 里负责退出进程
    } else {
      console.log('✔ ' + JSON.stringify(result.result));
    }
  },
  async stop(ctx) {
    if (rl) rl.close();
    // 等核心把最后的日志写完再退（exit 与 Ctrl+C 都会走到这里）
    setTimeout(() => process.exit(0), 50);
  },
};
