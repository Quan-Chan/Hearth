/**
 * MatchIndex 单元测试：与 anyEventMatches 全量比对逐字对拍（语义零变化），
 * 覆盖精确/前缀桶/全局桶/溢出表（预算耗尽）与索引状态统计。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchIndex } from '../../src/core/MatchIndex';
import { anyEventMatches } from '../../src/core/EventMatcher';

/** 简单确定性伪随机（不依赖 Math.random，保证可复现）。 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 用同一组模式构建 MatchIndex，并逐事件与 anyEventMatches 全量比对。 */
function checkAgainstBruteForce(patterns: string[], budgetBytes: number, eventNames: string[]): void {
  const idx = new MatchIndex<number>();
  idx.rebuild(patterns.map((pattern, slot) => ({ pattern, slot })), budgetBytes);
  for (const name of eventNames) {
    const viaIndex = new Set(idx.lookup(name));
    const viaBrute = new Set(patterns.map((p, i) => (anyEventMatches([p], name) ? i : -1)).filter((i) => i >= 0));
    assert.deepEqual(
      [...viaIndex].sort((a, b) => a - b),
      [...viaBrute].sort((a, b) => a - b),
      `事件 ${name} 的匹配结果不一致`,
    );
  }
}

test('索引与全量比对语义逐字一致（精确/通配/问号/正则特殊字符/全局桶）', () => {
  const rand = mulberry32(42);
  const patterns = [
    'core:startup', // 精确
    'a.b', // 精确 + 正则特殊字符
    'chat:*', // 前缀桶
    'chat:msg:*', // 前缀桶（多段）
    'job:*', // 前缀桶（多模块共享）
    '*', // 全局桶
    '*:alert', // 全局桶（通配开头）
    'a?c', // 问号
    'ch?t:*', // 通配中间
    'x*y', // 通配中段
  ];
  const eventNames: string[] = [
    'core:startup', 'core:shutdown', 'a.b', 'axb', 'chat', 'chat:', 'chat:hi', 'chat:msg:deep',
    'job:1', 'job:', 'anything:at:all', 'x', ':alert', 'a:alert', 'abc', 'ac', 'abbc', 'chat', 'xy', 'xzzzy', 'xyx',
  ];
  for (let i = 0; i < 500; i++) {
    eventNames.push('evt' + Math.floor(rand() * 50) + ':' + Math.floor(rand() * 100).toString(36) + (rand() > 0.5 ? ':sub' : ''));
  }
  checkAgainstBruteForce(patterns, 8 * 1024 * 1024, eventNames);
});

test('大量随机模式对拍：前缀桶分组不改变匹配语义', () => {
  const rand = mulberry32(2026);
  const patterns: string[] = [];
  for (let i = 0; i < 200; i++) {
    const kind = rand();
    if (kind < 0.3) patterns.push('svc' + i + ':act' + (i % 4)); // 精确
    else if (kind < 0.7) patterns.push('svc' + i + ':*'); // 前缀桶
    else if (kind < 0.9) patterns.push('area' + (i % 7) + ':event*'); // 桶内通配
    else patterns.push('*:flag' + (i % 5)); // 全局桶
  }
  const eventNames: string[] = [];
  for (let i = 0; i < 1000; i++) {
    eventNames.push(
      'svc' + Math.floor(rand() * 250) + ':' + (rand() > 0.5 ? 'act' + Math.floor(rand() * 4) : 'x' + Math.floor(rand() * 9).toString(36)),
    );
  }
  checkAgainstBruteForce(patterns, 8 * 1024 * 1024, eventNames);
});

test('预算耗尽：溢出的条件仍正确命中（降级不报错）', () => {
  const patterns: string[] = [];
  for (let i = 0; i < 100; i++) patterns.push('svc' + i + ':*');
  // 预算极小：几乎所有通配条件都进溢出表（仅少量入索引）
  const idx = new MatchIndex<number>();
  idx.rebuild(patterns.map((p, s) => ({ pattern: p, slot: s })), 2048);
  const stats = idx.stats();
  assert.ok(stats.indexedPatterns < 100, '小预算下应只有少量条件入索引');
  assert.ok(stats.overflowPatterns > 0, '小预算下应有溢出条件');
  // 溢出条件仍然正确命中
  const hit = idx.lookup('svc50:hello');
  assert.ok(hit.includes(50), '溢出条件 svc50:* 应命中事件 svc50:hello');
  assert.ok(!hit.includes(49), 'svc49:* 不应命中 svc50:hello');
  // 大预算下全部入索引
  idx.rebuild(patterns.map((p, s) => ({ pattern: p, slot: s })), 8 * 1024 * 1024);
  assert.equal(idx.stats().overflowPatterns, 0);
  assert.ok(idx.lookup('svc99:x').includes(99));
});

test('精确条件零正则：与事件名相等才命中', () => {
  const idx = new MatchIndex<number>();
  idx.rebuild([{ pattern: 'a.b', slot: 1 }, { pattern: 'a+b', slot: 2 }], 8 * 1024 * 1024);
  assert.deepEqual(idx.lookup('a.b'), [1]);
  assert.deepEqual(idx.lookup('a+b'), [2]);
  assert.deepEqual(idx.lookup('axb'), []);
  assert.deepEqual(idx.lookup('aab'), []);
});

test('同一条件多槽共享：全部命中', () => {
  const idx = new MatchIndex<string>();
  idx.rebuild(
    [{ pattern: 'job:*', slot: 'm1' }, { pattern: 'job:*', slot: 'm2' }, { pattern: 'job:*', slot: 'm3' }],
    8 * 1024 * 1024,
  );
  assert.deepEqual([...idx.lookup('job:go')].sort(), ['m1', 'm2', 'm3']);
});

test('stats 统计准确', () => {
  const idx = new MatchIndex<number>();
  idx.rebuild(
    [
      { pattern: 'exact:one', slot: 0 },
      { pattern: 'exact:two', slot: 1 },
      { pattern: 'a:*', slot: 2 },
      { pattern: 'b:*', slot: 3 },
      { pattern: '*:alert', slot: 4 },
      { pattern: 'x?y', slot: 5 },
    ],
    8 * 1024 * 1024,
  );
  const s = idx.stats();
  assert.equal(s.exactPatterns, 2);
  assert.equal(s.bucketPatterns, 3); // 'a:*'、'b:*'、'x?y'（键 'x'）
  assert.equal(s.globalPatterns, 1); // '*:alert'（通配开头）
  assert.equal(s.indexedPatterns, 6);
  assert.equal(s.overflowPatterns, 0);
  assert.equal(s.buckets, 3); // 'a:'、'b:'、'x'
  assert.ok(s.usedBytes > 0 && s.usedBytes <= s.budgetBytes);
});