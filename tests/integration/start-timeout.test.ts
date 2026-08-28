/**
 * 启动超时与自动重试锁（已知问题 3）：
 *  - 配置了 startTimeoutMs 的模块超过期限未完成启动：记 module-start-timeout、
 *    标记 failed、锁定自动重试；
 *  - 锁定后事件再次触发只记跳过日志（start-timeout-lock），不会重复拉起；
 *  - 手动启动（reason=manual）可解锁重试；
 *  - 配置更新使旧代启动作废。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, waitFor, yamlFor } from '../helpers';

/** 启动函数永不返回的模块（模拟悬挂启动）。 */
const HANG_CJS = 'module.exports = { start() { return new Promise(() => {}); } };';

/** 首次启动悬挂、可被手动重启后正常启动的模块（用文件计数区分）。 */
const HANG_ONCE_CJS = `const fs = require('fs');
const path = require('path');
const COUNT = path.join(__dirname, 'start-count');
module.exports = {
  start(ctx) {
    fs.appendFileSync(COUNT, 'x');
    const n = fs.readFileSync(COUNT, 'utf8').length;
    if (n <= 1) return new Promise(() => {}); // 第一次悬挂
  },
};
`;

test('启动超时：超过 startTimeoutMs 未完成 -> module-start-timeout + failed + 锁定自动重试', async () => {
  const dir = mkTmpDir('to');
  try {
    fs.writeFileSync(path.join(dir, 'hang.cjs'), HANG_CJS);
    // 声明 100ms 启动超时
    fs.writeFileSync(path.join(dir, 'hang.yaml'), 'name: hang\nfile: ./hang.cjs\nstartTimeoutMs: 100\nstartEvents: ["*:go"]\n');
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    await core.startModule('hang', 'manual'); // 手动触发（首次启动，不锁定）
    // ① 超时后状态 failed，日志有 module-start-timeout
    assert.equal(core.getModule('hang')!.status, 'failed');
    const timeoutLogs = core.log.byType('module-start-timeout').filter((l) => l.module === 'hang');
    assert.equal(timeoutLogs.length, 1);
    assert.ok(String(timeoutLogs[0].message).includes('100ms'));
    // ② 事件再次触发：被锁，记 start-timeout-lock 跳过，不再重复拉起
    await core.sendEvent('go');
    const skipLogs = core.log.byType('module-skip').filter((l) => l.module === 'hang' && l.reason === 'start-timeout-lock');
    assert.equal(skipLogs.length, 1);
    assert.equal(core.getModule('hang')!.status, 'failed'); // 状态不变
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('启动超时锁定：手动启动可解锁重试', async () => {
  const dir = mkTmpDir('to-unlock');
  try {
    fs.writeFileSync(path.join(dir, 'hangonce.cjs'), HANG_ONCE_CJS);
    fs.writeFileSync(path.join(dir, 'hangonce.yaml'), 'name: hangonce\nfile: ./hangonce.cjs\nstartTimeoutMs: 100\n');
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    // 第一次启动：悬挂 -> 超时 -> failed + 锁定
    await core.startModule('hangonce', 'manual');
    assert.equal(core.getModule('hangonce')!.status, 'failed');
    // 事件触发：被锁
    await core.sendEvent('go');
    assert.equal(core.getModule('hangonce')!.status, 'failed');
    // 手动启动（manual）：解锁，第二次启动正常完成（start 返回）
    await core.startModule('hangonce', 'manual');
    assert.equal(core.getModule('hangonce')!.status, 'running');
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('启动超时：CLI 指令启动（reason=cli）也可解锁重试', async () => {
  const dir = mkTmpDir('to-cli');
  try {
    fs.writeFileSync(path.join(dir, 'hangonce.cjs'), HANG_ONCE_CJS);
    fs.writeFileSync(path.join(dir, 'hangonce.yaml'), 'name: hangonce\nfile: ./hangonce.cjs\nstartTimeoutMs: 100\n');
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    await core.startModule('hangonce', 'manual');
    assert.equal(core.getModule('hangonce')!.status, 'failed');
    // CLI 途径（cli reason）解锁
    await core.startModule('hangonce', 'cli');
    assert.equal(core.getModule('hangonce')!.status, 'running');
    await core.stop();
  } finally {
    rmDir(dir);
  }
});
