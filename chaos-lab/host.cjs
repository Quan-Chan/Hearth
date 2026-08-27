'use strict';
/* 混沌实验宿主：子进程内启动 Connect-Core，注入分阶段混乱，采集指标，最后正常停机。 */
const path = require('path');
const fs = require('fs');
const { monitorEventLoopDelay } = require('perf_hooks');
const { startCore } = require(path.join(__dirname, '..', 'dist', 'index.js'));

const MODULES = path.join(__dirname, 'modules');
const LOG_FILE = path.join(__dirname, 'logs', 'event-stream.log');
const T0 = Date.now();
const EVENTS_FILE = path.join(__dirname, 'host-events.jsonl');
const say = (o) => { try { const line = JSON.stringify(o); process.stdout.write(line + '\n'); fs.appendFileSync(EVENTS_FILE, line + '\n'); } catch (e) {} };
const elapsed = () => Math.round((Date.now() - T0) / 1000);

let ghostSeq = 1;
let junkSeq = 1;
let packParity = 0;

function writeAtomic(file, text) { const tmp = file + '.tmp' + Math.random().toString(36).slice(2, 6); fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); }
function removeIfExists(f) { try { fs.unlinkSync(f); } catch (e) {} }
function listYamls() { try { return fs.readdirSync(MODULES).filter(function (f) { return /\.yaml$/i.test(f); }); } catch (e) { return []; } }
function ghostCount() { return listYamls().filter(function (f) { return f.indexOf('ghost-') === 0; }).length; }

const BROKEN_SAMPLES = [
  'name: broken\nfile: ./x.cjs\n\tbad: indent\n',
  'name: "unclosed\nfile: ./x.cjs\n',
  '{ not: [valid\n',
  '',
  'name: 123\nfile: 456\n',
  'name: dup\nname: dup2\nfile: ./x.cjs\n',
];

const saboteur = {
  phase: 1,
  ops: 0,
  timer: null,
  tick() {
    this.ops++;
    const roll = Math.random();
    try {
      if (roll < 0.16) this.dropBroken();
      else if (roll < 0.28) this.dropMissing();
      else if (roll < 0.34) this.dropNullExporter();
      else if (roll < 0.40) this.dropBoomFactory();
      else if (roll < 0.52) this.mangleRandom();
      else if (roll < 0.60) this.deleteRandomJunk();
      else if (roll < 0.68) this.touchStorm();
      else if (roll < 0.74) this.atomicReplaceClock();
      else if (roll < 0.80) this.crlfBom();
      else if (this.phase >= 2 && roll < 0.90) this.ghostFarm();
      else if (this.phase >= 2 && roll < 0.96) this.shapeShiftFight();
      else if (this.phase >= 2) this.subdirPack();
    } catch (e) { say({ k: 'saboteur-error', t: elapsed(), error: String((e && e.message) || e) }); }
  },
  dropBroken() { const n = junkSeq++; fs.writeFileSync(path.join(MODULES, 'broken-' + n + '.yaml'), BROKEN_SAMPLES[n % BROKEN_SAMPLES.length]); if (n % 3 === 0) removeIfExists(path.join(MODULES, 'broken-' + (n - 3) + '.yaml')); },
  dropMissing() { const n = junkSeq++; writeAtomic(path.join(MODULES, 'missing-' + n + '.yaml'), 'name: missing-' + n + '\nfile: ./no-such-' + n + '.cjs\nstartEvents:\n  - "tick"\n'); },
  dropNullExporter() { const n = junkSeq++; writeAtomic(path.join(MODULES, 'nullx-' + n + '.yaml'), 'name: nullx-' + n + '\nfile: ../assets/null-exporter.cjs\n'); },
  dropBoomFactory() { const n = junkSeq++; writeAtomic(path.join(MODULES, 'factory-' + n + '.yaml'), 'name: factory-' + n + '\nfile: ../assets/boom-factory.cjs\nstartEvents:\n  - "tick"\n'); },
  mangleRandom() {
    // 只破坏动态投放的文件；静态模块的 YAML 是舞台布景，破坏者不碰（否则跨轮次无法复位）
    const ys = listYamls().filter(function (f) { return /^(broken-|missing-|nullx-|factory-|bom-|ghost-|shapeshifter-)/.test(f); });
    if (!ys.length) return;
    const fp = path.join(MODULES, ys[Math.floor(Math.random() * ys.length)]);
    let original = '';
    try { original = fs.readFileSync(fp, 'utf8'); } catch (e) { return; }
    const mode = Math.floor(Math.random() * 3);
    if (mode === 0) fs.writeFileSync(fp, original.slice(0, Math.max(1, Math.floor(original.length / 2))));
    else if (mode === 1) fs.writeFileSync(fp, Buffer.from([0x00, 0x01, 0xff, 0x0a]));
    else fs.writeFileSync(fp, '');
  },
  deleteRandomJunk() {
    const junk = listYamls().filter(function (f) { return /^(broken-|missing-|nullx-|factory-|bom-|ghost-)/.test(f); });
    if (junk.length) removeIfExists(path.join(MODULES, junk[Math.floor(Math.random() * junk.length)]));
  },
  touchStorm() { const fp = path.join(MODULES, 'clock.yaml'); try { const c = fs.readFileSync(fp, 'utf8'); fs.writeFileSync(fp, c); } catch (e) {} },
  atomicReplaceClock() { const iv = 230 + Math.floor(Math.random() * 60); writeAtomic(path.join(MODULES, 'clock.yaml'), 'name: clock\nfile: ./clock.cjs\nstartEvents:\n  - "core:startup"\nconfig:\n  intervalMs: ' + iv + '\n'); },
  crlfBom() { const n = junkSeq++; removeIfExists(path.join(MODULES, 'bom-' + (n - 1) + '.yaml')); fs.writeFileSync(path.join(MODULES, 'bom-' + n + '.yaml'), '\uFEFFname: bom-' + n + '\r\nfile: ../assets/ghost.cjs\r\nstartEvents:\r\n  - "never:bom"\r\n'); },
  ghostFarm() {
    if (ghostCount() > 30) {
      const gs = listYamls().filter(function (f) { return f.indexOf('ghost-') === 0; }).sort();
      if (gs.length) removeIfExists(path.join(MODULES, gs[0]));
      return;
    }
    const n = ghostSeq++;
    writeAtomic(path.join(MODULES, 'ghost-' + n + '.yaml'), 'name: ghost-' + n + '\nfile: ../assets/ghost.cjs\nstartEvents:\n  - "tick"\nlisten:\n  - "tick"\n');
  },
  shapeShiftFight() {
    const useA = Math.random() < 0.5;
    writeAtomic(path.join(MODULES, 'shapeshifter-a.yaml'), 'name: shapeshifter\nfile: ../assets/shapeshifter-' + (useA ? 'a' : 'b') + '.cjs\nstartEvents:\n  - "core:startup"\nlisten:\n  - "tick"\n');
    if (!fs.existsSync(path.join(MODULES, 'shapeshifter-b.yaml'))) {
      writeAtomic(path.join(MODULES, 'shapeshifter-b.yaml'), 'name: shapeshifter\nfile: ../assets/shapeshifter-b.cjs\nstartEvents:\n  - "core:startup"\nlisten:\n  - "tick"\n');
    } else if (Math.random() < 0.4) {
      removeIfExists(path.join(MODULES, 'shapeshifter-b.yaml'));
    }
  },
  subdirPack() {
    const dir = path.join(MODULES, 'pack-folder');
    packParity++;
    if (packParity % 2 === 1) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'pack.cjs'), 'module.exports = { name: pack, start() {}, onEvent() {}, stop() {} };'.replace(/pack/g, 'pack-rider'));
      writeAtomic(path.join(dir, 'pack.yaml'), 'name: pack-rider\nfile: ./pack.cjs\nstartEvents:\n  - "tick"\n');
    } else { fs.rmSync(dir, { recursive: true, force: true }); }
  },
};

async function main() {
  const core = await startCore({ moduleDir: MODULES, logFile: LOG_FILE, pollIntervalMs: 150, logToConsole: false, guardProcess: true });
  say({ k: 'booted', t: elapsed(), modules: core.listModules().length });

  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();
  let lastSeen = 0;
  let lastGrewAt = Date.now();
  const statsTimer = setInterval(function () {
    let seen = lastSeen;
    try { const s = core.array('sponge-stats'); if (s && s[0] > seen) seen = s[0]; } catch (e) {}
    if (seen > lastSeen) { lastSeen = seen; lastGrewAt = Date.now(); }
    const ms = core.listModules();
    say({ k: 'stats', t: elapsed(), rss: process.memoryUsage().rss, heap: process.memoryUsage().heapUsed, lagMs: lag.mean / 1e6, running: ms.filter(function (m) { return m.status === 'running'; }).length, failed: ms.filter(function (m) { return m.status === 'failed'; }).length, arrays: Object.keys(core.array('*')).length, seen: lastSeen, phase: saboteur.phase, ops: saboteur.ops });
  }, 2000);

  let spongeProbeDeadNoted = false;
  const wedgeCheck = setInterval(function () {
    if (Date.now() - lastGrewAt <= 20000) return;
    let spongeRunning = false;
    try { spongeRunning = core.getModule('sponge') !== undefined && core.getModule('sponge').status === 'running'; } catch (e) {}
    if (spongeRunning) {
      say({ k: 'wedged', t: elapsed(), note: '海绵在运行但计数 20 秒未增长，事件循环疑似失去响应' });
      clearInterval(statsTimer); clearInterval(wedgeCheck); if (saboteur.timer) clearInterval(saboteur.timer);
      process.exit(5);
    } else {
      // 海绵本身已被混乱打掉：计数器不可用，交回硬超时强制关闭
      lastGrewAt = Date.now();
      if (!spongeProbeDeadNoted) { spongeProbeDeadNoted = true; say({ k: 'note', t: elapsed(), note: '活性探针(海绵)已下线，仅剩硬超时强制关闭' }); }
    }
  }, 5000);

  setTimeout(function () { say({ k: 'phase', t: elapsed(), note: 'hangman:go 第1次 —— 注入悬挂启动' }); core.sendEvent('hangman:go').catch(function () {}); }, 10000);
  setTimeout(function () { say({ k: 'phase', t: elapsed(), note: 'hangman:go 第2次 —— 验证启动锁' }); core.sendEvent('hangman:go').catch(function () {}); }, 25000);
  setTimeout(function () { say({ k: 'phase', t: elapsed(), note: 'hangman:go 第3次 —— 验证超时锁定' }); core.sendEvent('hangman:go').catch(function () {}); }, 40000);
  setTimeout(function () { saboteur.phase = 2; say({ k: 'phase', t: elapsed(), note: '破坏者升级：幽灵农场 + 身份争夺 + 子目录包' }); }, 20000);
  saboteur.timer = setInterval(function () { saboteur.tick(); }, 600);

  async function gracefulStop(reason) {
    say({ k: 'stopping', t: elapsed(), reason: reason });
    const began = Date.now();
    const timeout = new Promise(function (resolve) { setTimeout(function () { resolve('timeout'); }, 20000); });
    const stopped = await Promise.race([core.stop().then(function () { return 'ok'; }), timeout]);
    clearInterval(statsTimer); clearInterval(wedgeCheck); if (saboteur.timer) clearInterval(saboteur.timer);
    if (stopped === 'ok') { say({ k: 'core-stopped', t: elapsed(), tookMs: Date.now() - began }); setTimeout(function () { process.exit(0); }, 300); }
    else { say({ k: 'stop-hang', t: elapsed(), note: '正常停机 20 秒未完成' }); process.exit(6); }
  }
  setTimeout(function () { gracefulStop('90 秒混沌窗口结束'); }, 90000);
  setTimeout(function () { say({ k: 'hard-timeout', t: elapsed() }); process.exit(4); }, 130000);
  process.on('SIGTERM', function () { gracefulStop('收到 SIGTERM'); });
  process.on('SIGINT', function () { gracefulStop('收到 SIGINT'); });
}

main().catch(function (e) { say({ k: 'host-fatal', error: String((e && e.stack) || e) }); process.exit(2); });
