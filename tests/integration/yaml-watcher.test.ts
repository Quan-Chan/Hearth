import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, waitFor, sleep, arr, yamlFor } from '../helpers';

const GREETER = `module.exports = {
  name: 'greeter',
  start(ctx) { ctx.exposeArray('out', []); },
  onEvent(ctx, event) { ctx.array('out').push(event.name); },
};
`;
const LATE = `module.exports = {
  name: 'late',
  onEvent(ctx, event) { ctx.array('marks').push(event.name); },
  start(ctx) { ctx.exposeArray('marks', ['late-started']); },
};
`;

test('监听模块文件夹：新增 YAML 自动加载并注册，不补启动，手动启动后事件送达', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new ConnectCore({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    assert.equal(core.listModules().length, 0);
    // 放入新的 YAML 配置 + 程序（先写程序文件，避免加载竞态）
    fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
    fs.writeFileSync(path.join(dir, 'greeter.yaml'), yamlFor('greeter', { startEvents: ['core:startup'], listen: ['*:greet'] }));
    await waitFor(() => core.getModule('greeter') !== undefined);
    assert.ok(core.log.byType('config-load').some((l) => l.module === 'greeter'));
    // core:startup 已发生过，不自动补启动
    assert.equal(core.getModule('greeter')!.status, 'stopped');
    await core.startModule('greeter');
    await waitFor(() => core.getModule('greeter')!.status === 'running');
    // 事件可以正常送达
    await core.sendEvent('greet', { name: 'world' });
    assert.deepEqual(arr(core as any, 'public:greeter:out'), ['external:greet']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('新增模块：启动事件未发生过则不启动，事件到来时启动', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new ConnectCore({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    fs.writeFileSync(path.join(dir, 'late.cjs'), LATE);
    fs.writeFileSync(path.join(dir, 'late.yaml'), yamlFor('late', { startEvents: ['*:later:event'], listen: ['*:later:event'] }));
    await waitFor(() => core.getModule('late') !== undefined);
    // 事件未出现过 -> 未启动
    assert.equal(core.getModule('late')!.status, 'stopped');
    // 事件出现 -> 启动
    await core.sendEvent('later:event');
    await waitFor(() => core.getModule('late')!.status === 'running');
    assert.deepEqual(arr(core as any, 'public:late:marks'), ['late-started', 'external:later:event']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('YAML 变化：YAML 层热生效——索引即时更新，模块不重启、不重载代码', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new ConnectCore({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    const yamlPath = path.join(dir, 'greeter.yaml');
    fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
    fs.writeFileSync(yamlPath, yamlFor('greeter', { startEvents: ['core:startup'], listen: ['*:greet'] }));
    await waitFor(() => core.getModule('greeter') !== undefined);
    await core.startModule('greeter');
    await waitFor(() => core.getModule('greeter')!.status === 'running');
    const startCount = core.log.byType('module-start').filter((s) => s.module === 'greeter').length;
    // 修改 YAML：listen 改为另一事件（YAML 更新 ≠ 代码重载）
    fs.writeFileSync(yamlPath, yamlFor('greeter', { startEvents: ['core:startup'], listen: ['*:greet:new'] }));
    await waitFor(() => core.log.byType('config-update').some((l) => l.module === 'greeter'));
    // 不重启：启动次数未增加、无 module-stop（实例与代码不动）
    assert.equal(core.log.byType('module-start').filter((s) => s.module === 'greeter').length, startCount, '配置更新不重启模块');
    assert.equal(core.log.byType('module-stop').filter((s) => s.module === 'greeter').length, 0);
    // 匹配索引即时更新：新监听生效，旧监听失效
    await core.sendEvent('greet');
    assert.deepEqual(arr(core as any, 'public:greeter:out'), []);
    await core.sendEvent('greet:new');
    assert.deepEqual(arr(core as any, 'public:greeter:out'), ['external:greet:new']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('删除 YAML：模块被停止并移除', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new ConnectCore({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
    fs.writeFileSync(path.join(dir, 'greeter.yaml'), yamlFor('greeter', { startEvents: ['core:startup'] }));
    await waitFor(() => core.getModule('greeter') !== undefined);
    await core.startModule('greeter');
    await waitFor(() => core.getModule('greeter')!.status === 'running');
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
    const core = new ConnectCore({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    fs.writeFileSync(path.join(dir, 'bad.yaml'), 'name: [unclosed\n');
    await waitFor(() => core.log.byType('error').filter((e) => String(e.message).includes('config parse failed')).length >= 1);
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
    const yamlPath = path.join(dir, 'greeter.yaml');
    const yaml = yamlFor('greeter', { startEvents: ['core:startup'], listen: ['*:greet'] });
    fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
    fs.writeFileSync(yamlPath, yaml);
    const core = new ConnectCore({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    assert.equal(core.getModule('greeter')!.status, 'running');
    // 用相同内容重写文件（touch）：指纹变化但哈希相同 -> 不得触发 config-update
    fs.writeFileSync(yamlPath, yaml);
    await sleep(200); // 跨过至少 3 个轮询周期
    assert.equal(core.log.byType('config-update').filter((l) => l.module === 'greeter').length, 0);
    // 事件仍正常送达（模块未被打断重启）
    await core.sendEvent('greet');
    assert.deepEqual(arr(core as any, 'public:greeter:out'), ['external:greet']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('快速连续改写：最终收敛到最新配置（YAML 层，不重启）', async () => {
  const dir = mkTmpDir('watch');
  try {
    const yamlPath = path.join(dir, 'greeter.yaml');
    fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
    fs.writeFileSync(yamlPath, yamlFor('greeter', { startEvents: ['core:startup'], listen: ['*:greet'] }));
    const core = new ConnectCore({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    assert.equal(core.getModule('greeter')!.status, 'running');
    // 连续两次改写：中间态可能被跳过，最终必须收敛到最新配置
    fs.writeFileSync(yamlPath, yamlFor('greeter', { startEvents: ['core:startup'], listen: ['*:greet:new'] }));
    fs.writeFileSync(yamlPath, yamlFor('greeter', { startEvents: ['core:startup'], listen: ['*:greet:final'] }));
    // 最终配置生效（config.listen 收敛为 final；无重启）
    await waitFor(() => (core.getModule('greeter')!.config.listen ?? []).includes('*:greet:final'));
    assert.equal(core.log.byType('module-start').filter((s) => s.module === 'greeter').length, 1, '未重启');
    await core.sendEvent('greet');
    assert.deepEqual(arr(core as any, 'public:greeter:out'), []);
    await core.sendEvent('greet:final');
    assert.deepEqual(arr(core as any, 'public:greeter:out'), ['external:greet:final']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('watch:false 时不自动监听，rescanModules 手动扫描生效', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new ConnectCore({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
    fs.writeFileSync(path.join(dir, 'greeter.yaml'), yamlFor('greeter', { startEvents: ['core:startup'] }));
    // 不自动加载
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(core.listModules().length, 0);
    await core.rescanModules();
    assert.equal(core.listModules().length, 1);
    assert.equal(core.getModule('greeter')!.status, 'stopped');
    await core.startModule('greeter');
    await waitFor(() => core.getModule('greeter')!.status === 'running');
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

// ============ 模块自己改写 YAML（listen/startEvents 变化），核心同步 ============

test('模块改写自己的 YAML：listen 事件表变化，核心同步（不重启、不重载代码）', async () => {
  const dir = mkTmpDir('self');
  try {
    const selfedit = `module.exports = {
  name: 'selfedit',
  start(ctx) { ctx.exposeArray('marks', ['started']); },
  onEvent(ctx, event) {
    ctx.array('marks').push(event.name);
    if (event.name.endsWith(':selfedit:add')) {
      const fs = require('fs');
      const path = require('path');
      const yaml = [
        'name: selfedit',
        'file: ./selfedit.cjs',
        'startEvents:',
        '  - "core:startup"',
        'listen:',
        '  - "*:selfedit:add"',
        '  - "*:selfedit:extra"',
        '  - "*:selfedit:*"',
      ].join('\\n');
      fs.writeFileSync(path.join(__dirname, 'selfedit.yaml'), yaml, 'utf8');
    }
  },
};
`;
    fs.writeFileSync(path.join(dir, 'selfedit.cjs'), selfedit);
    fs.writeFileSync(path.join(dir, 'selfedit.yaml'), yamlFor('selfedit', { startEvents: ['core:startup'], listen: ['*:selfedit:add'] }));
    const core = new ConnectCore({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 40 });
    await core.start();
    await waitFor(() => core.getModule('selfedit')?.status === 'running');
    assert.deepEqual(arr(core as any, 'public:selfedit:marks'), ['started']);
    // 模块在 onEvent 中改写自己的 YAML（此刻只监听 selfedit:add）
    await core.sendEvent('selfedit:add');
    // 核心感知配置变化（config-update）——YAML 层热生效
    await waitFor(() => core.log.byType('config-update').some((l) => l.module === 'selfedit'));
    // 核心同步的新追踪事件表（公开 API 可查）
    assert.deepEqual(core.getModule('selfedit')!.config.listen, ['*:selfedit:add', '*:selfedit:extra', '*:selfedit:*']);
    // 不重启、不重载代码：start 只发生一次，模块实例状态保留
    assert.equal(core.log.byType('module-start').filter((s) => s.module === 'selfedit').length, 1, '模块未重启');
    assert.deepEqual(arr(core as any, 'public:selfedit:marks'), ['started', 'external:selfedit:add'], '实例状态保留');
    // 新加的事件名即时生效（索引已更新）
    await core.sendEvent('selfedit:extra');
    assert.deepEqual(arr(core as any, 'public:selfedit:marks'), ['started', 'external:selfedit:add', 'external:selfedit:extra']);
    // 新加的通配符监听生效
    await core.sendEvent('selfedit:wild:ping');
    assert.deepEqual(arr(core as any, 'public:selfedit:marks'), ['started', 'external:selfedit:add', 'external:selfedit:extra', 'external:selfedit:wild:ping']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('模块改写自己的 YAML：startEvents 变化，新的启动事件可自动拉起模块', async () => {
  const dir = mkTmpDir('boot');
  try {
    const bootcfg = `module.exports = {
  name: 'bootcfg',
  start(ctx) { ctx.exposeArray('marks', ['started']); },
  onEvent(ctx, event) {
    ctx.array('marks').push(event.name);
    if (event.name.endsWith(':bootcfg:config')) {
      const fs = require('fs');
      const path = require('path');
      const yaml = [
        'name: bootcfg',
        'file: ./bootcfg.cjs',
        'startEvents:',
        '  - "core:startup"',
        '  - "*:bootcfg:again"',
        'listen:',
        '  - "bootcfg:config"',
      ].join('\\n');
      fs.writeFileSync(path.join(__dirname, 'bootcfg.yaml'), yaml, 'utf8');
    }
  },
};
`;
    fs.writeFileSync(path.join(dir, 'bootcfg.cjs'), bootcfg);
    fs.writeFileSync(path.join(dir, 'bootcfg.yaml'), yamlFor('bootcfg', { startEvents: ['core:startup'], listen: ['*:bootcfg:config'] }));
    const core = new ConnectCore({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 40 });
    await core.start();
    await waitFor(() => core.getModule('bootcfg')?.status === 'running');
    // 模块改写自己的 YAML：startEvents 增加 bootcfg:again
    await core.sendEvent('bootcfg:config');
    await waitFor(() => core.log.byType('config-update').some((l) => l.module === 'bootcfg'));
    // 核心已同步新 startEvents；停止模块
    await core.stopModule('bootcfg');
    assert.equal(core.getModule('bootcfg')!.status, 'stopped');
    // 新的启动事件出现 -> 核心自动启动模块
    await core.sendEvent('bootcfg:again');
    await waitFor(() => core.getModule('bootcfg')!.status === 'running');
    assert.deepEqual(core.getModule('bootcfg')!.config.startEvents, ['core:startup', '*:bootcfg:again']);
    assert.deepEqual(arr(core as any, 'public:bootcfg:marks'), ['started']);
    const starts = core.log.byType('module-start').filter((s) => s.module === 'bootcfg');
    assert.equal(starts[starts.length - 1].reason, 'external:bootcfg:again');
    await core.stop();
  } finally {
    rmDir(dir);
  }
});