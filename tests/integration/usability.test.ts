/**
 * 框架可用性验证：模块可用方法全部端到端跑通。
 *
 * 对应"验证可用性"目标（不添加任何框架辅助功能，全部使用已有 API）：
 *  1. 核心可以真的启动一个模块（start/stop 钩子真实执行、状态机流转）
 *  2. 模块可以发送事件（链式转发、事件来源、通配符路由）
 *  3. 模块可以改变自己的 YAML 配置文件（修改追踪的事件表），核心自动同步
 *     实现方式：模块就是程序（CJS），直接用 Node fs 改写自己的 YAML 文件，
 *     ConfigWatcher 轮询感知内容哈希变化 -> 更新配置并重启模块 —— 框架零改动。
 *  4. 模块上下文全 API 面（exposeArray / unexposeArray / array / sendEvent / log /
 *     config）端到端可用。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, waitFor, yamlFor } from '../helpers';

// ==================== 测试 1：核心真实启动模块，start/stop 钩子执行 ====================

const HOOKED_CJS = `module.exports = {
  name: 'hooked',
  start(ctx) {
    require('fs').appendFileSync(require('path').join(__dirname, 'hooks.log'), 'start\\n');
    ctx.exposeArray('hooked:marks', ['ok']);
  },
  onEvent(ctx, event) {
    ctx.array('hooked:marks').push(event.name);
  },
  stop(ctx) {
    require('fs').appendFileSync(require('path').join(__dirname, 'hooks.log'), 'stop\\n');
  },
};
`;

test('核心可真实启动模块：start/stop 钩子执行，状态机流转正确', async () => {
  const dir = mkTmpDir('hook');
  try {
    fs.writeFileSync(path.join(dir, 'hooked.cjs'), HOOKED_CJS);
    fs.writeFileSync(path.join(dir, 'hooked.yaml'), yamlFor('hooked', { startEvents: ['core:startup'], listen: ['hook:ping'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    // 核心真的启动了模块：状态 running + start 钩子真实执行
    assert.equal(core.getModule('hooked')!.status, 'running');
    assert.equal(fs.readFileSync(path.join(dir, 'hooks.log'), 'utf8'), 'start\n');
    assert.deepEqual(core.array('hooked:marks'), ['ok']);
    // 模块接收事件并处理
    await core.sendEvent('hook:ping');
    assert.deepEqual(core.array('hooked:marks'), ['ok', 'hook:ping']);
    // 停止 -> stop 钩子真实执行
    await core.stopModule('hooked');
    assert.equal(fs.readFileSync(path.join(dir, 'hooks.log'), 'utf8'), 'start\nstop\n');
    assert.equal(core.getModule('hooked')!.status, 'stopped');
    // 重启 -> start 再次执行（状态流转闭环）
    await core.startModule('hooked', 'manual');
    assert.equal(fs.readFileSync(path.join(dir, 'hooks.log'), 'utf8'), 'start\nstop\nstart\n');
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

// ==================== 测试 2：模块上下文全 API 面 ====================

const API_CJS = `const fs = require('fs');
const path = require('path');
const HOOK_FILE = path.join(__dirname, 'hooks.log');
module.exports = {
  name: 'apiuser',
  start(ctx) {
    fs.appendFileSync(HOOK_FILE, 'start\\n');
    ctx.exposeArray('api:pub', [1, 2]);
    ctx.exposeArray('api:scratch', ['s']);
    ctx.exposeArray('api:marks', []);
    ctx.log('api 模块启动，threshold=' + ctx.config.config.threshold);
  },
  onEvent(ctx, event) {
    if (event.name !== 'api:use') return;
    // array()：拿到实时引用后直接原生操作
    ctx.array('api:pub').push(3);
    ctx.array('api:pub').splice(0, 1);
    // array：实时引用，原生数组语法
    ctx.array('api:pub').push(4);
    // unexposeArray：公开者取消自己的数组
    ctx.unexposeArray('api:scratch');
    // config：把结果写进 marks
    ctx.array('api:marks').push({ pub: ctx.array('api:pub'), config: ctx.config });
    // sendEvent：模块产生新事件（链式协作）
    ctx.sendEvent('api:done', { note: '从模块发出的事件' });
  },
  stop(ctx) {
    fs.appendFileSync(HOOK_FILE, 'stop\\n');
  },
};
`;
const SINK_CJS = `module.exports = {
  name: 'sink',
  start(ctx) { ctx.exposeArray('sink:got', []); },
  onEvent(ctx, event) { ctx.array('sink:got').push(event); },
};
`;

test('模块可用方法全景：ctx 8 个方法端到端可用', async () => {
  const dir = mkTmpDir('api');
  try {
    fs.writeFileSync(path.join(dir, 'apiuser.cjs'), API_CJS);
    fs.writeFileSync(
      path.join(dir, 'apiuser.yaml'),
      yamlFor('apiuser', { startEvents: ['core:startup'], listen: ['api:use'], extra: 'config:\n  threshold: 42' }),
    );
    fs.writeFileSync(path.join(dir, 'sink.cjs'), SINK_CJS);
    fs.writeFileSync(path.join(dir, 'sink.yaml'), yamlFor('sink', { startEvents: ['core:startup'], listen: ['api:done'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    assert.deepEqual(core.array('api:pub'), [1, 2]);
    // ctx.config 透传 YAML 配置
    const apiCfg = core.getModule('apiuser')!.config;
    assert.equal(apiCfg.config!.threshold, 42);
    await core.sendEvent('api:use');
    // 原生引用操作效果
    assert.deepEqual(core.array('api:pub'), [2, 3, 4]);
    // marks 里记录了模块视角的数据与 config
    const entry = core.array('api:marks')[0] as any;
    assert.equal(entry.config.config.threshold, 42); // ctx.config = ModuleConfig，嵌套配置在 ctx.config.config（README §3.1 契约）
    // unexposeArray 生效
    assert.ok(!core.listArrays().includes('api:scratch'));
    // sendEvent 链式转发到 sink 模块
    assert.equal(core.array('sink:got').length, 1);
    assert.equal((core.array('sink:got')[0] as any).name, 'api:done');
    assert.equal((core.array('sink:got')[0] as any).data.note, '从模块发出的事件');
    // ctx.log 进入事件流水（module-log）
    const logged = core.log.byType('module-log').filter((e) => e.module === 'apiuser');
    assert.equal(logged.length, 1);
    assert.ok(String(logged[0].message).includes('threshold=42'));
    // 停止 -> stop 钩子执行，数组随模块消失
    await core.stop();
    assert.equal(fs.readFileSync(path.join(dir, 'hooks.log'), 'utf8'), 'start\nstop\n');
  } finally {
    rmDir(dir);
  }
});

// ==================== 测试 3：模块改写自己的 YAML（listen 事件表变化），核心同步 ====================

const SELFEDIT_CJS = `module.exports = {
  name: 'selfedit',
  start(ctx) {
    ctx.exposeArray('selfedit:marks', ['started']);
  },
  onEvent(ctx, event) {
    ctx.array('selfedit:marks').push(event.name);
    if (event.name === 'selfedit:add') {
      const fs = require('fs');
      const path = require('path');
      // 模块自己改写自己的 YAML：listen 增加 selfedit:extra 与 selfedit:*
      const yaml = [
        'name: selfedit',
        'file: ./selfedit.cjs',
        'startEvents:',
        '  - "core:startup"',
        'listen:',
        '  - "selfedit:add"',
        '  - "selfedit:extra"',
        '  - "selfedit:*"',
      ].join('\\n');
      fs.writeFileSync(path.join(__dirname, 'selfedit.yaml'), yaml, 'utf8');
    }
  },
};
`;

test('模块改写自己的 YAML：listen 事件表变化，核心自动同步并重启', async () => {
  const dir = mkTmpDir('self');
  try {
    fs.writeFileSync(path.join(dir, 'selfedit.cjs'), SELFEDIT_CJS);
    fs.writeFileSync(path.join(dir, 'selfedit.yaml'), yamlFor('selfedit', { startEvents: ['core:startup'], listen: ['selfedit:add'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: true, pollIntervalMs: 40 });
    await core.start();
    await waitFor(() => core.getModule('selfedit')?.status === 'running');
    assert.deepEqual(core.array('selfedit:marks'), ['started']);
    // 模块在 onEvent 中改写自己的 YAML（此刻只监听 selfedit:add）
    await core.sendEvent('selfedit:add');
    // 核心感知配置变化（config-update）并重启模块
    await waitFor(() => core.log.byType('config-update').some((l) => l.module === 'selfedit'));
    await waitFor(() => core.log.byType('module-start').filter((s) => s.module === 'selfedit').length >= 2);
    // 核心同步的新追踪事件表（公开 API 可查）
    assert.deepEqual(core.getModule('selfedit')!.config.listen, ['selfedit:add', 'selfedit:extra', 'selfedit:*']);
    // 重启后数组是全新映射：旧数据不残留
    assert.deepEqual(core.array('selfedit:marks'), ['started']);
    // 新加的事件名生效
    await core.sendEvent('selfedit:extra');
    assert.deepEqual(core.array('selfedit:marks'), ['started', 'selfedit:extra']);
    // 新加的通配符监听生效
    await core.sendEvent('selfedit:wild:ping');
    assert.deepEqual(core.array('selfedit:marks'), ['started', 'selfedit:extra', 'selfedit:wild:ping']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

// ==================== 测试 4：模块改写自己的 YAML（startEvents 变化），新启动条件生效 ====================

const BOOTCFG_CJS = `module.exports = {
  name: 'bootcfg',
  start(ctx) {
    ctx.exposeArray('bootcfg:marks', ['started']);
  },
  onEvent(ctx, event) {
    ctx.array('bootcfg:marks').push(event.name);
    if (event.name === 'bootcfg:config') {
      const fs = require('fs');
      const path = require('path');
      // 模块改写自己的 YAML：startEvents 增加 bootcfg:again
      const yaml = [
        'name: bootcfg',
        'file: ./bootcfg.cjs',
        'startEvents:',
        '  - "core:startup"',
        '  - "bootcfg:again"',
        'listen:',
        '  - "bootcfg:config"',
      ].join('\\n');
      fs.writeFileSync(path.join(__dirname, 'bootcfg.yaml'), yaml, 'utf8');
    }
  },
};
`;

test('模块改写自己的 YAML：startEvents 变化，新的启动事件可自动拉起模块', async () => {
  const dir = mkTmpDir('boot');
  try {
    fs.writeFileSync(path.join(dir, 'bootcfg.cjs'), BOOTCFG_CJS);
    fs.writeFileSync(path.join(dir, 'bootcfg.yaml'), yamlFor('bootcfg', { startEvents: ['core:startup'], listen: ['bootcfg:config'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: true, pollIntervalMs: 40 });
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
    assert.deepEqual(core.getModule('bootcfg')!.config.startEvents, ['core:startup', 'bootcfg:again']);
    assert.deepEqual(core.array('bootcfg:marks'), ['started']);
    const starts = core.log.byType('module-start').filter((s) => s.module === 'bootcfg');
    assert.equal(starts[starts.length - 1].reason, 'bootcfg:again');
    await core.stop();
  } finally {
    rmDir(dir);
  }
});
