/**
 * 停止协议（已知问题 4、5）：
 *  ① 核心调用每个运行模块的 stop() 钩子——stop() 返回（resolve）即该模块"已关闭"；
 *  ② 核心等待全部模块返回"已关闭"：全部返回 → 关闭自己；
 *     超过 stopTimeoutMs 仍有模块未返回 → 强制关闭（记 error 指明谁没回来）；
 *  ③ 停机进行中：事件/定向消息抛"正在关闭"，配置变更被冻结。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, yamlFor } from '../helpers';
const ACK_CJS = "const fs = require('fs');\nconst path = require('path');\nconst LOG = path.join(__dirname, 'ack.log');\nmodule.exports = {\n  start(ctx) { ctx.exposeArray('ack:marks', ['started']); },\n  stop(ctx) {\n    fs.appendFileSync(LOG, 'stop-called\\n');\n    // 停止逻辑需要异步收尾：等收尾完成后再返回（返回 = 已关闭）\n    return new Promise((resolve) => {\n      setTimeout(() => {\n        fs.appendFileSync(LOG, 'cleanup-finished\\n');\n        resolve();\n      }, 80);\n    });\n  },\n};\n";
const HANG_CJS = "module.exports = {\n  start(ctx) { ctx.exposeArray('hang:marks', ['started']); },\n  stop() { return new Promise(() => {}); },\n};\n";
const PLAIN_CJS = "module.exports = {\n  start(ctx) { ctx.exposeArray('plain:marks', ['ok']); },\n  stop() {},\n};\n";

test('停止协议：所有模块返回"已关闭"（stop() resolve）后核心才关闭', async () => {
  const dir = mkTmpDir('stop-ok');
  try {
    fs.writeFileSync(path.join(dir, 'ack.cjs'), ACK_CJS);
    fs.writeFileSync(path.join(dir, 'ack.yaml'), yamlFor('ack', { startEvents: ['core:startup'] }));
    fs.writeFileSync(path.join(dir, 'plain.cjs'), PLAIN_CJS);
    fs.writeFileSync(path.join(dir, 'plain.yaml'), yamlFor('plain', { startEvents: ['core:startup'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: false, stopTimeoutMs: 5000 });
    await core.start();
    const t0 = Date.now();
    await core.stop();
    const elapsed = Date.now() - t0;
    // ack 模块是在 80ms 收尾后才 resolve：核心等待了它（而不是没等就关）
    const log = fs.readFileSync(path.join(dir, 'ack.log'), 'utf8');
    assert.ok(log.includes('stop-called'), 'stop() 被调用');
    assert.ok(log.includes('cleanup-finished'), '停止逻辑在返回前完成');
    assert.ok(elapsed >= 70, '核心等待模块返回已关闭（实际 ' + elapsed + 'ms）');
    assert.ok(elapsed < 2000, '全部返回后核心立即关闭（实际 ' + elapsed + 'ms）');
    assert.equal(core.started, false);
    // 两个模块都已关闭
    assert.equal(core.getModule('ack')!.status, 'stopped');
    assert.equal(core.getModule('plain')!.status, 'stopped');
  } finally {
    rmDir(dir);
  }
});

test('停止协议：模块超过 stopTimeoutMs 未返回"已关闭" -> 核心强制关闭', async () => {
  const dir = mkTmpDir('stop-hang');
  try {
    fs.writeFileSync(path.join(dir, 'hang.cjs'), HANG_CJS);
    fs.writeFileSync(path.join(dir, 'hang.yaml'), yamlFor('hang', { startEvents: ['core:startup'] }));
    fs.writeFileSync(path.join(dir, 'plain.cjs'), PLAIN_CJS);
    fs.writeFileSync(path.join(dir, 'plain.yaml'), yamlFor('plain', { startEvents: ['core:startup'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: false, stopTimeoutMs: 300 });
    await core.start();
    const t0 = Date.now();
    await core.stop();
    const elapsed = Date.now() - t0;
    // 未返回的模块被超时强制关闭：停机仍完成，且记了 error 指明谁没回来
    assert.ok(elapsed >= 280 && elapsed < 2000, '超时后强制关闭（实际 ' + elapsed + 'ms）');
    assert.ok(core.log.all().some((e) => e.type === 'error' && String(e.message).includes('stop timed out') && String(e.message).includes('hang')), 'error 日志指明未返回的模块');
    assert.equal(core.started, false);
    // 返回了的模块正常关闭
    assert.equal(core.getModule('plain')!.status, 'stopped');
  } finally {
    rmDir(dir);
  }
});

test('停止协议：同步返回的 stop() 立即视为已关闭（协议不要求任何声明）', async () => {
  const dir = mkTmpDir('stop-plain');
  try {
    fs.writeFileSync(path.join(dir, 'plain.cjs'), PLAIN_CJS);
    fs.writeFileSync(path.join(dir, 'plain.yaml'), yamlFor('plain', { startEvents: ['core:startup'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: false, stopTimeoutMs: 60000 });
    await core.start();
    const t0 = Date.now();
    await core.stop();
    assert.ok(Date.now() - t0 < 500, '同步返回快速完成');
    assert.equal(core.started, false);
  } finally {
    rmDir(dir);
  }
});

test('停机进行中：事件与定向消息抛"正在关闭"，配置变更被冻结', async () => {
  const dir = mkTmpDir('freeze');
  try {
    // stop 挂起 500ms：制造停机窗口
    fs.writeFileSync(
      path.join(dir, 'slowstop.cjs'),
      `module.exports = {
  name: 'slowstop',
  start(ctx) { ctx.exposeArray('m', []); },
  stop() { return new Promise((r) => setTimeout(r, 500)); },
};
`,
    );
    fs.writeFileSync(path.join(dir, 'slowstop.yaml'), yamlFor('slowstop', { startEvents: ['core:startup'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: true, pollIntervalMs: 50, stopTimeoutMs: 5000 });
    await core.start();
    // 开始停机但不 await：停机窗口出现（slowstop 的 stop 挂 500ms）
    const stopPromise = core.stop();
    // 等 100ms 进入停机窗口
    await new Promise((r) => setTimeout(r, 100));
    // 事件与定向消息被冻结
    await assert.rejects(() => core.sendEvent('go'), /is stopping/);
    await assert.rejects(() => core.sendTo('slowstop', { x: 1 }), /is stopping/);
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