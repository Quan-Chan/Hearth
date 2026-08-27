'use strict';
/* 混沌测试台架：清场 → 启动宿主(stdio inherit) → 轮询事件标记 → 判定结局 → 分析事件流水。 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const LAB = __dirname;
const MOD = path.join(LAB, 'modules');
const EVENTS = path.join(LAB, 'host-events.jsonl');

function clean() {
  for (const f of fs.readdirSync(MOD)) {
    if (/^(broken-|missing-|nullx-|factory-|bom-|ghost-|shapeshifter-b)/.test(f)) { try { fs.unlinkSync(path.join(MOD, f)); } catch (e) {} }
  }
  fs.writeFileSync(path.join(MOD, 'shapeshifter-a.yaml'), 'name: shapeshifter\nfile: ../assets/shapeshifter-a.cjs\nstartEvents:\n  - "core:startup"\nlisten:\n  - "tick"\n');
  fs.rmSync(path.join(MOD, 'pack-folder'), { recursive: true, force: true });
  fs.rmSync(path.join(LAB, 'logs'), { recursive: true, force: true });
  try { fs.unlinkSync(EVENTS); } catch (e) {}
}

function readMarkers(prevCount) {
  const out = [];
  let text = '';
  try { text = fs.readFileSync(EVENTS, 'utf8'); } catch (e) { return { markers: out, count: prevCount }; }
  const lines = text.split('\n').filter(function (l) { return l.trim(); });
  for (let i = prevCount; i < lines.length; i++) { try { out.push(JSON.parse(lines[i])); } catch (e) {} }
  return { markers: out, count: lines.length };
}

function logFilePaths() {
  const dir = path.join(LAB, 'logs');
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  return names.filter(function (n) { return /^event-stream\.\d{4}-\d{2}-\d{2}\.\d{3}\.log$/.test(n); }).sort().map(function (n) { return path.join(dir, n); });
}

async function analyzeLog() {
  const files = logFilePaths();
  if (!files.length) return { note: '无日志文件' };
  const counts = {};
  const errTop = {};
  let lines = 0, firstT = null, lastT = null;
  let moduleStart = 0, moduleStop = 0, moduleSkip = 0, cfgLoad = 0, cfgUpdate = 0, cfgRemove = 0;
  const sources = new Set();
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += fs.statSync(file).size;
    await new Promise(function (resolve) {
      const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
      rl.on('line', function (line) {
        lines++;
        let o = null;
        try { o = JSON.parse(line); } catch (e) { return; }
        if (firstT === null) firstT = o.t;
        lastT = o.t;
        counts[o.type] = (counts[o.type] || 0) + 1;
        if (o.source) sources.add(String(o.source));
        if (o.type === 'module-start') moduleStart++;
        else if (o.type === 'module-stop') moduleStop++;
        else if (o.type === 'module-skip') moduleSkip++;
        else if (o.type === 'config-load') cfgLoad++;
        else if (o.type === 'config-update') cfgUpdate++;
        else if (o.type === 'config-remove') cfgRemove++;
        else if (o.type === 'error') { const m = String(o.message || '').slice(0, 90); errTop[m] = (errTop[m] || 0) + 1; }
      });
      rl.on('close', resolve);
    });
  }
  const topErr = Object.entries(errTop).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 12);
  return { logLines: lines, logMB: +(totalBytes / 1048576).toFixed(1), span: firstT && lastT ? ((new Date(lastT) - new Date(firstT)) / 1000).toFixed(1) + 's' : 'n/a', byType: counts, moduleStart: moduleStart, moduleStop: moduleStop, moduleSkip: moduleSkip, cfgLoad: cfgLoad, cfgUpdate: cfgUpdate, cfgRemove: cfgRemove, uniqueSources: sources.size, topErrors: topErr };
}

async function main() {
  console.log('[run] 前置：dist 构建由台架外部完成（沙箱限制嵌套派生），此处校验存在性...');
  if (!fs.existsSync(path.join(LAB, '..', 'dist', 'index.js'))) { console.error('dist/index.js 不存在，请先构建'); process.exit(1); }
  console.log('[run] 1) 清理现场...');
  clean();
  console.log('[run] 2) 启动混沌宿主（90 秒混乱窗口 + 优雅停机）...');
  const child = spawn(process.execPath, ['host.cjs'], { cwd: LAB, env: process.env, stdio: 'inherit' });
  let markerCount = 0;
  let coreStopped = null, wedged = null, stopHang = null, hostFatal = null;
  const poll = setInterval(function () {
    const r = readMarkers(markerCount);
    markerCount = r.count;
    for (const m of r.markers) {
      if (m.k !== 'stats') console.log('[host] ' + JSON.stringify(m));
      if (m.k === 'core-stopped') coreStopped = m;
      if (m.k === 'wedged') wedged = m;
      if (m.k === 'stop-hang') stopHang = m;
      if (m.k === 'host-fatal') hostFatal = m;
    }
  }, 1000);
  const result = await new Promise(function (resolve) {
    const killer = setTimeout(function () {
      console.log('[run] 硬超时：强杀宿主');
      try { child.kill('SIGKILL'); } catch (e) {}
      resolve({ verdict: 'WEDGED', why: '130 秒硬超时被强杀' });
    }, 130000);
    child.on('exit', function (code, signal) {
      clearInterval(poll); clearTimeout(killer);
      const r = readMarkers(markerCount);
      for (const m of r.markers) { if (m.k === 'core-stopped') coreStopped = m; if (m.k === 'wedged') wedged = m; if (m.k === 'stop-hang') stopHang = m; if (m.k === 'host-fatal') hostFatal = m; }
      if (hostFatal) return resolve({ verdict: 'CRASHED', why: '宿主启动即致命错误: ' + String(hostFatal.error).slice(0, 200) });
      if (signal) return resolve({ verdict: 'CRASHED', why: '被信号终止: ' + signal });
      if (code === 0 && coreStopped) return resolve({ verdict: 'STABLE', why: '全程 90 秒混沌中存活，且完成完整优雅停机', exitCode: code });
      if (code === 0) return resolve({ verdict: 'SUSPECT', why: '退出码 0 但未见 core-stopped 标记', exitCode: code });
      if (code === 5 || wedged) return resolve({ verdict: 'WEDGED', why: '事件循环失去响应（海绵心跳停滞超 20 秒）', exitCode: code });
      if (code === 6 || stopHang) return resolve({ verdict: 'HANG-SHUTDOWN', why: '优雅停机 20 秒未完成', exitCode: code });
      return resolve({ verdict: 'CRASHED', why: '异常退出码 ' + code + (hostFatal ? '' : ''), exitCode: code });
    });
  });
  console.log('[run] 3) 分析事件流水...');
  const analysis = await analyzeLog();
  console.log('');
  console.log('==================== 判定 ====================');
  console.log('结局: ' + result.verdict + ' —— ' + result.why);
  console.log('');
  console.log('==================== 流水统计 ====================');
  if (analysis.note) { console.log(analysis.note); } else {
    console.log('日志: ' + analysis.logLines + ' 行 / ' + analysis.logMB + ' MB / 跨度 ' + analysis.span);
    console.log('模块: 启动 ' + analysis.moduleStart + ' 次, 关闭 ' + analysis.moduleStop + ' 次, 跳过 ' + analysis.moduleSkip + ' 次');
    console.log('配置: 载入 ' + analysis.cfgLoad + ', 更新 ' + analysis.cfgUpdate + ', 移除 ' + analysis.cfgRemove + '; 事件来源 ' + analysis.uniqueSources + ' 个');
    console.log('按类型: ' + JSON.stringify(analysis.byType));
    if (analysis.topErrors && analysis.topErrors.length) {
      console.log('高频错误 Top12:');
      for (const [m, c] of analysis.topErrors) console.log('  ' + c + ' x  ' + m);
    }
  }
  fs.writeFileSync(path.join(LAB, 'last-run-report.json'), JSON.stringify({ result: result, analysis: analysis }, null, 2));
  console.log('');
  console.log('[run] 报告已写入 chaos-lab/last-run-report.json');
}
main().catch(function (e) { console.error(e); process.exit(1); });
