/**
 * 停止协议（简单版）：
 *  ① 核心广播 core:shutdown 给所有运行中的模块；
 *  ② 每个模块的 stop() 钩子被调用——**stop() 返回（resolve）即该模块"已关闭"**；
 *  ③ 核心等待全部模块返回"已关闭"：全部返回 → 关闭自己；
 *     超过 stopTimeoutMs 仍有模块未返回 → 强制关闭（记 error 指明谁没回来）。
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
    // 未返回的模块被超时兜底：停机仍完成，且记了 error 指明谁没回来
    assert.ok(elapsed >= 280 && elapsed < 2000, '超时后强制关闭（实际 ' + elapsed + 'ms）');
    assert.ok(core.log.all().some((e) => e.type === 'error' && String(e.message).includes('停止超时') && String(e.message).includes('hang')), 'error 日志指明未返回的模块');
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
