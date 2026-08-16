import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, yamlFor } from '../helpers';

function makeDir(dir: string): void {
  fs.writeFileSync(
    path.join(dir, 'producer.cjs'),
    `module.exports = {
  name: 'producer',
  start(ctx) {
    ctx.exposeArray('shared:items', [{ id: 1 }, { id: 2 }]);
    ctx.exposeArray('producer:own', ['p']);
  },
};
`,
  );
  fs.writeFileSync(
    path.join(dir, 'consumer.cjs'),
    `module.exports = {
  name: 'consumer',
  start(ctx) {
    ctx.exposeArray('consumer:own', []);
  },
  onEvent(ctx, event) {
    if (event.name === 'consume') {
      const items = ctx.pullArray('shared:items');
      ctx.editArray('shared:items', { type: 'push', value: { id: items.length + 1 } });
    }
  },
};
`,
  );
  fs.writeFileSync(path.join(dir, 'producer.yaml'), yamlFor('producer', { startEvents: ['core:startup'] }));
  fs.writeFileSync(path.join(dir, 'consumer.yaml'), yamlFor('consumer', { startEvents: ['core:startup'], listen: ['consume'] }));
}

test('模块间公共数组：拉取快照、编辑内容、拥有者可见', async () => {
  const dir = mkTmpDir('arr');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    assert.deepEqual(core.listArrays().sort(), ['consumer:own', 'producer:own', 'shared:items']);
    assert.equal(core.arrayOwner('shared:items'), 'producer');
    // 消费者拉取快照并编辑
    await core.sendEvent('consume');
    await core.sendEvent('consume');
    // 拥有者再次拉取可见变化
    assert.deepEqual(core.pullArray('shared:items'), [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('取消公开：仅拥有者可以，取消后他人不可拉取', async () => {
  const dir = mkTmpDir('arr');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    // 消费者不能取消别人的数组
    assert.throws(() => core.unexposeArray('shared:items', 'consumer'), /无权取消公开/);
    // 拥有者可以
    core.unexposeArray('shared:items', 'producer');
    assert.deepEqual(core.listArrays(), ['consumer:own', 'producer:own']);
    assert.throws(() => core.pullArray('shared:items'), /不存在/);
    // 不同拥有者重名公开抛错；同拥有者重新公开 = 重置
    assert.throws(() => core.exposeArray('producer:own', 'consumer', []), /已存在/);
    core.exposeArray('producer:own', 'producer', ['reset']);
    assert.deepEqual(core.pullArray('producer:own'), ['reset']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('核心直接操作公共数组 + 编辑操作完整生效', async () => {
  const dir = mkTmpDir('arr');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    core.exposeArray('admin:list', 'admin', ['a', 'b', 'c']);
    core.editArray('admin:list', { type: 'removeAt', index: 1 });
    core.editArray('admin:list', { type: 'unshift', value: 'z' });
    core.editArray('admin:list', { type: 'push', values: ['d', 'e'] });
    assert.deepEqual(core.pullArray('admin:list'), ['z', 'a', 'c', 'd', 'e']);
    // 编辑不存在的数组抛错
    assert.throws(() => core.editArray('nope', { type: 'push', value: 1 }), /不存在/);
    // 数组编辑被记录到事件流水
    assert.ok(core.log.byType('array:edit').length >= 3);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});
