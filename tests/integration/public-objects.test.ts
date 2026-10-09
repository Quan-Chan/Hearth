import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { Hearth } from '../../src/core/Hearth';
import { mkTmpDir, rmDir, items, sleep, yamlFor } from '../helpers';

/** 匹配拉取全名清单（通配方式）。 */
function objectNames(core: Hearth): string[] {
  return Object.keys(core.object('*') as Record<string, unknown>);
}

function makeDir(dir: string): void {
  fs.writeFileSync(
    path.join(dir, 'producer.cjs'),
    `module.exports = {
  name: 'producer',
  start(ctx) {
    ctx.exposeObject('items', { items: [{ id: 1 }, { id: 2 }] });
    ctx.exposeObject('own', { items: ['p'] });
  },
};
`,
  );
  fs.writeFileSync(
    path.join(dir, 'consumer.cjs'),
    `module.exports = {
  name: 'consumer',
  start(ctx) {
    ctx.exposeObject('own', { items: [] });
  },
  onEvent(ctx, event) {
    if (event.name.endsWith(':consume')) {
      // 模块 B 编辑模块 A 公开的对象：直接拿引用，原生操作
      const target = ctx.object('public:producer:items');
      target.items.push({ id: target.items.length + 1 });
    }
  },
};
`,
  );
  fs.writeFileSync(path.join(dir, 'producer.yaml'), yamlFor('producer', { startEvents: ['core:startup'] }));
  fs.writeFileSync(path.join(dir, 'consumer.yaml'), yamlFor('consumer', { startEvents: ['core:startup'], listen: ['*:consume'] }));
}

test('一次修改处处有效：A 公开 -> B 编辑 -> C（核心）读取可见', async () => {
  const dir = mkTmpDir('obj');
  try {
    makeDir(dir);
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    assert.deepEqual(objectNames(core).sort(), ['public:consumer:own', 'public:producer:items', 'public:producer:own']);
    // 模块 B（consumer）编辑模块 A（producer）公开的对象（原生引用）
    await core.sendEvent('consume');
    await core.sendEvent('consume');
    // C 读取可见 B 的修改
    assert.deepEqual(items(core, 'public:producer:items'), [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    // 拿到的始终是同一个对象引用
    assert.equal(items(core, 'public:producer:items'), items(core, 'public:producer:items'));
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('取消公开：仅拥有者可以，取消后他人不可拉取', async () => {
  const dir = mkTmpDir('obj');
  try {
    makeDir(dir);
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    // 消费者不能取消别人的对象（消费者名下不存在该对象）
    assert.throws(() => core.unexposeObject('items', 'consumer'), /not found/);
    // 拥有者可以
    core.unexposeObject('items', 'producer');
    assert.deepEqual(objectNames(core).sort(), ['public:consumer:own', 'public:producer:own']);
    assert.throws(() => items(core, 'public:producer:items'), /not found/);
    // 同拥有者重复公开自己的对象：抛错（不同拥有者的同名第三段不冲突）
    assert.throws(() => core.exposeObject('own', 'producer', { items: [] }), /already exists/);
    core.exposeObject('extra', 'consumer', { items: [] });
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('模块停止：其公开对象自动消失，不留残档；重启后是全新对象', async () => {
  const dir = mkTmpDir('obj');
  try {
    makeDir(dir);
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    assert.deepEqual(objectNames(core).sort(), ['public:consumer:own', 'public:producer:items', 'public:producer:own']);
    // 停止 producer -> 它的对象全部消失
    await core.stopModule('producer');
    assert.deepEqual(objectNames(core).sort(), ['public:consumer:own']);
    assert.throws(() => items(core, 'public:producer:items'), /not found/);
    assert.throws(() => items(core, 'public:producer:own'), /not found/);
    assert.ok(core.log.byType('module-stop').some((s) => s.source === 'producer' && Array.isArray(s.removedObjects) && s.removedObjects.length === 2));
    // 重启 producer -> 重新映射全新对象（旧数据不残留）
    await core.startModule('producer', 'manual');
    assert.deepEqual(items(core, 'public:producer:own'), ['p']);
    assert.deepEqual(items(core, 'public:producer:items'), [{ id: 1 }, { id: 2 }]);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('匹配拉取通配：按模式取多个对象', async () => {
  const dir = mkTmpDir('obj');
  try {
    makeDir(dir);
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    const matches = core.object('public:producer:*') as Record<string, unknown>;
    assert.deepEqual(Object.keys(matches).sort(), ['public:producer:items', 'public:producer:own']);
    const all = core.object('*') as Record<string, unknown>;
    assert.equal(Object.keys(all).length, 3);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('核心直接操作公共对象（原生引用操作，对象操作不记日志）', async () => {
  const dir = mkTmpDir('obj');
  try {
    makeDir(dir);
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    core.exposeObject('list', 'admin', { items: ['a', 'b', 'c'] });
    const list = items(core, 'public:admin:list');
    list.splice(1, 1);
    list.unshift('z');
    list.push('d', 'e');
    assert.deepEqual(items(core, 'public:admin:list'), ['z', 'a', 'c', 'd', 'e']);
    // 拉取不存在的对象抛错
    assert.throws(() => (core.object as any)('public:admin:nope'), /not found/);
    // 对象操作不产生任何日志（高频编辑不会爆日志）
    const arrayLogs = core.log.all().filter((e) => String(e.type).startsWith('array'));
    assert.equal(arrayLogs.length, 0);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

/** 公开对象的拥有者：onEvent 停在 gate 上，放行后尝试公开新对象。 */
function makeLateExposer(dir: string): void {
  fs.writeFileSync(
    path.join(dir, 'late.cjs'),
    `const fs = require('fs');
const path = require('path');
const GATE = path.join(__dirname, 'late.gate');
const RESULT = path.join(__dirname, 'late-result');
module.exports = {
  name: 'late',
  start(ctx) { ctx.exposeObject('marks', { items: ['started'] }); },
  async onEvent(ctx, event) {
    if (!event.name.endsWith(':late:expose')) return;
    while (!fs.existsSync(GATE)) await new Promise((r) => setTimeout(r, 10));
    let outcome = 'exposed';
    try { ctx.exposeObject('late', { items: ['leak'] }); } catch (err) { outcome = String(err && err.message); }
    fs.writeFileSync(RESULT, outcome);
  },
};
`,
  );
  fs.writeFileSync(path.join(dir, 'late.yaml'), yamlFor('late', { startEvents: ['core:startup'], listen: ['*:late:expose'] }));
}

/** 停止钩子挂起 500ms 的模块：让停机窗口覆盖在途 onEvent 的收尾。 */
const SLOW_STOP_CJS = `module.exports = {
  name: 'slowstop',
  start(ctx) { ctx.exposeObject('m', { items: [] }); },
  stop() { return new Promise((r) => setTimeout(r, 500)); },
};
`;

test('核心停机：在途 onEvent 的新公开被拒绝，停机后按名字取不到对象', async () => {
  const dir = mkTmpDir('obj-stop');
  try {
    makeLateExposer(dir);
    fs.writeFileSync(path.join(dir, 'slowstop.cjs'), SLOW_STOP_CJS);
    fs.writeFileSync(path.join(dir, 'slowstop.yaml'), yamlFor('slowstop', { startEvents: ['core:startup'] }));
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false, stopTimeoutMs: 5000 });
    await core.start();
    assert.deepEqual(items(core, 'public:late:marks'), ['started']);
    // 事件在途：onEvent 停在 gate 上（不等待 sendEvent 返回）
    const pending = core.sendEvent('late:expose');
    await sleep(50);
    // 开始停机不等待完成：late 的 stop() 返回、其公开对象注销都发生在放行之前
    const stopping = core.stop();
    await sleep(150);
    assert.equal(core.stopping, true);
    assert.throws(() => items(core, 'public:late:marks'), /not found/);
    fs.writeFileSync(path.join(dir, 'late.gate'), '');
    await pending;
    const outcome = fs.readFileSync(path.join(dir, 'late-result'), 'utf8');
    assert.match(outcome, /is stopping/, '停机期间 exposeObject 抛错，实际：' + outcome);
    await stopping;
    assert.equal(core.started, false);
    assert.throws(() => items(core, 'public:late:late'), /not found/);
  } finally {
    rmDir(dir);
  }
});
