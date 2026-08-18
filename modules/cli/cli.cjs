/**
 * CLI 模块（可选模块）：把核心变成命令行可操作的软件。
 *
 * 与核心的通信协议（约定式，事件=门铃、数组=内容）：
 *  ① 指令内容写入公共数组 cli:commands（CLI 拥有）：{ id, cmd, args, status }
 *  ② 广播 cli:request 门铃（只带 id）
 *  ③ 核心读 cli:commands 取该 id 指令、执行、把结果写入 core:results（核心拥有）
 *  ④ 核心广播 cli:done 完成门铃（只带 id）
 *  ⑤ CLI 收到后从 core:results 取结果、展示，并把自己的指令条目标记 status:'done'
 *
 * 数组名是双方约定（不进事件）；启动时先发 ping 自检，收不到 cli:done 则 CLI 不可用。
 * 高级功能（日志查看等）全部在本模块用 Node 直接实现，核心不参与。
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
let linked = false;
let seq = 0;
let pingId = null;
let pingTimer = null;
let exiting = false;

const ARRAY_CMDS = 'cli:commands';
const ARRAY_RESULTS = 'core:results';
const EV_REQUEST = 'cli:request';
const EV_DONE = 'cli:done';

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

/** 提交一条指令：写入 cli:commands 并响 cli:request 门铃。返回指令 id。 */
function submit(ctx, cmd, args) {
  const id = ++seq;
  ctx.array(ARRAY_CMDS).push({ id, cmd: cmd, args: args || {}, status: 'pending', at: Date.now() });
  ctx.sendEvent(EV_REQUEST, { id }).catch((err) => console.log('✖ 提交指令失败: ' + (err && err.message ? err.message : err)));
  return id;
}

function doExit(ctx) {
  if (exiting) return;
  exiting = true;
  submit(ctx, 'exit', {});
  // 兜底：核心停止不一定能正常送达完成门铃，超时后无条件退出
  setTimeout(() => process.exit(0), 600);
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

/** 指令分发：把命令写成指令对象入数组，再响门铃，结果异步回来后在 onEvent 里展示。 */
function runCommand(ctx, line) {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0];
  switch (cmd) {
    case 'event': {
      const name = parts[1];
      if (!name) return console.log('用法: event <名称> [JSON]');
      const id = submit(ctx, 'event', { name: name, data: parseArg(parts[2]) });
      console.log('→ 已提交指令 event "' + name + '" (id=' + id + ')');
      break;
    }
    case 'start': {
      const name = parts[1];
      if (!name) return console.log('用法: start <模块>');
      const id = submit(ctx, 'start', { module: name });
      console.log('→ 已提交指令 start ' + name + ' (id=' + id + ')');
      break;
    }
    case 'stop': {
      const name = parts[1];
      if (!name) return console.log('用法: stop <模块>');
      const id = submit(ctx, 'stop', { module: name });
      console.log('→ 已提交指令 stop ' + name + ' (id=' + id + ')');
      break;
    }
    case 'send': {
      const targets = parts[1];
      const name = parts[2];
      if (!targets || !name) return console.log('用法: send <目标|*> <名称> [JSON]');
      const id = submit(ctx, 'send', {
        targets: targets === '*' ? '*' : targets.split(',').map((s) => s.trim()).filter(Boolean),
        name: name,
        data: parseArg(parts[3]),
      });
      console.log('→ 已提交指令 send ' + name + ' -> ' + targets + ' (id=' + id + ')');
      break;
    }
    case 'state': {
      const id = submit(ctx, 'state', {});
      console.log('→ 已提交指令 state (id=' + id + ')');
      break;
    }
    case 'log': {
      // 高级功能留在 CLI：直接读日志文件，核心不参与
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

/** 处理完成门铃：从核心的结果数组取回结果并展示。 */
function onDone(ctx, id) {
  let result;
  try {
    result = ctx.array(ARRAY_RESULTS).find((r) => r.id === id);
  } catch (err) {
    result = null;
  }
  if (!result) {
    console.log('✖ 完成门铃未找到对应结果: id=' + id);
    return;
  }
  // 把自己的指令条目标记为已完成（cli:commands 是 CLI 拥有的，清理是自己的事）
  const entry = ctx.array(ARRAY_CMDS).find((c) => c.id === id);
  if (entry) entry.status = result.ok ? 'done' : 'error';

  if (!result.ok) {
    console.log('✖ 指令 ' + JSON.stringify(result.cmd) + ' 执行失败: ' + result.error);
    return;
  }
  if (id === pingId) {
    linked = true;
    if (pingTimer) clearTimeout(pingTimer);
    console.log('☑ CLI 已与核心联动（门铃协议可用）。输入 help 查看指令。');
    return;
  }
  switch (result.cmd) {
    case 'state': {
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
      ctx.log('CLI 查询核心状态完成');
      break;
    }
    case 'exit':
      console.log('✔ 核心已停止');
      setTimeout(() => process.exit(0), 100);
      break;
    default:
      console.log('✔ ' + JSON.stringify(result.result));
  }
}

module.exports = {
  name: 'cli',
  async start(ctx) {
    ctx.exposeArray(ARRAY_CMDS, []); // 指令信箱：内容放这里，别的模块也能看到 CLI 干了什么
    ctx.log('CLI 模块启动，正在与核心建立联动...');

    rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    // 联动自检：提交 ping，能收到 cli:done 即联动成功。
    // 注意：不能在 start() 内同步提交——模块此刻尚未被标记为 running，
    // 它发出的 cli:request 会被核心正常处理，但 cli:done 回给自己时因"未运行"被丢弃。
    // 用 setImmediate 推迟到 start 返回（核心已标记 running）之后。
    pingTimer = setTimeout(() => {
      if (linked) return;
      console.log('✖ 核心未响应 CLI 门铃协议（cli:request / core:results / cli:done），CLI 不可用。');
      ctx.log('核心未响应 CLI 门铃协议，CLI 不可用');
      if (rl) rl.close();
    }, 2000);
    setImmediate(() => {
      if (exiting) return;
      // 关键：pingId 必须在响应门铃【前】固定——sendEvent 派发后核心可能立即回 cli:done，
      // 若用 pingId = submit(...) 的返回值，赋值会晚于 onDone 的执行，联动判定将失配。
      const id = ++seq;
      pingId = id;
      ctx.array(ARRAY_CMDS).push({ id, cmd: 'ping', args: {}, status: 'pending', at: Date.now() });
      ctx.sendEvent(EV_REQUEST, { id }).catch((err) => console.log('✖ 提交指令失败: ' + (err && err.message ? err.message : err)));
    });

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
    if (event.name !== EV_DONE) return;
    const id = (event.data && event.data.id !== undefined) ? event.data.id : 0;
    onDone(ctx, id);
  },
  async stop() {
    if (rl) rl.close();
  },
};
