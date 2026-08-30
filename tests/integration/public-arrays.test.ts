import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, arr, yamlFor } from '../helpers';

/** 匹配拉取全名清单（通配方式）。 */
function arrayNames(core: ConnectCore): string[] {
  return Object.keys(core.array('*') as Record<string, unknown>);
}

function makeDir(dir: string): void {
  fs.writeFileSync(
    path.join(dir, 'producer.cjs'),
    `module.exports = {
  name: 'producer',
  start(ctx) {
    ctx.exposeArray('items', [{ id: 1 }, { id: 2 }]);
    ctx.exposeArray('own', ['p']);
  },
};
`,
  );
  fs.writeFileSync(
    path.join(dir, 'consumer.cjs'),
    `module.exports = {
  name: 'consumer',
  start(ctx) {
    ctx.exposeArray('own', []);
  },
  onEvent(ctx, event) {
    if (event.name.endsWith(':consume')) {
      // 模块 B 编辑模块 A 公开的数组：直接拿引用，原生操作
      const items = ctx.array('public:producer:items');
      items.push({ id: items.length + 1 });
    }
  },
};
`,
  );
  fs.writeFileSync(path.join(dir, 'producer.yaml'), yamlFor('producer', { startEvents: ['core:startup'] }));
  fs.writeFileSync(path.join(dir, 'consumer.yaml'), yamlFor('consumer', { startEvents: ['core:startup'], listen: ['*:consume'] }));
}

test('一次修改处处有效：A 公开 -> B 编辑 -> C（核心）读取可见', async () => {
  const dir = mkTmpDir('arr');
  try {
    makeDir(dir);
    const core = new ConnectCore({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    assert.deepEqual(arrayNames(core).sort(), ['public:consumer:own', 'public:producer:items', 'public:producer:own']);
    // 模块 B（consumer）编辑模块 A（producer）公开的数组（原生引用）
    await core.sendEvent('consume');
    await core.sendEvent('consume');
    // C 读取可见 B 的修改
    assert.deepEqual(arr(core, 'public:producer:items'), [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    // 拿到的始终是同一个对象引用
    assert.equal(arr(core, 'public:producer:items'), arr(core, 'public:producer:items'));
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('取消公开：仅拥有者可以，取消后他人不可拉取', async () => {
  const dir = mkTmpDir('arr');
  try {
    makeDir(dir);
    const core = new ConnectCore({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    // 消费者不能取消别人的数组（消费者名下不存在该数组）
    assert.throws(() => core.unexposeArray('items', 'consumer'), /not found/);
    // 拥有者可以
    core.unexposeArray('items', 'producer');
    assert.deepEqual(arrayNames(core).sort(), ['public:consumer:own', 'public:producer:own']);
    assert.throws(() => arr(core, 'public:producer:items'), /not found/);
    // 同拥有者重复公开自己的数组：抛错（不同拥有者的同名第三段不冲突）
    assert.throws(() => core.exposeArray('own', 'producer', []), /already exists/);
    core.exposeArray('extra', 'consumer', []);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('模块停止：其公开数组自动消失，不留残档；重启后是全新数组', async () => {
  const dir = mkTmpDir('arr');
  try {
    makeDir(dir);
    const core = new ConnectCore({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    assert.deepEqual(arrayNames(core).sort(), ['public:consumer:own', 'public:producer:items', 'public:producer:own']);
    // 停止 producer -> 它的数组全部消失
    await core.stopModule('producer');
    assert.deepEqual(arrayNames(core).sort(), ['public:consumer:own']);
    assert.throws(() => arr(core, 'public:producer:items'), /not found/);
    assert.throws(() => arr(core, 'public:producer:own'), /not found/);
    assert.ok(core.log.byType('module-stop').some((s) => s.source === 'producer' && Array.isArray(s.removedArrays) && s.removedArrays.length === 2));
    // 重启 producer -> 重新映射全新数组（旧数据不残留）
    await core.startModule('producer', 'manual');
    assert.deepEqual(arr(core, 'public:producer:own'), ['p']);
    assert.deepEqual(arr(core, 'public:producer:items'), [{ id: 1 }, { id: 2 }]);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('匹配拉取通配：按模式取多个数组', async () => {
  const dir = mkTmpDir('arr');
  try {
    makeDir(dir);
    const core = new ConnectCore({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    const matches = core.array('public:producer:*') as Record<string, unknown[]>;
    assert.deepEqual(Object.keys(matches).sort(), ['public:producer:items', 'public:producer:own']);
    const all = core.array('*') as Record<string, unknown[]>;
    assert.equal(Object.keys(all).length, 3);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('核心直接操作公共数组（原生引用操作，数组操作不记日志）', async () => {
  const dir = mkTmpDir('arr');
  try {
    makeDir(dir);
    const core = new ConnectCore({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    core.exposeArray('list', 'admin', ['a', 'b', 'c']);
    const list = arr(core, 'public:admin:list');
    list.splice(1, 1);
    list.unshift('z');
    list.push('d', 'e');
    assert.deepEqual(arr(core, 'public:admin:list'), ['z', 'a', 'c', 'd', 'e']);
    // 拉取不存在的数组抛错
    assert.throws(() => (core.array as any)('public:admin:nope'), /not found/);
    // 数组操作不产生任何日志（高频编辑不会爆日志）
    const arrayLogs = core.log.all().filter((e) => String(e.type).startsWith('array'));
    assert.equal(arrayLogs.length, 0);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});