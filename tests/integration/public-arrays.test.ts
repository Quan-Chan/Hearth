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
      // 模块 B 编辑模块 A 公开的数组：直接拿引用，原生操作
      const items = ctx.array('shared:items');
      items.push({ id: items.length + 1 });
    }
  },
};
`,
  );
  fs.writeFileSync(path.join(dir, 'producer.yaml'), yamlFor('producer', { startEvents: ['core:startup'] }));
  fs.writeFileSync(path.join(dir, 'consumer.yaml'), yamlFor('consumer', { startEvents: ['core:startup'], listen: ['consume'] }));
}

test('一次修改处处有效：A 公开 -> B 编辑 -> C（核心）读取可见', async () => {
  const dir = mkTmpDir('arr');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    assert.deepEqual(core.listArrays().sort(), ['consumer:own', 'producer:own', 'shared:items']);
    assert.equal(core.arrayOwner('shared:items'), 'producer');
    // 模块 B（consumer）编辑模块 A（producer）公开的数组（原生引用）
    await core.sendEvent('consume');
    await core.sendEvent('consume');
    // C 读取可见 B 的修改
    assert.deepEqual(core.array('shared:items'), [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    // 拿到的始终是同一个对象引用
    assert.equal(core.array('shared:items'), core.array('shared:items'));
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
    assert.throws(() => core.array('shared:items'), /不存在/);
    // 重复公开（无论谁）都是误用，抛错
    assert.throws(() => core.exposeArray('producer:own', 'consumer', []), /已存在/);
    assert.throws(() => core.exposeArray('producer:own', 'producer', []), /已存在/);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('模块停止：其公开数组自动消失，不留残档；重启后是全新数组', async () => {
  const dir = mkTmpDir('arr');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    assert.deepEqual(core.listArrays().sort(), ['consumer:own', 'producer:own', 'shared:items']);
    // 停止 producer -> 它的数组全部消失
    await core.stopModule('producer');
    assert.deepEqual(core.listArrays(), ['consumer:own']);
    assert.throws(() => core.array('shared:items'), /不存在/);
    assert.throws(() => core.array('producer:own'), /不存在/);
    assert.ok(core.log.byType('module-stop').some((s) => s.module === 'producer' && Array.isArray(s.removedArrays) && s.removedArrays.length === 2));
    // 重启 producer -> 重新映射全新数组（旧数据不残留）
    await core.startModule('producer', 'manual');
    assert.deepEqual(core.array('producer:own'), ['p']);
    assert.deepEqual(core.array('shared:items'), [{ id: 1 }, { id: 2 }]);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('核心直接操作公共数组（受控编辑 + 快照）', async () => {
  const dir = mkTmpDir('arr');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    core.exposeArray('admin:list', 'admin', ['a', 'b', 'c']);
    core.editArray('admin:list', { type: 'removeAt', index: 1 });
    core.editArray('admin:list', { type: 'unshift', value: 'z' });
    core.editArray('admin:list', { type: 'push', values: ['d', 'e'] });
    assert.deepEqual(core.array('admin:list'), ['z', 'a', 'c', 'd', 'e']);
    // 快照隔离
    const snap = core.snapshotArray('admin:list');
    snap.length = 0;
    assert.deepEqual(core.array('admin:list'), ['z', 'a', 'c', 'd', 'e']);
    // 编辑不存在的数组抛错
    assert.throws(() => core.editArray('nope', { type: 'push', value: 1 }), /不存在/);
    // 数组操作不产生任何日志（高频编辑不会爆日志）
    const arrayLogs = core.log.all().filter((e) => String(e.type).startsWith('array'));
    assert.equal(arrayLogs.length, 0);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});
