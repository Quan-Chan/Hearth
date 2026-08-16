/**
 * 测试应用：智能家居（类似 Home Assistant / 米家自动化）。
 * 场景：人体感应 -> 灯光联动；温度上报 -> 超阈值自动制冷；安全日志记录一切。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir } from '../helpers';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MODULE_DIR = path.join(ROOT, 'tests', 'fixtures', 'home-automation', 'modules');

test('智能家居：人体感应联动灯光，多个模块同时监听同一事件', async () => {
  const tmp = mkTmpDir('home');
  try {
    const core = new ConnectCore({ moduleDir: MODULE_DIR, logFile: path.join(tmp, 'log.log'), watch: false });
    await core.start();
    // 有人进入客厅 -> 灯亮 + 传感器更新
    await core.sendEvent('home:motion', { room: 'living', motion: true });
    assert.deepEqual(core.pullArray('home:lights'), [{ room: 'living', on: true }]);
    assert.deepEqual(core.pullArray('home:sensors'), [{ room: 'living', motion: true }]);
    // 无人 -> 灯灭
    await core.sendEvent('home:motion', { room: 'living', motion: false });
    assert.deepEqual(core.pullArray('home:lights'), [{ room: 'living', on: false }]);
    // 新房间自动加入
    await core.sendEvent('home:motion', { room: 'kitchen', motion: true });
    assert.deepEqual(
      core.pullArray('home:lights').map((l) => l.room).sort(),
      ['kitchen', 'living'],
    );
    await core.stop();
  } finally {
    rmDir(tmp);
  }
});

test('智能家居：温度超阈值自动制冷，链式事件 + 模块日志', async () => {
  const tmp = mkTmpDir('home');
  try {
    const core = new ConnectCore({ moduleDir: MODULE_DIR, logFile: path.join(tmp, 'log.log'), watch: false });
    await core.start();
    // 30 度 > 26 -> 制冷
    await core.sendEvent('home:temperature', { room: 'living', temp: 30 });
    assert.deepEqual(core.pullArray('home:devices'), [{ room: 'living', cooling: true }]);
    assert.ok(core.log.byType('module:log').some((l) => l.module === 'cooler' && String(l.message).includes('制冷')));
    // 22 度 -> 不制冷
    await core.sendEvent('home:temperature', { room: 'living', temp: 22 });
    assert.equal(core.pullArray('home:devices')[0].cooling, true); // 保持开启（不自动关）
    await core.stop();
  } finally {
    rmDir(tmp);
  }
});

test('智能家居：安全日志用通配符原样记录所有 home:* 事件', async () => {
  const tmp = mkTmpDir('home');
  try {
    const core = new ConnectCore({ moduleDir: MODULE_DIR, logFile: path.join(tmp, 'log.log'), watch: false });
    await core.start();
    await core.sendEvent('home:motion', { room: 'living', motion: true });
    await core.sendEvent('home:temperature', { room: 'living', temp: 30 });
    const log = core.pullArray('home:log');
    assert.deepEqual(log.map((l) => l.event), ['home:motion', 'home:temperature', 'home:cooling']);
    assert.equal(log[2].data.room, 'living');
    await core.stop();
  } finally {
    rmDir(tmp);
  }
});
