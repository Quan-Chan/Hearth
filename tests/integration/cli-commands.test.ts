/**
 * CLI 命令面测试：核心对 core:cli:* 管理指令的响应（可选 cli 模块依赖的命令层）。
 *
 * 覆盖：
 *  - start-module：无需事件也能启动模块
 *  - stop-module：强制关闭模块（数组随拥有者消失）
 *  - send-event：定向投递（目标无需声明 listen）+ '*' 广播
 *  - state：回复 core:cli:reply-state（模块清单 + 数组清单）
 *  - 未知 cli 指令不拦截、命令错误不破坏核心
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, yamlFor } from '../helpers';

function makeDir(dir: string): void {
  // echo：不监听任何事件（listen: []），只能被定向发送
  fs.writeFileSync(
    path.join(dir, 'echo.cjs'),
    `module.exports = {
  name: 'echo',
  start(ctx) { ctx.exposeArray('echo:out', []); },
  onEvent(ctx, event) { ctx.array('echo:out').push(event.name); },
};
`,
  );
  fs.writeFileSync(path.join(dir, 'echo.yaml'), 'name: echo\nfile: ./echo.cjs\nstartEvents: ["core:startup"]\nlisten: []\n');
  // listener：正常监听（与定向发送对照）
  fs.writeFileSync(
    path.join(dir, 'listener.cjs'),
    `module.exports = {
  name: 'listener',
  start(ctx) { ctx.exposeArray('listener:got', []); },
  onEvent(ctx, event) { ctx.array('listener:got').push(event.name); },
};
`,
  );
  fs.writeFileSync(path.join(dir, 'listener.yaml'), yamlFor('listener', { startEvents: ['core:startup'], listen: ['hello', 'ping:*'] }));
  // lazy：启动事件从不出现 -> 停着
  fs.writeFileSync(
    path.join(dir, 'lazy.cjs'),
    `module.exports = {
  name: 'lazy',
  start(ctx) { ctx.exposeArray('lazy:mark', ['started']); },
  onEvent() {},
};
`,
  );
  fs.writeFileSync(path.join(dir, 'lazy.yaml'), yamlFor('lazy', { startEvents: ['rare:start'], listen: ['rare:start'] }));
  // waiter：接收核心的 state 回复
  fs.writeFileSync(
    path.join(dir, 'waiter.cjs'),
    `module.exports = {
  name: 'waiter',
  start(ctx) { ctx.exposeArray('waiter:reply', []); },
  onEvent(ctx, event) { ctx.array('waiter:reply').push(event.data); },
};
`,
  );
  fs.writeFileSync(path.join(dir, 'waiter.yaml'), yamlFor('waiter', { startEvents: ['core:startup'], listen: ['core:cli:reply-state'] }));
}

test('cli:start-module 指令：无需事件也能启动模块', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    assert.equal(core.getModule('lazy')!.status, 'stopped'); // 启动事件未出现
    await core.sendEvent('core:cli:start-module', { name: 'lazy' }, 'cli');
    assert.equal(core.getModule('lazy')!.status, 'running');
    assert.deepEqual(core.array('lazy:mark'), ['started']);
    // 指令被记录为 cli-command
    assert.ok(core.log.byType('cli-command').some((l) => l.module === 'lazy' && l.command === 'start-module'));
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('cli:start-module 未知模块抛错，核心继续可用', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    await assert.rejects(() => core.sendEvent('core:cli:start-module', { name: 'ghost' }, 'cli'), /未知模块/);
    // 核心不受影响：普通事件照常路由
    await core.sendEvent('hello', { x: 1 }, 'tester');
    assert.deepEqual(core.array('listener:got'), ['hello']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('cli:stop-module 指令：强制关闭模块，其数组随之消失', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    await core.sendEvent('core:cli:stop-module', { name: 'echo' }, 'cli');
    assert.equal(core.getModule('echo')!.status, 'stopped');
    assert.ok(!core.listArrays().includes('echo:out')); // 数组随拥有者消失
    assert.ok(core.log.byType('module-stop').some((l) => l.module === 'echo'));
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('cli:send-event 指令：定向投递给不监听的模块，且不影响其他模块', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    // echo 的 listen 为空：普通发送必然丢弃，定向发送必须送达
    await core.sendEvent('direct:hi', { v: 1 }, 'tester'); // 普通路由 -> 无人监听
    assert.deepEqual(core.array('echo:out'), []);
    await core.sendEvent('core:cli:send-event', { targets: ['echo'], name: 'direct:hi', data: { v: 2 } }, 'cli');
    assert.deepEqual(core.array('echo:out'), ['direct:hi']);
    // listener 没被点到 -> 不收
    assert.deepEqual(core.array('listener:got'), []);
    // 日志记录定向发送的接收者
    const ev = core.log.byType('event').filter((l) => l.directed === true && l.event === 'direct:hi');
    assert.equal(ev.length, 1);
    assert.deepEqual(ev[0].recipients, ['echo']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('cli:send-event 指令 * 广播：发给所有运行中且有 onEvent 的模块', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    await core.sendEvent('core:cli:send-event', { targets: '*', name: 'everyone:go', data: { n: 1 } }, 'cli');
    assert.deepEqual(core.array('echo:out'), ['everyone:go']);
    assert.deepEqual(core.array('listener:got'), ['everyone:go']);
    // lazy 未运行 -> 不收（但 listener 的 ping:* 不匹配 everyone:go，说明是定向/广播通道送达，非 listen 匹配）
    assert.ok(!core.listArrays().includes('lazy:mark'));
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('cli:state 指令：回复 core:cli:reply-state，携带模块与数组清单', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    await core.sendEvent('core:cli:state', {}, 'cli');
    // waiter 收到回复并写入自己的公开数组
    const reply = core.array('waiter:reply')[0] as any;
    assert.ok(Array.isArray(reply.modules));
    const names = reply.modules.map((m: any) => m.name).sort();
    assert.deepEqual(names, ['echo', 'lazy', 'listener', 'waiter']);
    assert.equal(reply.modules.find((m: any) => m.name === 'lazy').status, 'stopped');
    assert.ok(reply.arrays.includes('echo:out'));
    assert.ok(reply.arrays.includes('waiter:reply'));
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('未知 core:cli:* 指令不拦截，作为普通事件处理', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    // 不认识的 cli 指令：不拦截、不抛错，走普通路由被丢弃
    await core.sendEvent('core:cli:bogus', {}, 'cli');
    assert.ok(core.log.byType('event-drop').some((l) => l.event === 'core:cli:bogus'));
    // 核心照常工作
    await core.sendEvent('ping:ok', {}, 'tester');
    assert.deepEqual(core.array('listener:got'), ['ping:ok']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});
