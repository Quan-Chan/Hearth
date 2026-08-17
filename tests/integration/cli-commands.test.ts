/**
 * CLI 门铃协议测试：CLI 与核心通过「事件=门铃、数组=内容」协作。
 *
 * 协议：
 *   cli:commands（CLI 拥有）：指令内容 [{id, cmd, args, status}]
 *   cli:request  事件（带 id）：请求门铃
 *   core:results（核心拥有）：执行结果 [{id, cmd, ok, result, error}]
 *   cli:done     事件（带 id）：完成门铃
 *
 * 覆盖：ping 往返 / 启动 / 关闭 / 生成事件 / 定向发送 / 广播 / 状态查询 /
 *       未知指令容错 / 找不到条目 / exit 关闭核心。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, yamlFor } from '../helpers';

const CMD_ARRAY = 'cli:commands';
const RESULT_ARRAY = 'core:results';

function makeDir(dir: string): void {
  // echo：不监听任何事件（listen: []），只能被定向发送
  fs.writeFileSync(
    path.join(dir, 'echo.cjs'),
    `module.exports = { name: 'echo', start(ctx){ ctx.exposeArray('echo:out', []); }, onEvent(ctx, event){ ctx.array('echo:out').push(event.name); } };`,
  );
  fs.writeFileSync(path.join(dir, 'echo.yaml'), 'name: echo\nfile: ./echo.cjs\nstartEvents: ["core:startup"]\nlisten: []\n');
  // listener：正常监听（与定向发送对照）
  fs.writeFileSync(
    path.join(dir, 'listener.cjs'),
    `module.exports = { name: 'listener', start(ctx){ ctx.exposeArray('listener:got', []); }, onEvent(ctx, event){ ctx.array('listener:got').push(event.name); } };`,
  );
  fs.writeFileSync(path.join(dir, 'listener.yaml'), yamlFor('listener', { startEvents: ['core:startup'], listen: ['hello', 'ping:*'] }));
  // lazy：启动事件从不出现 -> 停着，只能被 start 指令起来
  fs.writeFileSync(
    path.join(dir, 'lazy.cjs'),
    `module.exports = { name: 'lazy', start(ctx){ ctx.exposeArray('lazy:mark', ['started']); }, onEvent(){} };`,
  );
  fs.writeFileSync(path.join(dir, 'lazy.yaml'), yamlFor('lazy', { startEvents: ['rare:start'], listen: ['rare:start'] }));
  // donex：监听完成门铃，验证 cli:done 真的广播到了监听模块
  fs.writeFileSync(
    path.join(dir, 'donex.cjs'),
    `module.exports = { name: 'donex', start(ctx){ ctx.exposeArray('donex:bell', []); }, onEvent(ctx, event){ ctx.array('donex:bell').push({ id: event.data && event.data.id }); } };`,
  );
  fs.writeFileSync(path.join(dir, 'donex.yaml'), yamlFor('donex', { startEvents: ['core:startup'], listen: ['cli:done'] }));
}

/** 模拟 CLI 发起的请求：先写指令内容入数组，再响请求门铃。 */
async function submit(core: ConnectCore, id: number, cmd: string, args: Record<string, unknown> = {}): Promise<void> {
  core.array(CMD_ARRAY).push({ id, cmd, args, status: 'pending' });
  await core.sendEvent('cli:request', { id }, 'cli');
}

/** 取该 id 的执行结果。 */
function resultOf(core: ConnectCore, id: number): any {
  return core.array(RESULT_ARRAY).find((r) => r.id === id);
}

test('ping 门铃往返：完成门铃广播 + 结果写入 core:results（核心拥有的数组）', async () => {
  const dir = mkTmpDir('clip');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    core.exposeArray(CMD_ARRAY, 'cli', []); // 测试用：模拟 CLI 的信箱
    await submit(core, 1, 'ping');
    assert.equal(core.arrayOwner(RESULT_ARRAY), 'core'); // 结果数组由核心提供（惰性创建）
    assert.equal(resultOf(core, 1).ok, true);
    assert.equal(resultOf(core, 1).result, 'pong');
    assert.deepEqual(core.array('donex:bell'), [{ id: 1 }]); // 完成门铃送达监听模块
    assert.ok(core.log.byType('cli-command').some((l) => l.command === 'ping'));
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('start 指令：无需事件也能启动模块', async () => {
  const dir = mkTmpDir('clis');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    core.exposeArray(CMD_ARRAY, 'cli', []);
    assert.equal(core.getModule('lazy')!.status, 'stopped');
    await submit(core, 2, 'start', { module: 'lazy' });
    assert.equal(core.getModule('lazy')!.status, 'running');
    assert.equal(resultOf(core, 2).result.status, 'running');
    assert.deepEqual(core.array('lazy:mark'), ['started']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('stop 指令：关闭模块，其数组随之消失', async () => {
  const dir = mkTmpDir('clip');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    core.exposeArray(CMD_ARRAY, 'cli', []);
    await submit(core, 3, 'stop', { module: 'echo' });
    assert.equal(core.getModule('echo')!.status, 'stopped');
    assert.ok(!core.listArrays().includes('echo:out'));
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('event 指令：生成一个自定义事件', async () => {
  const dir = mkTmpDir('clie');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    core.exposeArray(CMD_ARRAY, 'cli', []);
    await submit(core, 4, 'event', { name: 'hello', data: { who: 'world' } });
    assert.deepEqual(core.array('listener:got'), ['hello']);
    assert.equal(resultOf(core, 4).result.delivered, 'hello');
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('send 指令：定向投递给不监听的模块，且不影响他人', async () => {
  const dir = mkTmpDir('clid');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    core.exposeArray(CMD_ARRAY, 'cli', []);
    // echo 的 listen 为空：普通路由丢弃，定向必须送达
    await core.sendEvent('direct:x', {}, 'tester');
    assert.deepEqual(core.array('echo:out'), []);
    await submit(core, 5, 'send', { targets: ['echo'], name: 'direct:x', data: { v: 2 } });
    assert.deepEqual(core.array('echo:out'), ['direct:x']);
    assert.deepEqual(core.array('listener:got'), []); // 没被点到
    assert.deepEqual(resultOf(core, 5).result.recipients, ['echo']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('send 指令 * 广播：发给所有运行中且有 onEvent 的模块', async () => {
  const dir = mkTmpDir('clib');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    core.exposeArray(CMD_ARRAY, 'cli', []);
    await submit(core, 6, 'send', { targets: '*', name: 'all:go', data: {} });
    assert.deepEqual(core.array('echo:out'), ['all:go']);
    assert.deepEqual(core.array('listener:got'), ['all:go']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('state 指令：结果数组携带模块与公共数组清单', async () => {
  const dir = mkTmpDir('clist');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    core.exposeArray(CMD_ARRAY, 'cli', []);
    await submit(core, 7, 'state', {});
    const r = resultOf(core, 7).result;
    const names = r.modules.map((m: any) => m.name).sort();
    assert.deepEqual(names, ['donex', 'echo', 'lazy', 'listener']);
    assert.equal(r.modules.find((m: any) => m.name === 'lazy').status, 'stopped');
    assert.ok(r.arrays.includes('core:results'));
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('未知指令：结果 ok:false + error，核心继续可用', async () => {
  const dir = mkTmpDir('cliu');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    core.exposeArray(CMD_ARRAY, 'cli', []);
    await submit(core, 8, 'frobnicate', {});
    const r = resultOf(core, 8);
    assert.equal(r.ok, false);
    assert.ok(String(r.error).includes('未知 CLI 指令'));
    // 核心不受影响：普通事件照常路由
    await core.sendEvent('ping:ok', {}, 'tester');
    assert.deepEqual(core.array('listener:got'), ['ping:ok']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('请求的 id 找不到条目：不执行、不崩溃', async () => {
  const dir = mkTmpDir('clim');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    core.exposeArray(CMD_ARRAY, 'cli', []);
    await core.sendEvent('cli:request', { id: 999 }, 'cli'); // 没有 id=999 的条目
    assert.equal(core.array(RESULT_ARRAY).length, 0); // 未写入结果
    assert.equal(core.array('donex:bell').length, 0); // 未响完成门铃
    assert.ok(core.log.byType('error').some((l) => String(l.message).includes('未找到对应指令条目')));
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('exit 指令：先写结果与完成门铃，再关闭核心', async () => {
  const dir = mkTmpDir('clix');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    core.exposeArray(CMD_ARRAY, 'cli', []);
    await submit(core, 10, 'exit', {}); // 先入队再响门铃：核心执行 exit 后自行停止
    assert.equal(core.started, false); // 核心已停止
    await core.stop(); // 幂等，无副作用
  } finally {
    rmDir(dir);
  }
});
