import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventMatches, anyEventMatches, patternToRegExp } from '../../src/core/EventMatcher';

test('精确匹配：相同字符串才匹配', () => {
  assert.equal(eventMatches('core:startup', 'core:startup'), true);
  assert.equal(eventMatches('core:startup', 'core:shutdown'), false);
  assert.equal(eventMatches('chat:message', 'chat:message:extra'), false);
});

test('通配符 *：匹配任意字符序列', () => {
  assert.equal(eventMatches('chat:*', 'chat:message'), true);
  assert.equal(eventMatches('chat:*', 'chat:'), true);
  assert.equal(eventMatches('chat:*', 'chat'), false);
  assert.equal(eventMatches('*', 'anything:at:all'), true);
  assert.equal(eventMatches('a*b', 'axxxb'), true);
  assert.equal(eventMatches('a*b', 'ab'), true);
});

test('通配符 ?：匹配单个字符', () => {
  assert.equal(eventMatches('a?c', 'abc'), true);
  assert.equal(eventMatches('a?c', 'ac'), false);
  assert.equal(eventMatches('a?c', 'abbc'), false);
});

test('正则特殊字符按字面处理', () => {
  assert.equal(eventMatches('a.b', 'a.b'), true);
  assert.equal(eventMatches('a.b', 'axb'), false);
  assert.equal(eventMatches('a+b', 'a+b'), true);
  assert.equal(eventMatches('a+b', 'aaab'), false);
});

test('anyEventMatches：未定义/空列表不匹配，任一命中即匹配', () => {
  assert.equal(anyEventMatches(undefined, 'x'), false);
  assert.equal(anyEventMatches([], 'x'), false);
  assert.equal(anyEventMatches(['a', 'b:*'], 'b:1'), true);
  assert.equal(anyEventMatches(['a', 'b:*'], 'c'), false);
});

test('patternToRegExp 输出正确的正则', () => {
  assert.equal(patternToRegExp('chat:*').test('chat:message'), true);
  assert.equal(patternToRegExp('chat:*').test('chat'), false);
  assert.equal(patternToRegExp('core:startup').test('core:startup'), true);
});

test('非字符串输入不匹配', () => {
  assert.equal(eventMatches('*', '' as any), true); // 空串也匹配 *
  assert.equal(eventMatches(undefined as any, 'x'), false);
  assert.equal(eventMatches('x', undefined as any), false);
});
