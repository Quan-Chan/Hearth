/**
 * 测试应用：监控告警（类似 Prometheus 告警 / APM 系统）。
 * 场景：指标上报 -> 聚合最新值；超过 YAML 配置阈值 -> 告警 -> 历史归档。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, arr } from '../helpers';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MODULE_DIR = path.join(ROOT, 'tests', 'fixtures', 'monitoring', 'modules');

test('监控告警：指标聚合去重 + 阈值告警 + 历史归档', async () => {
  const tmp = mkTmpDir('mon');
  try {
    const core = new ConnectCore({ moduleDir: MODULE_DIR, logFile: path.join(tmp, 'log.log'), watch: false });
    await core.start();
    // YAML 配置的阈值被模块读取（阈值 100）
    const alerting = core.getModule('alerting')!;
    assert.equal(alerting.config.config!.threshold, 100);
    // 低值：只聚合，不告警
    await core.sendEvent('app:metric', { name: 'cpu', value: 30 });
    await core.sendEvent('app:metric', { name: 'mem', value: 80 });
    assert.equal(arr(core, 'public:collector:latest').length, 2);
    assert.equal(arr(core, 'public:alerting:active').length, 0);
    assert.equal(arr(core, 'public:dashboard:history').length, 0);
    // 高值：告警
    await core.sendEvent('app:metric', { name: 'cpu', value: 150 });
    assert.equal(arr(core, 'public:alerting:active').length, 1);
    assert.equal(arr(core, 'public:alerting:active')[0].value, 150);
    assert.equal(arr(core, 'public:dashboard:history').length, 1);
    // 再次上报同名指标 -> 覆盖旧值（去重）
    await core.sendEvent('app:metric', { name: 'cpu', value: 42 });
    const latest = arr(core, 'public:collector:latest');
    assert.equal(latest.length, 2);
    const cpu = latest.find((m) => m.name === 'cpu');
    assert.equal(cpu.value, 42);
    await core.stop();
  } finally {
    rmDir(tmp);
  }
});