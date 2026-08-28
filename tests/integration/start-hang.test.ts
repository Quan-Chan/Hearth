/**
 * 启动函数不返回（已知问题 2）：
 *  - start() 挂起时模块状态停在 starting，不会变成 running；
 *  - 未配置超时时核心无限等待，startModule 调用方拿不到返回；
 *  - 已经运行的其他模块不受影响。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, yamlFor } from '../helpers';

/** start 永不返回 + 一个正常模块。 */
const HANG_START_CJS = 'module.exports = { start() { return new Promise(() => {}); } };';
const OK_CJS = 'module.exports = { name: "ok", start(ctx) { ctx.exposeArray("m", []); }, onEvent(ctx, e) { ctx.array("m").push(e.name); } };';

test('启动挂起：状态停在 starting，未配置超时则调用方拿不到返回', async () => {
  const dir = mkTmpDir('hang-start');
  try {
    fs.writeFileSync(path.join(dir, 'hang.cjs'), HANG_START_CJS);
    // hang 不声明 startEvents：否则 core.start() 会自动启动它并卡住（正是本问题描述的行为）
    fs.writeFileSync(path.join(dir, 'hang.yaml'), yamlFor('hang', {}));
    fs.writeFileSync(path.join(dir, 'ok.cjs'), OK_CJS);
    fs.writeFileSync(path.join(dir, 'ok.yaml'), yamlFor('ok', { startEvents: ['core:startup'], listen: ['*:ping'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    // 手动启动 hang：不等待返回（startModule 会挂起），观察状态
    const startPromise = core.startModule('hang', 'manual');
    await new Promise((r) => setTimeout(r, 100));
    // 状态停在 starting（等待 start() 返回）
    assert.equal(core.getModule('hang')!.status, 'starting');
    // 已运行的其他模块不受影响：事件照常送达
    await core.sendEvent('ping');
    assert.deepEqual(core.array('public:ok:m') as unknown[], ['external:ping']);
    // 调用方拿不到返回：promise 未 settle
    let settled = false;
    startPromise.then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(settled, false, 'startModule 应挂起（未配置超时）');
    // 收尾：作废挂起的启动（stop 会作废 starting 模块）
    await core.stop();
  } finally {
    rmDir(dir);
  }
});
