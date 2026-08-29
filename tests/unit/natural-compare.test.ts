import { test } from 'node:test';
import assert from 'node:assert/strict';
import { naturalCompare } from '../../src/core/ConfigWatcher';

/**
 * 自然排序比较器（对标 Windows 资源管理器 StrCmpLogicalW）：
 *  - 数字按数值比较（m2 排在 m10 前），不是按字符逐位比较；
 *  - 大小写敏感（大写字母在前，Greeter 在 greeter 前，无平局）；
 *  - 数字段排在字符段前。
 */

function sorted(names: string[]): string[] {
  return [...names].sort(naturalCompare);
}

test('数字按数值比较：m2 排在 m10 前', () => {
  assert.deepEqual(sorted(['m10', 'm2', 'm1']), ['m1', 'm2', 'm10']);
  assert.deepEqual(sorted(['alpha-10', 'alpha-2', 'alpha']), ['alpha', 'alpha-2', 'alpha-10']);
  assert.deepEqual(sorted(['file2', 'file10', 'file1']), ['file1', 'file2', 'file10']);
});

test('混合名称：字符段字典序 + 数字段数值', () => {
  assert.deepEqual(sorted(['a10', 'a2', 'b1', 'a1']), ['a1', 'a2', 'a10', 'b1']);
});

test('大小写敏感：大写字母在前，排序确定', () => {
  // 码点：A(0x41) < a(0x61)，大小写敏感后顺序完全确定
  assert.deepEqual(sorted(['alpha', 'Alpha', 'ALPHA']), ['ALPHA', 'Alpha', 'alpha']);
  assert.deepEqual(sorted(['greeter', 'Greeter']), ['Greeter', 'greeter']);
});

test('数字段排在字符段前', () => {
  assert.deepEqual(sorted(['x', '2', 'a']), ['2', 'a', 'x']);
});

test('前导零：01 与 1 数值相等，长度短的在前', () => {
  assert.deepEqual(sorted(['01', '1', '001']), ['1', '01', '001']);
});

test('不同长度字符串：前缀相同时短串在前', () => {
  assert.deepEqual(sorted(['ab', 'abc', 'a']), ['a', 'ab', 'abc']);
});

test('自然排序确定性：相同输入多次排序结果一致', () => {
  const names = ['m10', 'm2', 'alpha-10', 'alpha-2', 'x1', 'X1'];
  const r1 = sorted(names);
  const r2 = sorted(names);
  assert.deepEqual(r1, r2);
});