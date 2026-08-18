/**
 * CLI 门铃协议测试（极简版）：事件不带 id，核心执行 cli:commands 里第一条未处理的指令。
 *
 * 协议：cli:commands（内容）-> cli:request（门铃）-> 执行 -> core:results（结果）-> cli:done（门铃）
 * 覆盖：生成事件 / 启动 / 关闭 / 定向发送 / 广播 / 状态查询 / 未知指令容错 / 无指令容错 / exit。
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
  fs.writeFileSync(path.join(dir, 'echo.cjs'), `module.exports = { name: 'echo', start(ctx){ ctx.exposeArray('echo:out', []); }, onEvent(ctx, event){ ctx.array('echo:out').push(event.name); } };`);
  fs.writeFileSync(path.join(dir, 'echo.yaml'), 'name: echo\nfile: ./echo.cjs\nstartEvents: ["core:startup"]\nlisten: []\n');
  // listener：正常监听
  fs.writeFileSync(path.join(dir, 'listener.cjs'), `module.exports = { name: 'listener', start(ctx){ ctx.exposeArray('listener:got', []); }, onEvent(ctx, event){ ctx.array('listener:got').push(event.name); } };`);
  fs.writeFileSync(path.join(dir, 'listener.yaml'), yamlFor('listener', { startEvents: ['core:startup'], listen: ['hello', 'ping:*'] }));
  // lazy：启动事件从不出现 -> 停着，只能被 start 指令起来
  fs.writeFileSync(path.join(dir, 'lazy.cjs'), `module.exports = { name: 'lazy', start(ctx){ ctx.exposeArray('lazy:mark', ['started']); }, onEvent(){} };`);
  fs.writeFileSync(path.join(dir, 'lazy.yaml'), yamlFor('lazy', { startEvents: ['rare:start'], listen: ['rare:start'] }));
}

/** 提交一条指令：写数组 + 响门铃（事件不带 id）。 */
async function ask(core: ConnectCore, cmd: string, args: Record<string, unknown> = {}): Promise<void> {
  core.array(CMD_ARRAY).push({ cmd, args });
  await core.sendEvent('cli:request', {}, 'cli');
}

/** 结果数组最新一条。 */
function lastResult(core: ConnectCore): any {
  const arr = core.array(RESULT_ARRAY);
  return arr[arr.length - 1];
}

function setup(core: ConnectCore): void {
  core.exposeArray(CMD_ARRAY, 'cli', []); // 模拟 CLI 的命令信箱
}

test('event 指令：生成自定义事件，结果入 core:results', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    setup(core);
    await ask(core, 'event', { name: 'hello', data: { who: 'world' } });
    assert.deepEqual(core.array('listener:got'), ['hello']);
    assert.equal(lastResult(core).cmd, 'event');
    assert.equal(lastResult(core).ok, true);
    assert.equal(core.array(CMD_ARRAY)[0].status, 'done');
    assert.ok(core.log.byType('cli-command').some((l) => l.command === 'event'));
    await core.stop();
  } finally { rmDir(dir); }
});

test('start 指令：无需事件也能启动模块', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    setup(core);
    assert.equal(core.getModule('lazy')!.status, 'stopped');
    await ask(core, 'start', { module: 'lazy' });
    assert.equal(core.getModule('lazy')!.status, 'running');
    assert.deepEqual(core.array('lazy:mark'), ['started']);
    await core.stop();
  } finally { rmDir(dir); }
});

test('stop 指令：关闭模块，其数组随之消失', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    setup(core);
    await ask(core, 'stop', { module: 'echo' });
    assert.equal(core.getModule('echo')!.status, 'stopped');
    assert.ok(!core.listArrays().includes('echo:out'));
    await core.stop();
  } finally { rmDir(dir); }
});

test('send 指令：定向投递给不监听的模块，且不影响他人', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    setup(core);
    await core.sendEvent('direct:x', {}, 'tester'); // 普通路由：无人监听 -> 丢弃
    assert.deepEqual(core.array('echo:out'), []);
    await ask(core, 'send', { targets: ['echo'], name: 'direct:x', data: { v: 2 } });
    assert.deepEqual(core.array('echo:out'), ['direct:x']);
    assert.deepEqual(core.array('listener:got'), []);
    assert.deepEqual(lastResult(core).result.recipients, ['echo']);
    await core.stop();
  } finally { rmDir(dir); }
});

test('send 指令 * 广播：发给所有运行中且有 onEvent 的模块', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    setup(core);
    await ask(core, 'send', { targets: '*', name: 'all:go', data: {} });
    assert.deepEqual(core.array('echo:out'), ['all:go']);
    assert.deepEqual(core.array('listener:got'), ['all:go']);
    await core.stop();
  } finally { rmDir(dir); }
});

test('state 指令：结果携带模块与公共数组清单', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    setup(core);
    await ask(core, 'state', {});
    const r = lastResult(core).result;
    assert.deepEqual(r.modules.map((m: any) => m.name).sort(), ['echo', 'lazy', 'listener']);
    assert.equal(r.modules.find((m: any) => m.name === 'lazy').status, 'stopped');
    assert.ok(r.arrays.includes('core:results'));
    await core.stop();
  } finally { rmDir(dir); }
});

test('未知指令：结果 ok:false + error，且该条目标记为 error，核心继续可用', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    setup(core);
    await ask(core, 'frobnicate', {});
    assert.equal(lastResult(core).ok, false);
    assert.ok(String(lastResult(core).error).includes('未知 CLI 指令'));
    assert.equal(core.array(CMD_ARRAY)[0].status, 'error');
    await core.sendEvent('ping:ok', {}, 'tester');
    assert.deepEqual(core.array('listener:got'), ['ping:ok']);
    await core.stop();
  } finally { rmDir(dir); }
});

test('cli:commands 为空时 cli:request 不执行、不崩溃', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    setup(core);
    await core.sendEvent('cli:request', {}, 'cli');
    assert.equal(core.array(RESULT_ARRAY).length, 0);
    assert.ok(core.log.byType('error').some((l) => String(l.message).includes('没有待执行指令')));
    await core.stop();
  } finally { rmDir(dir); }
});

test('exit 指令：先写结果与完成门铃，再关闭核心', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    setup(core);
    await ask(core, 'exit', {});
    assert.equal(core.started, false); // 核心已停止
    await core.stop();
  } finally { rmDir(dir); }
});
