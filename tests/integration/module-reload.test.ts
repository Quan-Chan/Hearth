/**
 * 请求重启（reloadModule / ctx.requestReload）：
 *   - 核心先验证新代码，失败则保留旧实例（重启不会“换到一半坏掉”）
 *   - 验证通过：停旧启新，新代码立即生效
 *   - 状态保存/恢复是模块自己的职责（核心不迁移任何状态）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, waitFor, arr, yamlFor } from '../helpers';

const V1 = `const fs = require('fs');
const path = require('path');
const HOOK = path.join(__dirname, 'hooks.log');
module.exports = {
  start(ctx) {
    fs.appendFileSync(HOOK, 'start-v1\\n');
    ctx.exposeArray('marks', ['v1']);
  },
  onEvent(ctx, event) {
    if (event.name.endsWith(':rel:use')) ctx.array('marks').push('v1-handled');
    if (event.name.endsWith(':rel:reload')) {
      ctx.requestReload(); // 模块自己声明更新（异步执行，不阻塞事件）
    }
  },
  stop() { fs.appendFileSync(HOOK, 'stop\\n'); },
};
`;

const V2 = `const fs = require('fs');
const path = require('path');
const HOOK = path.join(__dirname, 'hooks.log');
module.exports = {
  start(ctx) {
    fs.appendFileSync(HOOK, 'start-v2\\n');
    ctx.exposeArray('marks', ['v2']);
  },
  onEvent(ctx, event) {
    if (event.name.endsWith(':rel:use')) ctx.array('marks').push('v2-handled');
  },
  stop() { fs.appendFileSync(HOOK, 'stop\\n'); },
};
`;

const BROKEN = `module.exports = { start( { this is not valid js`;

test('reloadModule：验证通过则停旧启新，新代码立即生效（宿主发起重启）', async () => {
  const dir = mkTmpDir('reload-ok');
  try {
    const prog = path.join(dir, 'rel.cjs');
    fs.writeFileSync(prog, V1);
    fs.writeFileSync(path.join(dir, 'rel.yaml'), yamlFor('rel', { startEvents: ['core:startup'], listen: ['*:rel:use', '*:rel:reload'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    assert.equal(core.getModule('rel')!.status, 'running');
    await core.sendEvent('rel:use');
    assert.deepEqual(arr(core as any, 'public:rel:marks'), ['v1', 'v1-handled']);

    // 替换代码文件（新行为），声明更新
    fs.writeFileSync(prog, V2);
    const ok = await core.reloadModule('rel');
    assert.equal(ok, true);

    // 新实例：stop 旧 -> start 新
    const log = fs.readFileSync(path.join(dir, 'hooks.log'), 'utf8');
    assert.ok(log.includes('start-v1'), 'v1 start 执行过');
    assert.ok(log.includes('stop'), '旧实例 stop 被调用（状态保存的时机）');
    assert.ok(log.includes('start-v2'), '新实例 start 执行');
    assert.equal(core.getModule('rel')!.status, 'running');

    // 数组是全新的（旧公开数组随旧拥有者消失）
    assert.deepEqual(arr(core as any, 'public:rel:marks'), ['v2']);
    await core.sendEvent('rel:use');
    assert.deepEqual(arr(core as any, 'public:rel:marks'), ['v2', 'v2-handled'], '新代码生效');
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('reloadModule：新代码加载失败则保留旧实例继续运行（验证失败不重启）', async () => {
  const dir = mkTmpDir('reload-fail');
  try {
    const prog = path.join(dir, 'rel.cjs');
    fs.writeFileSync(prog, V1);
    fs.writeFileSync(path.join(dir, 'rel.yaml'), yamlFor('rel', { startEvents: ['core:startup'], listen: ['*:rel:use'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    const startCount = core.log.byType('module-start').filter((s) => s.module === 'rel').length;

    // 写入坏代码并声明更新
    fs.writeFileSync(prog, BROKEN);
    const ok = await core.reloadModule('rel');
    assert.equal(ok, false);

    // 旧实例未受影响：仍在运行、仍能处理事件、启动次数未变（没有被重启）
    assert.equal(core.getModule('rel')!.status, 'running');
    assert.equal(core.log.byType('module-start').filter((s) => s.module === 'rel').length, startCount);
    await core.sendEvent('rel:use');
    assert.deepEqual(arr(core as any, 'public:rel:marks'), ['v1', 'v1-handled'], '旧逻辑仍在工作');

    // error 日志可查（类型 error，含"重启失败"）
    const errs = core.log.byType('error');
    assert.ok(errs.some((e) => String(e.message).includes('重启失败')), '有重启失败日志');
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('requestReload：模块自己替换代码并请求重启（模块内触发）', async () => {
  const dir = mkTmpDir('reload-self');
  try {
    const prog = path.join(dir, 'rel.cjs');
    fs.writeFileSync(prog, V1);
    fs.writeFileSync(path.join(dir, 'rel.yaml'), yamlFor('rel', { startEvents: ['core:startup'], listen: ['*:rel:reload', '*:rel:use'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();

    // 模块内部替换自己的代码文件，然后发 rel:reload 事件触发 ctx.requestReload()
    fs.writeFileSync(prog, V2);
    await core.sendEvent('rel:reload');
    // 等重启真正完成：新实例的数组已出现 v2（module-restart 日志只标记流程开始）
    await waitFor(() => {
      try { return arr(core as any, 'public:rel:marks')[0] === 'v2'; } catch { return false; }
    });

    // 重载完成：新代码已生效
    await core.sendEvent('rel:use');
    assert.deepEqual(arr(core as any, 'public:rel:marks'), ['v2', 'v2-handled']);
    assert.ok(core.log.byType('module-restart').length >= 1, '有 module-restart 日志');
    await core.stop();
  } finally {
    rmDir(dir);
  }
});