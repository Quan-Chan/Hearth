/**
 * 启动即整机：从公共入口 startCore 启动核心 == 启动整个软件，
 * 无需单独启动任何模块（examples/basic 演示目录）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { startCore, createCore } from '../../src/index';
import { mkTmpDir, rmDir } from '../helpers';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DEMO_DIR = path.join(ROOT, 'examples', 'basic', 'modules');

test('startCore：一次启动整机软件，模块按事件自动启动', async () => {
  const tmp = mkTmpDir('boot');
  try {
    const core = await startCore({ moduleDir: DEMO_DIR, logFile: path.join(tmp, 'boot.log'), watch: false });
    assert.equal(core.started, true);
    // 无需手动启动任何模块
    assert.deepEqual(core.listModules().map((m) => m.name).sort(), ['echo', 'greeter']);
    assert.equal(core.getModule('greeter')!.status, 'running');
    // 链式协作：echo 事件 -> greet 事件 -> greetings 数组
    await core.sendEvent('echo', { text: '世界' });
    assert.deepEqual(core.pullArray('greetings'), ['你好, 世界!']);
    await core.stop();
    assert.equal(core.started, false);
  } finally {
    rmDir(tmp);
  }
});

test('createCore + start 与 startCore 等价', async () => {
  const tmp = mkTmpDir('boot');
  try {
    const core = createCore({ moduleDir: DEMO_DIR, logFile: path.join(tmp, 'boot.log'), watch: false });
    assert.equal(core.started, false);
    await core.start();
    assert.equal(core.started, true);
    await core.stop();
  } finally {
    rmDir(tmp);
  }
});
