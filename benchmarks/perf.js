/**
 * 性能基准（只读，不修改任何文件）：
 *  1. 事件比对：MatchIndex（精确表+通配列表） vs 全量比对（编译缓存正则）  —— CPU
 *  2. 配置轮询：stat 指纹轮 vs 全量 read+sha1 轮                          —— CPU
 * 运行：npm run bench（先 build 出 dist，脚本从 dist 引用实现，与源码一致）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MatchIndex } = require('../dist/core/MatchIndex');
const { patternToRegExp } = require('../dist/core/EventMatcher');

const N = 50;
const EV = 10000;

function buildPatterns() {
  const entries = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < 3; j++) entries.push({ pattern: 'svc' + i + ':act' + j, slot: i });
    entries.push({ pattern: 'svc' + i + ':*', slot: i });
    entries.push({ pattern: 'job:*', slot: i });
  }
  return entries;
}

function buildEvents(mode) {
  const evs = [];
  for (let k = 0; k < EV; k++) {
    evs.push(
      mode === 'rep'
        ? k % 2 === 0 ? 'svc' + (k % 20) + ':act' + (k % 3) : 'svc' + (k % 20) + ':x' + (k % 7)
        : k % 2 === 0 ? 'job:u' + k : 'svc7:u' + k,
    );
  }
  return evs;
}

function bench(label, events, fn) {
  const t = process.hrtime.bigint();
  for (const e of events) fn(e);
  const us = Number(process.hrtime.bigint() - t) / events.length / 1000;
  console.log('  ' + label + ': ' + us.toFixed(2) + ' us/事件');
  return us;
}

function main() {
  console.log('=== 1. 事件比对（' + N + ' 模块 x 5 条件, ' + EV + ' 事件）===');
  const entries = buildPatterns();
  const idx = new MatchIndex();
  idx.rebuild(entries);
  const repEvents = buildEvents('rep');
  const uniEvents = buildEvents('uni');

  // 结果核对：索引结果必须与全量比对一致（不变量，按槽号比较）
  let mismatch = 0;
  for (const e of repEvents) {
    const a = [...new Set(idx.lookup(e))].sort((x, y) => x - y);
    const b = [...new Set(entries.map((en, i) => (patternToRegExp(en.pattern).test(e) ? en.slot : -1)).filter((i) => i >= 0))].sort((x, y) => x - y);
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) mismatch++;
  }
  console.log('  结果核对（索引 vs 全量比对，' + repEvents.length + ' 事件）: ' + (mismatch === 0 ? '一致' : mismatch + ' 处不一致!'));

  const usIndexRep = bench('MatchIndex 精确+通配  重复名', repEvents, (e) => idx.lookup(e));
  const usIndexUni = bench('MatchIndex 精确+通配  唯一名', uniEvents, (e) => idx.lookup(e));
  const usFullRep = bench('全量比对(编译缓存正则) 重复名', repEvents, (e) => {
    let n = 0;
    for (let i = 0; i < N; i++) {
      if (patternToRegExp('svc' + i + ':*').test(e)) n++;
      if (patternToRegExp('job:*').test(e)) n++;
      for (let j = 0; j < 3; j++) if (patternToRegExp('svc' + i + ':act' + j).test(e)) n++;
    }
    return n;
  });
  const usFullUni = bench('全量比对(编译缓存正则) 唯一名', uniEvents, (e) => {
    let n = 0;
    for (let i = 0; i < N; i++) {
      if (patternToRegExp('svc' + i + ':*').test(e)) n++;
      if (patternToRegExp('job:*').test(e)) n++;
      for (let j = 0; j < 3; j++) if (patternToRegExp('svc' + i + ':act' + j).test(e)) n++;
    }
    return n;
  });
  console.log('  加速比: 重复名 ' + (usFullRep / usIndexRep).toFixed(1) + 'x, 唯一名 ' + (usFullUni / usIndexUni).toFixed(1) + 'x');

  console.log('=== 2. 配置轮询（tests/fixtures/chat-bot/modules 真实目录）===');
  const dir = path.resolve(__dirname, '..', 'tests', 'fixtures', 'chat-bot', 'modules');
  const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)).map((f) => path.join(dir, f));
  const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f, 'utf8')).digest('hex');
  const R = 2000;
  let t = process.hrtime.bigint();
  for (let r = 0; r < R; r++) for (const f of files) sha(f);
  const usRead = Number(process.hrtime.bigint() - t) / R / files.length / 1000;
  t = process.hrtime.bigint();
  for (let r = 0; r < R; r++) for (const f of files) fs.statSync(f);
  const usStat = Number(process.hrtime.bigint() - t) / R / files.length / 1000;
  console.log('  ' + files.length + ' 个 YAML, 每文件: 全量读+sha1 ' + usRead.toFixed(1) + ' us vs 仅 stat ' + usStat.toFixed(1) + ' us（加速 ' + (usRead / usStat).toFixed(1) + 'x）');

}

main();