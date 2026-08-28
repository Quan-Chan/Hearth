/**
 * 停机中冻结（已知问题 5）：核心开始关闭（stop() 进行中）时，
 * 新的事件与定向消息均抛"正在关闭"错误，配置变更被拒绝。
 * 用 stop() 挂起的模块拖住停机窗口，在窗口内验证冻结。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, yamlFor } from '../helpers';

/** stop 挂起 500ms：制造停机窗口。 */
const SLOW_STOP_CJS = `module.exports = {
  name: 'slowstop',
  start(ctx) { ctx.exposeArray('m', []); },
  stop() { return new Promise((r) => setTimeout(r, 500)); },
};
`;

test('停机进行中：事件与定向消息抛"正在关闭"，配置变更被冻结', async () => {
  const dir = mkTmpDir('freeze');
  try {
    fs.writeFileSync(path.join(dir, 'slowstop.cjs'), SLOW_STOP_CJS);
    fs.writeFileSync(path.join(dir, 'slowstop.yaml'), yamlFor('slowstop', { startEvents: ['core:startup'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: true, pollIntervalMs: 50, stopTimeoutMs: 5000 });
    await core.start();
    // 开始停机但不 await：停机窗口出现（slowstop 的 stop 挂 500ms）
    const stopPromise = core.stop();
    // 等 100ms 进入停机窗口
    await new Promise((r) => setTimeout(r, 100));
    // 事件与定向消息被冻结
    await assert.rejects(() => core.sendEvent('go'), /正在关闭/);
    await assert.rejects(() => core.sendTo('slowstop', { x: 1 }), /正在关闭/);
    // 配置变更被拒绝：写新 YAML 不会注册（停机中文件面冻结）
    fs.writeFileSync(path.join(dir, 'new.cjs'), 'module.exports = { start() {} };');
    fs.writeFileSync(path.join(dir, 'new.yaml'), yamlFor('new', { startEvents: ['core:startup'] }));
    // 停机窗口内等一会儿，确认 new 未注册
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(core.getModule('new'), undefined);
    // 停机完成
    await stopPromise;
    assert.equal(core.started, false);
  } finally {
    rmDir(dir);
  }
});
