/**
 * CLI 定向指令测试：sendTo('core', { cmd, args }) 发指令，核心执行后经定向信息回传结果。
 * 覆盖：生成事件 / 启动 / 关闭 / 定向发送 / 广播 / 状态查询 / 未知指令容错 / exit。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { Hearth } from '../../src/core/Hearth';
import { mkTmpDir, rmDir, waitFor, items, yamlFor } from '../helpers';

/** 测试接收者模块：接收核心回传的指令结果。 */
const TESTER = `
module.exports = {
  name: 'tester',
  start(ctx) { ctx.exposeObject('results', { items: [] }); },
  onMessage(ctx, message) { ctx.object('results').items.push(message.data); },
};
`;

function makeDir(dir: string): void {
  // echo：不监听任何事件（listen: []），只能被定向发送
  fs.writeFileSync(path.join(dir, 'echo.cjs'), `module.exports = { name: 'echo', start(ctx){ ctx.exposeObject('out', { items: [] }); }, onEvent(ctx, event){ ctx.object('out').items.push(event.name); } };`);
  fs.writeFileSync(path.join(dir, 'echo.yaml'), 'name: echo\nfile: ./echo.cjs\nstartEvents: ["core:startup"]\nlisten: []\n');
  // listener：正常监听（任意来源）
  fs.writeFileSync(path.join(dir, 'listener.cjs'), `module.exports = { name: 'listener', start(ctx){ ctx.exposeObject('got', { items: [] }); }, onEvent(ctx, event){ ctx.object('got').items.push(event.name); } };`);
  fs.writeFileSync(path.join(dir, 'listener.yaml'), yamlFor('listener', { startEvents: ['core:startup'], listen: ['*:hello', '*:ping:*'] }));
  // lazy：启动事件从不出现 -> 停着，只能被 start 指令起来
  fs.writeFileSync(path.join(dir, 'lazy.cjs'), `module.exports = { name: 'lazy', start(ctx){ ctx.exposeObject('mark', { items: ['started'] }); }, onEvent(){} };`);
  fs.writeFileSync(path.join(dir, 'lazy.yaml'), yamlFor('lazy', { startEvents: ['rare:start'], listen: ['rare:start'] }));
  fs.writeFileSync(path.join(dir, 'tester.cjs'), TESTER);
  fs.writeFileSync(path.join(dir, 'tester.yaml'), yamlFor('tester', { startEvents: ['core:startup'] }));
}

function resultsArr(core: Hearth): any[] {
  return items<any[]>(core as any, 'public:tester:results');
}

/** 发一条指令（发起方为 tester 模块），等待并返回最新结果。 */
async function ask(core: Hearth, cmd: string, args: Record<string, unknown> = {}): Promise<any> {
  const before = resultsArr(core).length;
  await core.sendTo('core', { cmd, args }, 'tester');
  await waitFor(() => resultsArr(core).length > before);
  return resultsArr(core)[resultsArr(core).length - 1];
}

test('event 指令：生成自定义事件（来源段为发起方）', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    const r = await ask(core, 'event', { name: 'hello', data: { who: 'world' } });
    assert.equal(r.ok, true);
    assert.deepEqual(items(core as any, 'public:listener:got'), ['tester:hello']);
    assert.ok(core.log.byType('cli-command').some((l) => String(l.message).includes('event')));
    await core.stop();
  } finally { rmDir(dir); }
});

test('start 指令：无需事件也能启动模块', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    assert.equal(core.getModule('lazy')!.status, 'stopped');
    const r = await ask(core, 'start', { module: 'lazy' });
    assert.equal(r.ok, true);
    assert.equal(core.getModule('lazy')!.status, 'running');
    assert.deepEqual(items(core as any, 'public:lazy:mark'), ['started']);
    await core.stop();
  } finally { rmDir(dir); }
});

test('stop 指令：关闭模块，其对象随之消失', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    const r = await ask(core, 'stop', { module: 'echo' });
    assert.equal(r.ok, true);
    assert.equal(core.getModule('echo')!.status, 'stopped');
    assert.throws(() => (core.object as any)('public:echo:out'), /not found/);
    await core.stop();
  } finally { rmDir(dir); }
});

test('send 指令：定向投递给不监听的模块，且不影响他人', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    await core.sendEvent('direct:x', {}, 'tester'); // 普通路由：无监听声明 -> 丢弃
    assert.deepEqual(items(core as any, 'public:echo:out'), []);
    const r = await ask(core, 'send', { targets: ['echo'], name: 'direct:x', data: { v: 2 } });
    assert.deepEqual(items(core as any, 'public:echo:out'), ['tester:direct:x']);
    assert.deepEqual(items(core as any, 'public:listener:got'), []);
    assert.deepEqual(r.result.recipients, ['echo']);
    await core.stop();
  } finally { rmDir(dir); }
});

test('send 指令 * 广播：发给所有运行中且有 onEvent 的模块', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    const r = await ask(core, 'send', { targets: '*', name: 'all:go', data: {} });
    assert.equal(r.ok, true);
    assert.deepEqual(items(core as any, 'public:echo:out'), ['tester:all:go']);
    assert.deepEqual(items(core as any, 'public:listener:got'), ['tester:all:go']);
    await core.stop();
  } finally { rmDir(dir); }
});

test('state 指令：结果携带模块与公共对象清单', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    const r = await ask(core, 'state', {});
    assert.deepEqual(r.result.modules.map((m: any) => m.name).sort(), ['echo', 'lazy', 'listener', 'tester']);
    assert.equal(r.result.modules.find((m: any) => m.name === 'lazy').status, 'stopped');
    assert.ok(r.result.objects.includes('public:tester:results'));
    await core.stop();
  } finally { rmDir(dir); }
});

test('未知指令：结果 ok:false + error，核心继续可用', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    const r = await ask(core, 'frobnicate', {});
    assert.equal(r.ok, false);
    assert.ok(String(r.error).includes('unknown CLI command'));
    await core.sendEvent('ping:ok', {}, 'tester');
    assert.deepEqual(items(core as any, 'public:listener:got'), ['tester:ping:ok']);
    await core.stop();
  } finally { rmDir(dir); }
});

test('exit 指令：先回执再关闭核心', async () => {
  const dir = mkTmpDir('cli');
  try {
    makeDir(dir);
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    await core.sendTo('core', { cmd: 'exit', args: {} }, 'tester');
    await waitFor(() => core.started === false);
    assert.equal(core.started, false);
  } finally { rmDir(dir); }
});