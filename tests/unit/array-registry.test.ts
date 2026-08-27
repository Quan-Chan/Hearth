import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayRegistry, arrayKey } from '../../src/core/ArrayRegistry';

function makeRegistry(): ArrayRegistry {
  const r = new ArrayRegistry();
  r.expose('items', 'mod-a', [{ id: 1 }, { id: 2 }]);
  return r;
}

test('三段式数组名：public:模块名:数组名，公开者只提供第三段', () => {
  assert.equal(arrayKey('mod-a', 'items'), 'public:mod-a:items');
  const r = new ArrayRegistry();
  r.expose('items', 'mod-a', []);
  assert.deepEqual(r.get('public:mod-a:items'), []);
});

test('expose + get：返回实时引用，一次修改处处有效（原生数组语法）', () => {
  const r = makeRegistry();
  const key = 'public:mod-a:items';
  const a = r.get(key);
  assert.deepEqual(a, [{ id: 1 }, { id: 2 }]);
  // 每次 get 都是同一个被映射对象
  assert.equal(a, r.get(key));
  // 原生数组语法修改，注册表立即可见
  a.push({ id: 3 });
  assert.equal((r.get(key) as any[]).length, 3);
  a[0].id = 999;
  assert.equal((r.get(key) as any[])[0].id, 999);
  a[1] = { id: 20 };
  assert.deepEqual(r.get(key) as any[], [{ id: 999 }, { id: 20 }, { id: 3 }]);
  // 原生方法全部可用
  const found = (r.get(key) as any[]).find((x) => x.id === 3);
  assert.equal(found.id, 3);
});

test('expose：重名、非法名、非数组内容都抛错（重名按三段式全名判断）', () => {
  const r = makeRegistry();
  assert.throws(() => r.expose('items', 'mod-a'), /已存在/); // 同拥有者重复公开
  assert.throws(() => r.expose('', 'mod-b'), /非空字符串/);
  assert.throws(() => r.expose('x', 'mod-b', 'not-array' as any), /必须是数组/);
  // 不同拥有者的同名第三段不冲突
  r.expose('items', 'mod-c', []);
  assert.deepEqual(r.get('public:mod-c:items'), []);
});

test('匹配拉取：不含通配符精确返回引用；含通配符返回 { 数组全名: 引用 } 映射', () => {
  const r = new ArrayRegistry();
  r.expose('a', 'm1', [1]);
  r.expose('b', 'm1', [2]);
  r.expose('a', 'm2', [3]);
  // 精确
  assert.deepEqual(r.get('public:m1:a'), [1]);
  // 通配：匹配任意
  const all = r.get('public:*:a') as Record<string, number[]>;
  assert.deepEqual(Object.keys(all).sort(), ['public:m1:a', 'public:m2:a']);
  // 单字符通配
  const one = r.get('public:m?:a') as Record<string, number[]>;
  assert.deepEqual(Object.keys(one).sort(), ['public:m1:a', 'public:m2:a']);
  // 匹配全部
  const every = r.get('*') as Record<string, number[]>;
  assert.equal(Object.keys(every).length, 3);
});

test('get：不存在的数组抛错（精确模式）', () => {
  const r = makeRegistry();
  assert.throws(() => r.get('public:mod-a:nope'), /不存在/);
});

test('unexpose：仅拥有者可取消映射', () => {
  const r = makeRegistry();
  // 非拥有者操作自己的名字空间：mod-b 名下没有 items，报不存在
  assert.throws(() => r.unexpose('nope', 'mod-a'), /不存在/);
  r.unexpose('items', 'mod-a');
  assert.throws(() => r.get('public:mod-a:items'), /不存在/);
});

test('removeOwner：公开者消失，映射全部取消（数组自然消失，不留残档）', () => {
  const r = new ArrayRegistry();
  r.expose('a', 'm1', []);
  r.expose('b', 'm1', []);
  r.expose('c', 'm2', []);
  const removed = r.removeOwner('m1');
  assert.deepEqual(removed.sort(), ['public:m1:a', 'public:m1:b']);
  assert.deepEqual(Object.keys(r.get('*') as Record<string, unknown>), ['public:m2:c']);
  assert.throws(() => r.get('public:m1:a'), /不存在/);
  // 再次移除不存在的拥有者 -> 空列表
  assert.deepEqual(r.removeOwner('m1'), []);
});