import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayRegistry } from '../../src/core/ArrayRegistry';

function makeRegistry(): ArrayRegistry {
  const r = new ArrayRegistry();
  r.expose('items', 'mod-a', [{ id: 1 }, { id: 2 }]);
  return r;
}

test('expose + get：返回实时引用，一次修改处处有效（原生数组语法）', () => {
  const r = makeRegistry();
  const a = r.get('items');
  assert.deepEqual(a, [{ id: 1 }, { id: 2 }]);
  // 每次 get 都是同一个被映射对象
  assert.equal(a, r.get('items'));
  // 原生数组语法修改，注册表立即可见
  a.push({ id: 3 });
  assert.equal(r.get('items').length, 3);
  a[0].id = 999;
  assert.equal(r.get('items')[0].id, 999);
  a[1] = { id: 20 };
  assert.deepEqual(r.get('items'), [{ id: 999 }, { id: 20 }, { id: 3 }]);
  // 原生方法全部可用
  const found = r.get('items').find((x) => x.id === 3);
  assert.equal(found.id, 3);
});

test('snapshot：显式深拷贝，隔离修改', () => {
  const r = makeRegistry();
  const snap = r.snapshot('items');
  snap.push({ id: 3 });
  (snap[0] as any).id = 999;
  assert.deepEqual(r.get('items'), [{ id: 1 }, { id: 2 }]); // 注册表不受影响
});

test('expose：重名、非法名、非数组内容都抛错', () => {
  const r = makeRegistry();
  assert.throws(() => r.expose('items', 'mod-b'), /已存在/);
  assert.throws(() => r.expose('', 'mod-b'), /非空字符串/);
  assert.throws(() => r.expose('x', 'mod-b', 'not-array' as any), /必须是数组/);
});

test('get：不存在的数组抛错', () => {
  const r = makeRegistry();
  assert.throws(() => r.get('nope'), /不存在/);
});

test('unexpose：仅拥有者可取消映射', () => {
  const r = makeRegistry();
  assert.throws(() => r.unexpose('items', 'mod-b'), /无权取消公开/);
  assert.throws(() => r.unexpose('nope', 'mod-a'), /不存在/);
  r.unexpose('items', 'mod-a');
  assert.equal(r.has('items'), false);
});

test('removeOwner：公开者消失，映射全部取消（数组自然消失，不留残档）', () => {
  const r = new ArrayRegistry();
  r.expose('a', 'm1', []);
  r.expose('b', 'm1', []);
  r.expose('c', 'm2', []);
  const removed = r.removeOwner('m1');
  assert.deepEqual(removed.sort(), ['a', 'b']);
  assert.deepEqual(r.list(), ['c']);
  assert.throws(() => r.get('a'), /不存在/);
  assert.throws(() => r.get('b'), /不存在/);
  // 再次移除不存在的拥有者 -> 空列表
  assert.deepEqual(r.removeOwner('m1'), []);
});

test('编辑操作：push / pop / shift / unshift（作用于被映射对象）', () => {
  const r = new ArrayRegistry();
  r.expose('a', 'm', []);
  r.edit('a', { type: 'push', value: 1 });
  r.edit('a', { type: 'push', values: [2, 3] });
  assert.deepEqual(r.get('a'), [1, 2, 3]);
  r.edit('a', { type: 'pop' });
  assert.deepEqual(r.get('a'), [1, 2]);
  r.edit('a', { type: 'shift' });
  assert.deepEqual(r.get('a'), [2]);
  r.edit('a', { type: 'unshift', value: 0 });
  assert.deepEqual(r.get('a'), [0, 2]);
});

test('编辑操作：set / removeAt / removeValue / splice / clear / apply', () => {
  const r = new ArrayRegistry();
  r.expose('a', 'm', [10, 20, 30, 40]);
  r.edit('a', { type: 'set', index: 1, value: 99 });
  assert.deepEqual(r.get('a'), [10, 99, 30, 40]);
  r.edit('a', { type: 'removeAt', index: 0 });
  assert.deepEqual(r.get('a'), [99, 30, 40]);
  r.edit('a', { type: 'removeValue', value: 30 });
  assert.deepEqual(r.get('a'), [99, 40]);
  r.edit('a', { type: 'removeValue', value: 9999 }); // 不存在 -> no-op
  assert.deepEqual(r.get('a'), [99, 40]);
  r.edit('a', { type: 'splice', index: 1, deleteCount: 1, insert: [7, 8] });
  assert.deepEqual(r.get('a'), [99, 7, 8]);
  r.edit('a', { type: 'clear' });
  assert.deepEqual(r.get('a'), []);
  r.edit('a', { type: 'apply', fn: (arr) => arr.map((x) => (x as number) * 2) });
  assert.deepEqual(r.get('a'), []);
});

test('编辑操作：越界与未知操作抛错', () => {
  const r = new ArrayRegistry();
  r.expose('a', 'm', [1]);
  assert.throws(() => r.edit('a', { type: 'set', index: 5, value: 1 }), /越界/);
  assert.throws(() => r.edit('a', { type: 'removeAt', index: -1 }), /越界/);
  assert.throws(() => r.edit('a', { type: 'bogus' } as any), /不支持的数组操作/);
  assert.throws(() => r.edit('nope', { type: 'push', value: 1 }), /不存在/);
});

test('编辑不会改变数组名（公共数组名不可变）', () => {
  const r = makeRegistry();
  r.edit('items', { type: 'push', value: 3 });
  assert.deepEqual(r.list(), ['items']);
  assert.equal(r.ownerOf('items'), 'mod-a');
});

test('ownerOf / has / list', () => {
  const r = makeRegistry();
  assert.equal(r.ownerOf('items'), 'mod-a');
  assert.equal(r.ownerOf('nope'), undefined);
  assert.equal(r.has('items'), true);
  assert.deepEqual(r.list(), ['items']);
});
