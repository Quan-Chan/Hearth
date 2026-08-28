import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayRegistry, arrayKey } from '../../src/core/ArrayRegistry';

/**
 * ArrayRegistry 单元测试：只覆盖集成层（public-arrays）走不到的输入校验。
 * 注册表行为（三段式名、精确/通配拉取、取消映射、拥有者消失）由
 * tests/integration/public-arrays.test.ts 通过核心真实链路覆盖，这里不重复。
 */

test('数组名拼装：public:模块名:数组名', () => {
  assert.equal(arrayKey('mod-a', 'items'), 'public:mod-a:items');
});

test('expose 输入校验：空名、非数组内容抛错', () => {
  const r = new ArrayRegistry();
  assert.throws(() => r.expose('', 'mod-b'), /非空字符串/);
  assert.throws(() => r.expose('x', 'mod-b', 'not-array' as any), /必须是数组/);
  // 不同拥有者的同名第三段不冲突
  r.expose('items', 'mod-a', []);
  r.expose('items', 'mod-c', []);
  assert.deepEqual(r.get('public:mod-c:items'), []);
});
