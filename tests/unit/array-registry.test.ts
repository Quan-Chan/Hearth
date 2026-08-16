import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayRegistry } from '../../src/core/ArrayRegistry';

function makeRegistry(): ArrayRegistry {
  const r = new ArrayRegistry();
  r.expose('items', 'mod-a', [{ id: 1 }, { id: 2 }]);
  return r;
}

test('expose + pull：返回深拷贝快照', () => {
  const r = makeRegistry();
  const snap = r.pull('items');
  assert.deepEqual(snap, [{ id: 1 }, { id: 2 }]);
  // 修改快照不影响注册表
  snap.push({ id: 3 });
  (snap[0] as any).id = 999;
  assert.deepEqual(r.pull('items'), [{ id: 1 }, { id: 2 }]);
});

test('expose：重名、非法名、非数组初始值都抛错', () => {
  const r = makeRegistry();
  assert.throws(() => r.expose('items', 'mod-b'), /已存在/);
  assert.throws(() => r.expose('', 'mod-b'), /非空字符串/);
  assert.throws(() => r.expose('x', 'mod-b', 'not-array' as any), /必须是数组/);
});

test('pull：不存在的数组抛错', () => {
  const r = makeRegistry();
  assert.throws(() => r.pull('nope'), /不存在/);
});

test('unexpose：仅拥有者可取消公开', () => {
  const r = makeRegistry();
  assert.throws(() => r.unexpose('items', 'mod-b'), /无权取消公开/);
  assert.throws(() => r.unexpose('nope', 'mod-a'), /不存在/);
  r.unexpose('items', 'mod-a');
  assert.equal(r.has('items'), false);
});

test('编辑操作：push / pop / shift / unshift', () => {
  const r = new ArrayRegistry();
  r.expose('a', 'm', []);
  r.edit('a', { type: 'push', value: 1 });
  r.edit('a', { type: 'push', values: [2, 3] });
  assert.deepEqual(r.pull('a'), [1, 2, 3]);
  r.edit('a', { type: 'pop' });
  assert.deepEqual(r.pull('a'), [1, 2]);
  r.edit('a', { type: 'shift' });
  assert.deepEqual(r.pull('a'), [2]);
  r.edit('a', { type: 'unshift', value: 0 });
  assert.deepEqual(r.pull('a'), [0, 2]);
});

test('编辑操作：set / removeAt / removeValue / splice / clear / apply', () => {
  const r = new ArrayRegistry();
  r.expose('a', 'm', [10, 20, 30, 40]);
  r.edit('a', { type: 'set', index: 1, value: 99 });
  assert.deepEqual(r.pull('a'), [10, 99, 30, 40]);
  r.edit('a', { type: 'removeAt', index: 0 });
  assert.deepEqual(r.pull('a'), [99, 30, 40]);
  r.edit('a', { type: 'removeValue', value: 30 });
  assert.deepEqual(r.pull('a'), [99, 40]);
  r.edit('a', { type: 'removeValue', value: 9999 }); // 不存在 -> no-op
  assert.deepEqual(r.pull('a'), [99, 40]);
  r.edit('a', { type: 'splice', index: 1, deleteCount: 1, insert: [7, 8] });
  assert.deepEqual(r.pull('a'), [99, 7, 8]);
  r.edit('a', { type: 'clear' });
  assert.deepEqual(r.pull('a'), []);
  r.edit('a', { type: 'apply', fn: (arr) => arr.map((x) => (x as number) * 2) });
  assert.deepEqual(r.pull('a'), []);
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
