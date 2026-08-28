/**
 * MatchIndex 单元测试：与 anyEventMatches 全量比对逐字对拍（匹配规则零变化），
 * 覆盖精确、通配、问号、正则特殊字符与多槽共享。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchIndex } from '../../src/core/MatchIndex';
import { anyEventMatches } from '../../src/core/EventMatcher';

/** 确定性伪随机（不依赖 Math.random，可复现）。 */
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
function checkAgainstBruteForce(patterns: string[], eventNames: string[]): void {
  const idx = new MatchIndex<number>();
  idx.rebuild(patterns.map((pattern, slot) => ({ pattern, slot })));
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

test('索引与全量比对匹配结果逐字一致（精确/通配/问号/正则特殊字符/全通配）', () => {
  const rand = mulberry32(42);
  const patterns = [
    'core:startup', // 精确
    'a.b', // 精确 + 正则特殊字符
    'chat:*', // 通配
    'chat:msg:*', // 通配（多段）
    'job:*', // 通配（多槽共享）
    '*', // 全通配
    '*:alert', // 通配开头
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
  checkAgainstBruteForce(patterns, eventNames);
});

test('大量随机模式对拍：精确表与通配列表的划分不改变匹配结果', () => {
  const rand = mulberry32(2026);
  const patterns: string[] = [];
  for (let i = 0; i < 200; i++) {
    const kind = rand();
    if (kind < 0.3) patterns.push('svc' + i + ':act' + (i % 4)); // 精确
    else if (kind < 0.7) patterns.push('svc' + i + ':*'); // 通配
    else if (kind < 0.9) patterns.push('area' + (i % 7) + ':event*'); // 中段通配
    else patterns.push('*:flag' + (i % 5)); // 通配开头
  }
  const eventNames: string[] = [];
  for (let i = 0; i < 1000; i++) {
    eventNames.push(
      'svc' + Math.floor(rand() * 250) + ':' + (rand() > 0.5 ? 'act' + Math.floor(rand() * 4) : 'x' + Math.floor(rand() * 9).toString(36)),
    );
  }
  checkAgainstBruteForce(patterns, eventNames);
});

test('精确条件零正则：与事件名相等才命中', () => {
  const idx = new MatchIndex<number>();
  idx.rebuild([{ pattern: 'a.b', slot: 1 }, { pattern: 'a+b', slot: 2 }]);
  assert.deepEqual(idx.lookup('a.b'), [1]);
  assert.deepEqual(idx.lookup('a+b'), [2]);
  assert.deepEqual(idx.lookup('axb'), []);
  assert.deepEqual(idx.lookup('aab'), []);
});

test('同一条件多槽共享：全部命中', () => {
  const idx = new MatchIndex<string>();
  idx.rebuild([
    { pattern: 'job:*', slot: 'm1' },
    { pattern: 'job:*', slot: 'm2' },
    { pattern: 'job:*', slot: 'm3' },
  ]);
  assert.deepEqual([...idx.lookup('job:go')].sort(), ['m1', 'm2', 'm3']);
});