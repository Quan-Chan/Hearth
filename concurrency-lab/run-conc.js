'use strict';
/* 并发验证台架：清场 → 启动宿主 → 轮询标记 → 输出判定。 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const LAB = __dirname;
const EVENTS = path.join(LAB, 'host-events.jsonl');

try { fs.rmSync(path.join(LAB, 'logs'), { recursive: true, force: true }); } catch (e) {}
try { fs.unlinkSync(EVENTS); } catch (e) {}

const child = spawn(process.execPath, ['host.cjs'], { cwd: LAB, env: process.env, stdio: 'inherit' });
let markers = [];
const poll = setInterval(function () {
  let text = '';
  try { text = fs.readFileSync(EVENTS, 'utf8'); } catch (e) { return; }
  const lines = text.split('\n').filter(function (l) { return l.trim(); });
  for (let i = markers.length; i < lines.length; i++) { try { markers.push(JSON.parse(lines[i])); } catch (e) {} }
}, 500);

child.on('exit', function (code, signal) {
  clearInterval(poll);
  const verdict = markers.find(function (m) { return m.k === 'verdict'; });
  console.log('==================== 并发判定 ====================');
  if (verdict) {
    console.log('结论: ' + (verdict.pass ? '通过 —— 等待中的模块没有拖累其他模块' : '未通过'));
    console.log('证据: ' + JSON.stringify(verdict.evidence));
    if (verdict.failures.length) console.log('失败项: ' + verdict.failures.join(' | '));
  } else {
    console.log('未见判定标记，退出码 ' + code + ' 信号 ' + signal);
  }
  process.exit(code === 0 ? 0 : 1);
});