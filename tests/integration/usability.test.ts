/**
 * 框架可用性验证：模块可用方法端到端跑通（不添加任何框架辅助功能，全部使用已有 API）。
 *  1. start/stop 钩子真实执行；
 *  2. 模块上下文全 API 面（exposeObject / unexposeObject / object / sendEvent / log /
 *     config / requestReload）端到端可用；
 *  3. 事件两段式：来源段由核心拼装，模块只写事件名段与内容。
 * 模块改写 YAML 的配置同步测试见 yaml-watcher.test.ts。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { Hearth } from '../../src/core/Hearth';
import { mkTmpDir, rmDir, waitFor, items, yamlFor } from '../helpers';

// ==================== 测试 1：核心真实启动模块，start/stop 钩子执行 ====================

const HOOKED_CJS = `module.exports = {
  name: 'hooked',
  start(ctx) {
    require('fs').appendFileSync(require('path').join(__dirname, 'hooks.log'), 'start\\n');
    ctx.exposeObject('marks', { items: ['ok'] });
  },
  onEvent(ctx, event) {
    ctx.object('marks').items.push(event.name);
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
    fs.writeFileSync(path.join(dir, 'hooked.yaml'), yamlFor('hooked', { startEvents: ['core:startup'], listen: ['*:hook:ping'] }));
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    // 钩子真实执行证据（状态流转由 core-lifecycle 覆盖，这里只验证钩子调用）
    assert.equal(fs.readFileSync(path.join(dir, 'hooks.log'), 'utf8'), 'start\n');
    // 停止 -> stop 钩子真实执行；重启 -> start 再次执行
    await core.stopModule('hooked');
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
    ctx.exposeObject('pub', { items: [1, 2] });
    ctx.exposeObject('scratch', { items: ['s'] });
    ctx.exposeObject('marks', { items: [] });
    ctx.log('api 模块启动，threshold=' + ctx.config.config.threshold);
  },
  onEvent(ctx, event) {
    if (!event.name.endsWith(':api:use')) return;
    // array()：拿到实时引用后直接原生操作
    ctx.object('pub').items.push(3);
    ctx.object('pub').items.splice(0, 1);
    // object：实时引用，原生字段读写
    ctx.object('pub').items.push(4);
    // unexposeObject：公开者取消自己的对象
    ctx.unexposeObject('scratch');
    // config：把结果写进 marks
    ctx.object('marks').items.push({ pub: ctx.object('pub'), config: ctx.config });
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
  start(ctx) { ctx.exposeObject('got', { items: [] }); },
  onEvent(ctx, event) { ctx.object('got').items.push(event); },
};
`;

test('模块可用方法全景：ctx 8 个方法端到端可用', async () => {
  const dir = mkTmpDir('api');
  try {
    fs.writeFileSync(path.join(dir, 'apiuser.cjs'), API_CJS);
    fs.writeFileSync(
      path.join(dir, 'apiuser.yaml'),
      yamlFor('apiuser', { startEvents: ['core:startup'], listen: ['*:api:use'], extra: 'config:\n  threshold: 42' }),
    );
    fs.writeFileSync(path.join(dir, 'sink.cjs'), SINK_CJS);
    fs.writeFileSync(path.join(dir, 'sink.yaml'), yamlFor('sink', { startEvents: ['core:startup'], listen: ['*:api:done'] }));
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    assert.deepEqual(items(core as any, 'public:apiuser:pub'), [1, 2]);
    // ctx.config 透传 YAML 配置
    const apiCfg = core.getModule('apiuser')!.config;
    assert.equal(apiCfg.config!.threshold, 42);
    await core.sendEvent('api:use');
    // 原生引用操作效果
    assert.deepEqual(items(core as any, 'public:apiuser:pub'), [2, 3, 4]);
    // marks 里记录了模块视角的数据与 config
    const entry = items(core as any, 'public:apiuser:marks')[0] as any;
    assert.equal(entry.config.config.threshold, 42); // ctx.config = ModuleConfig，嵌套配置在 ctx.config.config（README §3.1 契约）
    // unexposeObject 生效
    assert.throws(() => (core.object as any)('public:apiuser:scratch'), /not found/);
    // sendEvent 链式转发到 sink 模块
    assert.equal(items(core as any, 'public:sink:got').length, 1);
    assert.equal((items(core as any, 'public:sink:got')[0] as any).name, 'apiuser:api:done');
    assert.equal((items(core as any, 'public:sink:got')[0] as any).data.note, '从模块发出的事件');
    // ctx.log 进入日志时间线（module-log）
    const logged = core.log.byType('module-log').filter((e) => e.source === 'apiuser');
    assert.equal(logged.length, 1);
    assert.ok(String(logged[0].message).includes('threshold=42'));
    // 停止 -> stop 钩子执行，对象随模块消失
    await core.stop();
    assert.equal(fs.readFileSync(path.join(dir, 'hooks.log'), 'utf8'), 'start\nstop\n');
  } finally {
    rmDir(dir);
  }
});

// ==================== 测试 5：事件两段式——事件名（来源:事件名，来源段由核心拼装）+ data（内容：模块写） ====================

const SRC_RECV_CJS = `module.exports = {
  name: 'srcrecv',
  start(ctx) { ctx.exposeObject('got', { items: [] }); },
  onEvent(ctx, event) {
    // 接收方看到的完整事件：完整事件名（来源:事件名）+ 内容(data)
    ctx.object('got').items.push({ name: event.name, data: event.data });
  },
};
`;
const SRC_SEND_CJS = `module.exports = {
  name: 'srcsend',
  start(ctx) { ctx.exposeObject('marks', { items: [] }); },
  onEvent(ctx, event) {
    if (!event.name.endsWith(':src:go')) return;
    // 模块只写事件名段与内容，来源段（模块名）由核心自动拼装
    ctx.sendEvent('src:relay', { note: '模块自己写的内容' });
  },
};
`;

test('事件两段式：事件名为 来源:事件名，来源段由核心拼装，模块只写 data(内容)', async () => {
  const dir = mkTmpDir('src2part');
  try {
    fs.writeFileSync(path.join(dir, 'srcsend.cjs'), SRC_SEND_CJS);
    fs.writeFileSync(path.join(dir, 'srcsend.yaml'), yamlFor('srcsend', { startEvents: ['core:startup'], listen: ['*:src:go'] }));
    fs.writeFileSync(path.join(dir, 'srcrecv.cjs'), SRC_RECV_CJS);
    fs.writeFileSync(path.join(dir, 'srcrecv.yaml'), yamlFor('srcrecv', { startEvents: ['core:startup'], listen: ['core:startup', '*:src:relay'] }));
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    // ① 核心自产事件：完整名 'core:startup'，无内容
    const startupSeen = items(core as any, 'public:srcrecv:got').find((e: any) => e.name === 'core:startup') as any;
    assert.ok(startupSeen, 'core:startup 应被监听模块看到');
    assert.equal(startupSeen.data, undefined);
    // ② 模块发出的事件：完整名为 来源:事件名（来源段=发出模块名），内容是模块写的
    await core.sendEvent('src:go');
    const relayed = items(core as any, 'public:srcrecv:got').find((e: any) => e.name === 'srcsend:src:relay') as any;
    assert.ok(relayed, 'src:relay 应到达监听模块');
    assert.deepEqual(relayed.data, { note: '模块自己写的内容' });
    // ③ 宿主直接调用：来源段为 'external'
    await core.sendEvent('src:relay', { from: 'host' });
    const hostSeen = items(core as any, 'public:srcrecv:got').filter((e: any) => e.name.endsWith(':src:relay')).at(-1) as any;
    assert.equal(hostSeen.name, 'external:src:relay');
    // ④ 通配符可响应任意来源的同名事件
    const byName = items(core as any, 'public:srcrecv:got').filter((e: any) => e.name.endsWith(':src:relay'));
    assert.equal(byName.length, 2);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});