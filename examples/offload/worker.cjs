/**
 * 外部计算进程（独立 Node.js）：自己拉任务文件、算完写回结果文件。
 * 启动：node examples/offload/worker.cjs
 * 与核心只通过文件交互，核心事件循环完全不被占用。
 */
const fs = require('fs');
const path = require('path');

const WORK = path.join(__dirname, 'work');
const tasksDir = path.join(WORK, 'tasks');
const resultsDir = path.join(WORK, 'results');

// 迭代计算（取模防溢出）：结果稳定可读，计算量由 n 控制
function heavy(n) {
  let a = 1;
  let b = 1;
  for (let i = 0; i < n; i++) {
    const c = (a + b) % 1000000007;
    a = b;
    b = c;
  }
  return b;
}

let total = 0;

function pump() {
  let files = [];
  try {
    files = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.json'));
  } catch {
    return;
  }
  for (const f of files) {
    const taskPath = path.join(tasksDir, f);
    let task;
    try {
      task = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
    } catch {
      continue;
    }
    const start = Date.now();
    const result = heavy(task.n); // 在外部进程里算，核心无感
    const workerMs = Date.now() - start;
    total++;
    fs.writeFileSync(path.join(resultsDir, 'result-' + task.id + '.json'), JSON.stringify({ id: task.id, n: task.n, result, workerMs }));
    fs.rmSync(taskPath);
    // eslint-disable-next-line no-console
    console.log('[外部worker] 任务 ' + task.id + ' 完成 = ' + result + '（' + workerMs + 'ms，累计 ' + total + ' 个）');
  }
}

// eslint-disable-next-line no-console
console.log('[外部worker] 就绪，轮询 ' + tasksDir);
setInterval(pump, 100);