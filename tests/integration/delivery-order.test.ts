/**
 * 事件投递顺序与 sendTo 送达语义（已知问题 6、18）：
 *  - 同一事件的多个监听者按加载顺序（注册顺序）逐个收到，前面不返回后面收不到；
 *  - 监听者处理抛错被隔离：只记 error，后续监听者仍收到；
 *  - sendTo 目标存在但 onMessage 抛错：返回 true（存在即送达），失败只进日志。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, waitFor, arr, yamlFor } from '../helpers';

/** 记录收到的顺序（写到共享数组）。 */
function seqModule(name: string): string {
  return `module.exports = {
  name: '${name}',
  start(ctx) { ctx.exposeArray('order', []); },
  onEvent(ctx, event) { ctx.array('order').push('${name}:' + event.name); },
};
`;
}

/** 第一个监听者处理时同步等待 100ms，验证后面监听者排队。 */
const SLOW_CJS = `module.exports = {
  name: 'slow',
  start(ctx) { ctx.exposeArray('order', []); },
  onEvent(ctx, event) {
    const t0 = Date.now();
    while (Date.now() - t0 < 100) { /* 同步阻塞 100ms */ }
    ctx.array('order').push('slow:' + event.name);
  },
};
`;

/** onMessage 抛错的接收方。 */
const THROWER_CJS = `module.exports = {
  name: 'thrower',
  start(ctx) { ctx.exposeArray('marks', []); },
  onMessage() { throw new Error('接收方处理失败'); },
};
`;

test('同一事件多个监听者：按加载顺序逐个收到（前面阻塞后面排队）', async () => {
  const dir = mkTmpDir('order');
  try {
    fs.writeFileSync(path.join(dir, 'slow.cjs'), SLOW_CJS);
    fs.writeFileSync(path.join(dir, 'slow.yaml'), yamlFor('slow', { startEvents: ['core:startup'], listen: ['*:go'] }));
    fs.writeFileSync(path.join(dir, 'a.cjs'), seqModule('a'));
    fs.writeFileSync(path.join(dir, 'a.yaml'), yamlFor('a', { startEvents: ['core:startup'], listen: ['*:go'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    // 监听顺序：slow 先注册（s < a 字母序），再 a
    await core.sendEvent('go');
    // 两个都收到，顺序按注册序
    await waitFor(() => arr(core as any, 'public:a:order').length === 1);
    const slowOrder = arr(core as any, 'public:slow:order');
    const aOrder = arr(core as any, 'public:a:order');
    assert.deepEqual(slowOrder, ['slow:external:go']);
    assert.deepEqual(aOrder, ['a:external:go']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('监听者处理抛错被隔离：只记 error，后续监听者仍收到', async () => {
  const dir = mkTmpDir('iso');
  try {
    fs.writeFileSync(path.join(dir, 'bad.cjs'), `module.exports = { name: 'bad', start(ctx) { ctx.exposeArray('order', []); }, onEvent() { throw new Error('处理失败'); } };`);
    fs.writeFileSync(path.join(dir, 'bad.yaml'), yamlFor('bad', { startEvents: ['core:startup'], listen: ['*:go'] }));
    fs.writeFileSync(path.join(dir, 'ok.cjs'), seqModule('ok'));
    fs.writeFileSync(path.join(dir, 'ok.yaml'), yamlFor('ok', { startEvents: ['core:startup'], listen: ['*:go'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    await core.sendEvent('go');
    await waitFor(() => arr(core as any, 'public:ok:order').length === 1);
    // bad 抛错被记 error
    assert.ok(core.log.byType('error').some((e) => String(e.message).includes('处理事件')));
    // ok 仍收到
    assert.deepEqual(arr(core as any, 'public:ok:order'), ['ok:external:go']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('sendTo 目标存在但 onMessage 抛错：返回 true（存在即送达），失败进日志', async () => {
  const dir = mkTmpDir('s2');
  try {
    fs.writeFileSync(path.join(dir, 'thrower.cjs'), THROWER_CJS);
    fs.writeFileSync(path.join(dir, 'thrower.yaml'), yamlFor('thrower', { startEvents: ['core:startup'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    // 目标存在且实现 onMessage：即使抛错也返回 true
    const delivered = await core.sendTo('thrower', { x: 1 }, 'tester');
    assert.equal(delivered, true);
    // 失败被记录
    assert.ok(core.log.byType('error').some((e) => String(e.message).includes('处理定向消息失败')));
    // 目标不存在：返回 false
    assert.equal(await core.sendTo('nope', { x: 1 }, 'tester'), false);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});
