/**
 * 测试应用：任务调度器（类似 cron / 任务队列 / CI 调度中心）。
 * 场景：提交任务 -> 定时到期 -> 执行 -> 通知；支持取消任务。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, waitFor, arr } from '../helpers';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MODULE_DIR = path.join(ROOT, 'tests', 'fixtures', 'task-scheduler', 'modules');

test('任务调度器：提交 -> 到期 -> 执行 -> 通知 全链路', async () => {
  const tmp = mkTmpDir('sched');
  try {
    const core = new ConnectCore({ moduleDir: MODULE_DIR, logFile: path.join(tmp, 'log.log'), watch: false });
    await core.start();
    // 提交 3 个任务，不同延迟
    await core.sendEvent('task:submit', { id: 't1', name: '构建前端', delayMs: 30 });
    await core.sendEvent('task:submit', { id: 't2', name: '跑测试', delayMs: 15 });
    await core.sendEvent('task:submit', { id: 't3', name: '发版', delayMs: 45 });
    // 队列中可见
    assert.equal(arr(core, 'public:scheduler:queue').length, 3);
    // 等待全部到期
    await waitFor(() => arr(core, 'public:scheduler:done').length === 3, 3000);
    // 执行结果按到期顺序（t2 最先）
    const done = arr(core, 'public:scheduler:done');
    assert.deepEqual(done.map((d) => d.id), ['t2', 't1', 't3']);
    assert.ok(done.every((d) => d.status === 'done'));
    // 队列被清空（无删除操作，任务完成后留在队列为 queued？—— 设计：完成后仍在队列中标记？）
    // 通知已产生
    const notices = arr(core, 'public:notifier:notifications');
    assert.equal(notices.length, 3);
    assert.ok(String(notices[0].text).includes('跑测试'));
    await core.stop();
  } finally {
    rmDir(tmp);
  }
});

test('任务调度器：取消任务后不再执行', async () => {
  const tmp = mkTmpDir('sched');
  try {
    const core = new ConnectCore({ moduleDir: MODULE_DIR, logFile: path.join(tmp, 'log.log'), watch: false });
    await core.start();
    await core.sendEvent('task:submit', { id: 'keep', name: '保留', delayMs: 200 });
    await core.sendEvent('task:submit', { id: 'drop', name: '取消我', delayMs: 60 });
    // 取消 drop
    await core.sendEvent('task:cancel', { id: 'drop' });
    const queue = arr(core, 'public:scheduler:queue');
    assert.deepEqual(queue.map((q) => q.id), ['keep']);
    // keep 正常完成，drop 永不执行
    await waitFor(() => arr(core, 'public:scheduler:done').length === 1, 3000);
    assert.equal(arr(core, 'public:scheduler:done')[0].id, 'keep');
    assert.equal(arr(core, 'public:notifier:notifications').length, 1);
    await core.stop();
  } finally {
    rmDir(tmp);
  }
});