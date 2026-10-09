import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectRegistry, objectKey } from '../../src/core/ObjectRegistry';

/**
 * ObjectRegistry 单元测试：只覆盖集成层（public-objects）走不到的输入校验。
 * 注册表行为（三段式名、精确/通配拉取、取消映射、拥有者消失）由
 * tests/integration/public-objects.test.ts 通过核心真实链路覆盖，这里不重复。
 */

test('对象名拼装：public:模块名:对象名', () => {
  assert.equal(objectKey('mod-a', 'items'), 'public:mod-a:items');
});

test('expose 输入校验：空名、非对象取值抛错', () => {
  const r = new ObjectRegistry();
  assert.throws(() => r.expose('', 'mod-b'), /non-empty string/);
  assert.throws(() => r.expose('x', 'mod-b', 'not-object' as any), /must be an object/);
  assert.throws(() => r.expose('x', 'mod-b', null as any), /must be an object/);
  // 不同拥有者的同名第三段不冲突
  r.expose('items', 'mod-a', { items: [] });
  r.expose('items', 'mod-c', { a: 1 });
  assert.deepEqual(r.get('public:mod-c:items'), { a: 1 });
});
