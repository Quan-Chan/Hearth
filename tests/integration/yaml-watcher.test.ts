import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, waitFor, sleep, yamlFor } from '../helpers';

const GREETER = `module.exports = {
  name: 'greeter',
  start(ctx) { ctx.exposeArray('greet:out', []); },
  onEvent(ctx, event) { ctx.array('greet:out').push(event.name); },
};
`;
const LATE = `module.exports = {
  name: 'late',
  onEvent(ctx, event) { ctx.array('late:marks').push(event.name); },
  start(ctx) { ctx.exposeArray('late:marks', ['late-started']); },
};
`;

test('监听模块文件夹：新增 YAML 自动加载，匹配已发生事件则立即启动', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new ConnectCore({ moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    assert.equal(core.listModules().length, 0);
    // 放入新的 YAML 配置 + 程序（先写程序文件，避免加载竞态）
    fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
    fs.writeFileSync(path.join(dir, 'greeter.yaml'), yamlFor('greeter', { startEvents: ['core:startup'], listen: ['greet'] }));
    // core:startup 已经发生过 -> 模块自动启动
    await waitFor(() => core.getModule('greeter')?.status === 'running');
    assert.ok(core.log.byType('config-load').some((l) => l.module === 'greeter'));
    // 事件可以正常送达
    await core.sendEvent('greet', { name: 'world' });
    assert.deepEqual(core.array('greet:out'), ['greet']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('新增模块：启动事件未发生过则不启动，事件到来时启动', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new ConnectCore({ moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    fs.writeFileSync(path.join(dir, 'late.cjs'), LATE);
    fs.writeFileSync(path.join(dir, 'late.yaml'), yamlFor('late', { startEvents: ['later:event'], listen: ['later:event'] }));
    await waitFor(() => core.getModule('late') !== undefined);
    // 事件未出现过 -> 未启动
    assert.equal(core.getModule('late')!.status, 'stopped');
    // 事件出现 -> 启动
    await core.sendEvent('later:event');
    await waitFor(() => core.getModule('late')!.status === 'running');
    assert.deepEqual(core.array('late:marks'), ['late-started', 'later:event']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('YAML 变化：更新配置并重启模块，新监听生效', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new ConnectCore({ moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    const yamlPath = path.join(dir, 'greeter.yaml');
    fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
    fs.writeFileSync(yamlPath, yamlFor('greeter', { startEvents: ['core:startup'], listen: ['greet'] }));
    await waitFor(() => core.getModule('greeter')?.status === 'running');
    // 修改 YAML：listen 改为另一事件
    fs.writeFileSync(yamlPath, yamlFor('greeter', { startEvents: ['core:startup'], listen: ['greet:new'] }));
    await waitFor(() => core.log.byType('config-update').some((l) => l.module === 'greeter'));
    // 重启：先停后启
    await waitFor(() => {
      const stops = core.log.byType('module-stop').filter((s) => s.module === 'greeter').length;
      const starts = core.log.byType('module-start').filter((s) => s.module === 'greeter').length;
      return stops >= 1 && starts >= 2;
    });
    // 新监听生效，旧监听失效
    await core.sendEvent('greet');
    assert.deepEqual(core.array('greet:out'), []);
    await core.sendEvent('greet:new');
    assert.deepEqual(core.array('greet:out'), ['greet:new']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('删除 YAML：模块被停止并移除', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new ConnectCore({ moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
    fs.writeFileSync(path.join(dir, 'greeter.yaml'), yamlFor('greeter', { startEvents: ['core:startup'] }));
    await waitFor(() => core.getModule('greeter')?.status === 'running');
    fs.rmSync(path.join(dir, 'greeter.yaml'));
    await waitFor(() => core.getModule('greeter') === undefined);
    assert.ok(core.log.byType('module-stop').some((s) => s.module === 'greeter'));
    assert.ok(core.log.byType('config-remove').some((l) => l.module === 'greeter'));
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('非法 YAML：记录 config:error，核心继续运行', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new ConnectCore({ moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    fs.writeFileSync(path.join(dir, 'bad.yaml'), 'name: [unclosed\n');
    await waitFor(() => core.log.byType('error').filter((e) => String(e.message).includes('配置解析失败')).length >= 1);
    assert.equal(core.listModules().length, 0);
    // 核心仍然可发事件
    await core.sendEvent('anything:go');
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('相同内容重写：只改 mtime 不触发 config-update（touch 假阳性消除）', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new ConnectCore({ moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    const yamlPath = path.join(dir, 'greeter.yaml');
    const yaml = yamlFor('greeter', { startEvents: ['core:startup'], listen: ['greet'] });
    fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
    fs.writeFileSync(yamlPath, yaml);
    await waitFor(() => core.getModule('greeter')?.status === 'running');
    // 用相同内容重写文件（touch）：指纹变化但哈希相同 -> 不得触发 config-update
    fs.writeFileSync(yamlPath, yaml);
    await sleep(200); // 跨过至少 3 个轮询周期
    assert.equal(core.log.byType('config-update').filter((l) => l.module === 'greeter').length, 0);
    // 事件仍正常送达（模块未被打断重启）
    await core.sendEvent('greet');
    assert.deepEqual(core.array('greet:out'), ['greet']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('快速连续改写：最终收敛到最新配置', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new ConnectCore({ moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    const yamlPath = path.join(dir, 'greeter.yaml');
    fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
    fs.writeFileSync(yamlPath, yamlFor('greeter', { startEvents: ['core:startup'], listen: ['greet'] }));
    await waitFor(() => core.getModule('greeter')?.status === 'running');
    // 连续两次改写：中间态可能被跳过，但最终必须收敛到最新配置
    fs.writeFileSync(yamlPath, yamlFor('greeter', { startEvents: ['core:startup'], listen: ['greet:new'] }));
    fs.writeFileSync(yamlPath, yamlFor('greeter', { startEvents: ['core:startup'], listen: ['greet:final'] }));
    await waitFor(() => core.log.byType('config-update').some((l) => l.module === 'greeter'));
    // 等重启完成（module-stop + module-start 各至少一次）
    await waitFor(() => {
      const stops = core.log.byType('module-stop').filter((s) => s.module === 'greeter').length;
      const starts = core.log.byType('module-start').filter((s) => s.module === 'greeter').length;
      return stops >= 1 && starts >= 2;
    });
    // 最终配置生效：greet:final 可达，旧监听失效
    await core.sendEvent('greet');
    assert.deepEqual(core.array('greet:out'), []);
    await core.sendEvent('greet:final');
    assert.deepEqual(core.array('greet:out'), ['greet:final']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('watch:false 时不自动监听，rescanModules 手动扫描生效', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
    fs.writeFileSync(path.join(dir, 'greeter.yaml'), yamlFor('greeter', { startEvents: ['core:startup'] }));
    // 不自动加载
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(core.listModules().length, 0);
    await core.rescanModules();
    assert.equal(core.listModules().length, 1);
    await waitFor(() => core.getModule('greeter')?.status === 'running');
    await core.stop();
  } finally {
    rmDir(dir);
  }
});