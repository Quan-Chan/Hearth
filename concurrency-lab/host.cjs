'use strict';
/* 并发验证宿主：编排等待/释放时间线，周期采样各模块计数，最后给出判定。 */
const path = require('path');
const fs = require('fs');
const { startCore } = require(path.join(__dirname, '..', 'dist', 'index.js'));

const MODULES = path.join(__dirname, 'modules');
const LOG_FILE = path.join(__dirname, 'logs', 'event-stream.log');
const EVENTS_FILE = path.join(__dirname, 'host-events.jsonl');
const T0 = Date.now();
const say = (o) => { try { const line = JSON.stringify(o); process.stdout.write(line + '\n'); fs.appendFileSync(EVENTS_FILE, line + '\n'); } catch (e) {} };
const elapsed = () => Date.now() - T0;

function readArr(core, name) {
  try { const a = core.array(name); return { n: a[0], last: a[1] }; } catch (e) { return { n: -1, last: 0 }; }
}

async function main() {
  const core = await startCore({ moduleDir: MODULES, logFile: LOG_FILE, watch: false });
  say({ k: 'booted', t: elapsed(), modules: core.listModules().length });

  // 周期采样：250ms 一次，记录各模块计数与时刻
  const samples = [];
  const sampler = setInterval(function () {
    samples.push({ t: elapsed(), a: readArr(core, 'a-status'), b: readArr(core, 'b-status'), c: readArr(core, 'c-status'), d: readArr(core, 'd-status') });
  }, 250);

  // 时间线：t=2s 发请求；t=5s 同步冻结 3 秒（对照组）；t=12s 定向送达解锁；t=16s 判定
  setTimeout(function () { say({ k: 'action', t: elapsed(), note: '发送 request：a-blocked 进入等待' }); core.sendEvent('request').catch(function () {}); }, 2000);
  setTimeout(function () { say({ k: 'action', t: elapsed(), note: '发送 freeze：同步占用线程 3 秒（对照组）' }); core.sendEvent('freeze').catch(function () {}); }, 5000);
  setTimeout(function () { say({ k: 'action', t: elapsed(), note: '定向送达 info：解锁 a-blocked' }); core.sendTo('a-blocked', { info: true }, 'external').catch(function () {}); }, 12000);

  setTimeout(function () {
    clearInterval(sampler);
    const releaseAt = 12000;
    const failures = [];
    const evidence = {};

    // 断言1：等待窗口内（排除同步冻结段），其他模块持续推进
    const active = samples.filter(function (s) { return s.t >= 2300 && s.t <= 11500 && !(s.t > 4800 && s.t < 8500); });
    const cMin = Math.min.apply(null, active.map(function (s) { return s.c.n; }));
    const cMax = Math.max.apply(null, active.map(function (s) { return s.c.n; }));
    const dMin = Math.min.apply(null, active.map(function (s) { return s.d.n; }));
    const dMax = Math.max.apply(null, active.map(function (s) { return s.d.n; }));
    evidence.workerAdvanced = cMax - cMin;
    evidence.beatsAdvanced = dMax - dMin;
    if (!(evidence.workerAdvanced >= 5)) failures.push('等待期间工作者只推进了 ' + evidence.workerAdvanced + ' 次');
    if (!(evidence.beatsAdvanced >= 5)) failures.push('等待期间心跳只推进了 ' + evidence.beatsAdvanced + ' 次');

    // 断言2：同步冻结是真实的全停（对照组证据）
    let maxGap = 0;
    for (let i = 1; i < samples.length; i++) {
      if (!samples[i].d.last || !samples[i - 1].d.last) continue;
      const gap = samples[i].d.last - samples[i - 1].d.last;
      if (gap > maxGap) maxGap = gap;
    }
    evidence.freezeGapMs = maxGap;
    if (!(maxGap >= 2600)) failures.push('未观察到同步冻结造成的停顿（最大间隔 ' + maxGap + 'ms）');

    // 断言3：b-after 在前座等待期间收不到 request，解锁后才收到（排队转发规则）
    const b = readArr(core, 'b-status');
    evidence.bCount = b.n;
    evidence.bReceivedAtMs = b.last - T0;
    if (b.n !== 1) failures.push('b-after 收到 ' + b.n + ' 次请求，预期恰好 1 次（迟到的补送）');
    else if (!(b.last - T0 >= releaseAt)) failures.push('b-after 在解锁前就收到了请求');

    // 断言4：等待者最终完成
    const aSt = core.array('a-status');
    evidence.aDone = aSt[0] === true;
    if (!evidence.aDone) failures.push('a-blocked 解锁后未完成处理');

    // 断言5：从未运行的模块不影响任何人
    const dormant = core.getModule('f-dormant');
    evidence.dormantStatus = dormant ? dormant.status : 'missing';
    if (dormant && dormant.status !== 'stopped') failures.push('休眠模块状态异常: ' + dormant.status);

    say({ k: 'verdict', t: elapsed(), pass: failures.length === 0, evidence: evidence, failures: failures });
    setTimeout(async function () {
      try { await core.stop(); } catch (e) {}
      process.exit(failures.length === 0 ? 0 : 3);
    }, 400);
  }, 16000);

  setTimeout(function () { say({ k: 'hard-timeout', t: elapsed() }); process.exit(4); }, 25000);
}

main().catch(function (e) { say({ k: 'host-fatal', error: String((e && e.stack) || e) }); process.exit(2); });