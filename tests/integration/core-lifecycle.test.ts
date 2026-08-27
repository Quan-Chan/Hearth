import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, arr, yamlFor } from '../helpers';

/** 生成一组生命周期测试模块夹具。 */
function makeFixtures(dir: string): void {
  // boot：core:startup 启动，暴露数组并记录收到的事件
  fs.writeFileSync(
    path.join(dir, 'boot.cjs'),
    `module.exports = {
  name: 'boot',
  start(ctx) {
    ctx.exposeArray('marks', ['started']);
  },
  onEvent(ctx, event) {
    ctx.array('marks').push(event.name);
  },
};
`,
  );
  // lazy：只有 lazy:go 事件才启动
  fs.writeFileSync(
    path.join(dir, 'lazy.cjs'),
    `module.exports = {
  name: 'lazy',
  onEvent(ctx, event) {
    ctx.array('marks').push(event.name);
  },
  start(ctx) {
    ctx.exposeArray('marks', ['lazy-started']);
  },
};
`,
  );
  // wild：通配符监听
  fs.writeFileSync(
    path.join(dir, 'wild.cjs'),
    `module.exports = {
  name: 'wild',
  start(ctx) { ctx.exposeArray('marks', []); },
  onEvent(ctx, event) { ctx.array('marks').push(event.name); },
};
`,
  );
  // boom：启动时抛错
  fs.writeFileSync(
    path.join(dir, 'boom.cjs'),
    `module.exports = {
  name: 'boom',
  start() { throw new Error('boom 模块启动失败'); },
};
`,
  );
  // badhandler：事件处理抛错
  fs.writeFileSync(
    path.join(dir, 'badhandler.cjs'),
    `module.exports = {
  name: 'badhandler',
  start(ctx) { ctx.exposeArray('marks', []); },
  onEvent() { throw new Error('badhandler 处理出错'); },
};
`,
  );
  fs.writeFileSync(path.join(dir, 'boot.yaml'), yamlFor('boot', { startEvents: ['core:startup'], listen: ['*:chat:message', '*:chat:reply'] }));
  fs.writeFileSync(path.join(dir, 'lazy.yaml'), yamlFor('lazy', { startEvents: ['*:lazy:go'], listen: ['*:lazy:go'] }));
  fs.writeFileSync(path.join(dir, 'wild.yaml'), yamlFor('wild', { startEvents: ['core:startup'], listen: ['*:wild:*'] }));
  fs.writeFileSync(path.join(dir, 'boom.yaml'), yamlFor('boom', { startEvents: ['core:startup'] }));
  fs.writeFileSync(path.join(dir, 'badhandler.yaml'), yamlFor('badhandler', { startEvents: ['core:startup'], listen: ['*:chat:message'] }));
}

function makeCore(dir: string): ConnectCore {
  return new ConnectCore({ moduleDir: dir, watch: false });
}

test('启动核心 == 启动整个软件：core:startup 自动启动匹配模块', async () => {
  const dir = mkTmpDir('life');
  try {
    makeFixtures(dir);
    const core = makeCore(dir);
    await core.start();
    // 模块自动启动（无需手动 startModule）
    assert.equal(core.getModule('boot')!.status, 'running');
    assert.equal(core.getModule('wild')!.status, 'running');
    assert.equal(core.getModule('boom')!.status, 'failed');
    assert.equal(core.getModule('lazy')!.status, 'stopped'); // 启动事件未出现
    // 启动时暴露的数组可用
    assert.deepEqual(arr(core as any, 'public:boot:marks'), ['started']);
    // 事件流水：核心启动事件原样记录（无模块监听 -> 记录为 event-drop，符合新语义）
    const drops = core.log.byType('event-drop');
    assert.equal(drops[0].event, 'core:startup');
    assert.equal(drops[0].source, 'core');
    // 附注：因为 startup 无监听者，任何以 core:startup 为启动条件的模块仍会先行启动（启动比对在丢弃判定之前）
    const starts = core.log.byType('module-start');
    assert.ok(starts.every((s) => s.reason === 'core:startup'));
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('事件路由：精确匹配 + 通配符匹配，非监听者不收', async () => {
  const dir = mkTmpDir('life');
  try {
    makeFixtures(dir);
    const core = makeCore(dir);
    await core.start();
    await core.sendEvent('chat:message', { text: 'hi' }, 'tester');
    assert.deepEqual(arr(core as any, 'public:boot:marks'), ['started', 'tester:chat:message']);
    // badhandler 也监听 chat:message：它抛错，但日志记录且不影响其他模块
    assert.equal(core.log.byType('error').filter((e) => String(e.message).includes('处理事件')).length, 1);
    // wild 通配符收不到 chat:message
    assert.deepEqual(arr(core as any, 'public:wild:marks'), []);
    await core.sendEvent('wild:ping');
    assert.deepEqual(arr(core as any, 'public:wild:marks'), ['external:wild:ping']);
    // lazy 未启动，收不到事件
    await core.sendEvent('lazy:go', { v: 1 }, 'tester');
    assert.equal(core.getModule('lazy')!.status, 'running'); // 事件触发启动
    assert.deepEqual(arr(core as any, 'public:lazy:marks'), ['lazy-started', 'tester:lazy:go']); // 启动后也收到了事件
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('框架核心方法：startModule / stopModule / sendEvent', async () => {
  const dir = mkTmpDir('life');
  try {
    makeFixtures(dir);
    const core = makeCore(dir);
    await core.start();
    // 手动停止与启动
    await core.stopModule('boot');
    assert.equal(core.getModule('boot')!.status, 'stopped');
    assert.ok(core.log.byType('module-stop').some((s) => s.module === 'boot'));
    await core.startModule('boot', 'manual');
    assert.equal(core.getModule('boot')!.status, 'running');
    // 未知模块抛错
    await assert.rejects(() => core.startModule('ghost'), /未知模块/);
    await assert.rejects(() => core.stopModule('ghost'), /未知模块/);
    // 重复启动/停止不报错，仅记录跳过
    await core.startModule('boot');
    assert.equal(core.log.byType('module-skip').filter((s) => s.reason === 'already-running').length, 1);
    await core.stopModule('lazy'); // 未运行
    assert.equal(core.log.byType('module-skip').filter((s) => s.reason === 'not-running').length, 1);
    // sendEvent 事件名校验
    await assert.rejects(() => core.sendEvent(''), /非空字符串/);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('模块失败隔离：启动失败/事件处理失败不影响核心与其他模块', async () => {
  const dir = mkTmpDir('life');
  try {
    makeFixtures(dir);
    const core = makeCore(dir);
    await core.start();
    assert.equal(core.getModule('boom')!.status, 'failed');
    // 失败原因在日志（error 类型，含"启动失败"），状态不重复保存
    assert.equal(core.log.byType('error').filter((e) => String(e.message).includes('启动失败')).length, 1);
    // 核心仍然工作
    await core.sendEvent('wild:ok');
    assert.deepEqual(arr(core as any, 'public:wild:marks'), ['external:wild:ok']);
    // badhandler 抛错被记录，boot 仍收到事件
    await core.sendEvent('chat:message', { text: 'x' });
    assert.equal(core.log.byType('error').filter((e) => String(e.message).includes('处理事件')).length, 1);
    assert.deepEqual(arr(core as any, 'public:boot:marks'), ['started', 'external:chat:message']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('关闭：全部模块返回"已关闭"后核心关闭，之后不能再发事件', async () => {
  const dir = mkTmpDir('life');
  try {
    makeFixtures(dir);
    const core = makeCore(dir);
    await core.start();
    const started = core.listModules().filter((m) => m.status === 'running').map((m) => m.name);
    await core.stop();
    // ① 每个运行过的模块都走了停止（stop() 返回 = 已关闭；停止是并行触发，不承诺顺序）
    const stopModules = new Set(core.log.byType('module-stop').map((s) => s.module as string));
    for (const name of started) assert.ok(stopModules.has(name), name + ' 已完成停止');
    // badhandler 的 stop 不存在但仍应视为已关闭（stop() 未定义 = 立即返回）——boot 覆盖
    assert.equal(core.log.byType('core-stop').length, 1);
    assert.equal(core.started, false);
    // 停止后不能发送事件
    await assert.rejects(() => core.sendEvent('x'), /未启动/);
  } finally {
    rmDir(dir);
  }
});

test('事件丢弃：无人监听的事件记录 event-drop', async () => {
  const dir = mkTmpDir('life');
  try {
    makeFixtures(dir);
    const core = makeCore(dir);
    await core.start();
    // nobody:listens 没有任何模块监听（也没有模块以此为启动事件）；事件名为两段式
    await core.sendEvent('nobody:listens', { x: 1 }, 'tester');
    const drops = core.log.byType('event-drop').filter((e) => e.event === 'tester:nobody:listens');
    assert.equal(drops.length, 1);
    assert.equal(drops[0].source, 'tester');
    assert.equal(drops[0].message, 'tester:nobody:listens');
    // 有监听的正常事件不产生 event-drop
    await core.sendEvent('wild:ok');
    assert.equal(core.log.byType('event-drop').filter((e) => e.event === 'tester:nobody:listens').length, 1);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('重复启动抛错', async () => {
  const dir = mkTmpDir('life');
  try {
    makeFixtures(dir);
    const core = makeCore(dir);
    await core.start();
    await assert.rejects(() => core.start(), /已经启动/);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});