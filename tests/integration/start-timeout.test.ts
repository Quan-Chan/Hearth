/**
 * 启动异常族（已知问题 2、3）：
 *  - 启动挂起：start() 不返回时状态停在 starting，未配置超时则调用方拿不到返回；
 *  - 启动超时：超过 startTimeoutMs 记 module-start-timeout、标记 failed、锁定自动重试；
 *  - 锁定后事件再次触发只记跳过日志（start-timeout-lock），不会重复拉起；
 *  - 手动/CLI 启动可解锁重试。
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

/** start 永不返回 + 一个正常模块（启动挂起测试用）。 */
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
