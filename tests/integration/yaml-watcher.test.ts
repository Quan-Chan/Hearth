import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { Hearth } from '../../src/core/Hearth';
import { mkTmpDir, rmDir, waitFor, sleep, items, yamlFor } from '../helpers';

const GREETER = `module.exports = {
  name: 'greeter',
  start(ctx) { ctx.exposeObject('out', { items: [] }); },
  onEvent(ctx, event) { ctx.object('out').items.push(event.name); },
};
`;
const LATE = `module.exports = {
  name: 'late',
  onEvent(ctx, event) { ctx.object('marks').items.push(event.name); },
  start(ctx) { ctx.exposeObject('marks', { items: ['late-started'] }); },
};
`;

test('监听模块文件夹：新增 YAML 自动加载并注册，不补启动，手动启动后事件送达', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    assert.equal(core.listModules().length, 0);
    // 放入新的 YAML 配置 + 程序（先写程序文件，避免加载竞态）
    fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
    fs.writeFileSync(path.join(dir, 'greeter.yaml'), yamlFor('greeter', { startEvents: ['core:startup'], listen: ['*:greet'] }));
    await waitFor(() => core.getModule('greeter') !== undefined);
    assert.ok(core.log.byType('config-load').some((l) => l.source === 'greeter'));
    // core:startup 已发生过，不自动补启动
    assert.equal(core.getModule('greeter')!.status, 'stopped');
    await core.startModule('greeter');
    await waitFor(() => core.getModule('greeter')!.status === 'running');
    // 事件可以正常送达
    await core.sendEvent('greet', { name: 'world' });
    assert.deepEqual(items(core as any, 'public:greeter:out'), ['external:greet']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('新增模块：启动事件未发生过则不启动，事件到来时启动', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    fs.writeFileSync(path.join(dir, 'late.cjs'), LATE);
    fs.writeFileSync(path.join(dir, 'late.yaml'), yamlFor('late', { startEvents: ['*:later:event'], listen: ['*:later:event'] }));
    await waitFor(() => core.getModule('late') !== undefined);
    // 事件未出现过 -> 未启动
    assert.equal(core.getModule('late')!.status, 'stopped');
    // 事件出现 -> 启动
    await core.sendEvent('later:event');
    await waitFor(() => core.getModule('late')!.status === 'running');
    assert.deepEqual(items(core as any, 'public:late:marks'), ['late-started', 'external:later:event']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('YAML 变化：YAML 层热生效——索引即时更新，模块不重启、不重载代码', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    const yamlPath = path.join(dir, 'greeter.yaml');
    fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
    fs.writeFileSync(yamlPath, yamlFor('greeter', { startEvents: ['core:startup'], listen: ['*:greet'] }));
    await waitFor(() => core.getModule('greeter') !== undefined);
    await core.startModule('greeter');
    await waitFor(() => core.getModule('greeter')!.status === 'running');
    const startCount = core.log.byType('module-start').filter((s) => s.source === 'greeter').length;
    // 修改 YAML：listen 改为另一事件（YAML 更新 ≠ 代码重载）
    fs.writeFileSync(yamlPath, yamlFor('greeter', { startEvents: ['core:startup'], listen: ['*:greet:new'] }));
    await waitFor(() => core.log.byType('config-update').some((l) => l.source === 'greeter'));
    // 不重启：启动次数未增加、无 module-stop（实例与代码不动）
    assert.equal(core.log.byType('module-start').filter((s) => s.source === 'greeter').length, startCount, '配置更新不重启模块');
    assert.equal(core.log.byType('module-stop').filter((s) => s.source === 'greeter').length, 0);
    // 匹配索引即时更新：新监听生效，旧监听失效
    await core.sendEvent('greet');
    assert.deepEqual(items(core as any, 'public:greeter:out'), []);
    await core.sendEvent('greet:new');
    assert.deepEqual(items(core as any, 'public:greeter:out'), ['external:greet:new']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('删除 YAML：模块被停止并移除', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
    fs.writeFileSync(path.join(dir, 'greeter.yaml'), yamlFor('greeter', { startEvents: ['core:startup'] }));
    await waitFor(() => core.getModule('greeter') !== undefined);
    await core.startModule('greeter');
    await waitFor(() => core.getModule('greeter')!.status === 'running');
    fs.rmSync(path.join(dir, 'greeter.yaml'));
    await waitFor(() => core.getModule('greeter') === undefined);
    assert.ok(core.log.byType('module-stop').some((s) => s.source === 'greeter'));
    assert.ok(core.log.byType('config-remove').some((l) => l.source === 'greeter'));
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('非法 YAML：记录 config:error，核心继续运行', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 50 });
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
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    assert.equal(core.getModule('greeter')!.status, 'running');
    // 用相同内容重写文件（touch）：指纹变化但哈希相同 -> 不得触发 config-update
    fs.writeFileSync(yamlPath, yaml);
    await sleep(200); // 跨过至少 3 个轮询周期
    assert.equal(core.log.byType('config-update').filter((l) => l.source === 'greeter').length, 0);
    // 事件仍正常送达（模块未被打断重启）
    await core.sendEvent('greet');
    assert.deepEqual(items(core as any, 'public:greeter:out'), ['external:greet']);
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
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 50 });
    await core.start();
    assert.equal(core.getModule('greeter')!.status, 'running');
    // 连续两次改写：中间态可能被跳过，最终必须收敛到最新配置
    fs.writeFileSync(yamlPath, yamlFor('greeter', { startEvents: ['core:startup'], listen: ['*:greet:new'] }));
    fs.writeFileSync(yamlPath, yamlFor('greeter', { startEvents: ['core:startup'], listen: ['*:greet:final'] }));
    // 最终配置生效（config.listen 收敛为 final；无重启）
    await waitFor(() => (core.getModule('greeter')!.config.listen ?? []).includes('*:greet:final'));
    assert.equal(core.log.byType('module-start').filter((s) => s.source === 'greeter').length, 1, '未重启');
    await core.sendEvent('greet');
    assert.deepEqual(items(core as any, 'public:greeter:out'), []);
    await core.sendEvent('greet:final');
    assert.deepEqual(items(core as any, 'public:greeter:out'), ['external:greet:final']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('watch:false 时不自动监听，rescanModules 手动扫描生效', async () => {
  const dir = mkTmpDir('watch');
  try {
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
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
  start(ctx) { ctx.exposeObject('marks', { items: ['started'] }); },
  onEvent(ctx, event) {
    ctx.object('marks').items.push(event.name);
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
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 40 });
    await core.start();
    await waitFor(() => core.getModule('selfedit')?.status === 'running');
    assert.deepEqual(items(core as any, 'public:selfedit:marks'), ['started']);
    // 模块在 onEvent 中改写自己的 YAML（此刻只监听 selfedit:add）
    await core.sendEvent('selfedit:add');
    // 核心感知配置变化（config-update）——YAML 层热生效
    await waitFor(() => core.log.byType('config-update').some((l) => l.source === 'selfedit'));
    // 核心同步的新追踪事件表（公开 API 可查）
    assert.deepEqual(core.getModule('selfedit')!.config.listen, ['*:selfedit:add', '*:selfedit:extra', '*:selfedit:*']);
    // 不重启、不重载代码：start 只发生一次，模块实例状态保留
    assert.equal(core.log.byType('module-start').filter((s) => s.source === 'selfedit').length, 1, '模块未重启');
    assert.deepEqual(items(core as any, 'public:selfedit:marks'), ['started', 'external:selfedit:add'], '实例状态保留');
    // 新加的事件名即时生效（索引已更新）
    await core.sendEvent('selfedit:extra');
    assert.deepEqual(items(core as any, 'public:selfedit:marks'), ['started', 'external:selfedit:add', 'external:selfedit:extra']);
    // 新加的通配符监听生效
    await core.sendEvent('selfedit:wild:ping');
    assert.deepEqual(items(core as any, 'public:selfedit:marks'), ['started', 'external:selfedit:add', 'external:selfedit:extra', 'external:selfedit:wild:ping']);
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
  start(ctx) { ctx.exposeObject('marks', { items: ['started'] }); },
  onEvent(ctx, event) {
    ctx.object('marks').items.push(event.name);
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
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 40 });
    await core.start();
    await waitFor(() => core.getModule('bootcfg')?.status === 'running');
    // 模块改写自己的 YAML：startEvents 增加 bootcfg:again
    await core.sendEvent('bootcfg:config');
    await waitFor(() => core.log.byType('config-update').some((l) => l.source === 'bootcfg'));
    // 核心已同步新 startEvents；停止模块
    await core.stopModule('bootcfg');
    assert.equal(core.getModule('bootcfg')!.status, 'stopped');
    // 新的启动事件出现 -> 核心自动启动模块
    await core.sendEvent('bootcfg:again');
    await waitFor(() => core.getModule('bootcfg')!.status === 'running');
    assert.deepEqual(core.getModule('bootcfg')!.config.startEvents, ['core:startup', '*:bootcfg:again']);
    assert.deepEqual(items(core as any, 'public:bootcfg:marks'), ['started']);
    const starts = core.log.byType('module-start').filter((s) => s.source === 'bootcfg');
    assert.equal(starts[starts.length - 1].reason, 'external:bootcfg:again');
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('YAML 改名：name 变化按移除加重建处理，旧名槽位不残留，删除后两个名字都不残留', async () => {
  const dir = mkTmpDir('rename');
  try {
    const ren = `module.exports = {
  name: 'ren',
  start(ctx) { ctx.exposeObject('marks', { items: ['started'] }); },
  stop(ctx) { require('fs').appendFileSync(require('path').join(__dirname, 'stops.txt'), ctx.moduleName + '\\n'); },
};
`;
    fs.writeFileSync(path.join(dir, 'ren.cjs'), ren);
    fs.writeFileSync(path.join(dir, 'ren.yaml'), yamlFor('ren', { startEvents: ['core:startup'] }));
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 40 });
    await core.start();
    await waitFor(() => core.getModule('ren')?.status === 'running');
    assert.deepEqual(core.listModules().map((m) => m.name), ['ren']);
    // 只改 name 字段，文件路径不变
    fs.writeFileSync(path.join(dir, 'ren.yaml'), yamlFor('ren2', { startEvents: ['core:startup'] }));
    await waitFor(() => core.getModule('ren') === undefined);
    await waitFor(
      () => core.listModules().length === 1 && core.getModule('ren2') !== undefined,
    );
    assert.deepEqual(core.listModules().map((m) => m.name), ['ren2']);
    // 旧名走移除路径，旧实例被停止
    assert.ok(core.log.byType('config-remove').some((l) => l.source === 'ren'));
    assert.deepEqual(fs.readFileSync(path.join(dir, 'stops.txt'), 'utf8').split('\n').filter((l) => l.length > 0), ['ren']);
    // 文件删除后，两个名字都不残留
    fs.rmSync(path.join(dir, 'ren.yaml'));
    await waitFor(() => core.listModules().length === 0);
    assert.equal(core.getModule('ren'), undefined);
    assert.equal(core.getModule('ren2'), undefined);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('YAML 改名撞上已占用的模块名：旧名不移除，旧实例继续运行', async () => {
  const dir = mkTmpDir('rename-taken');
  try {
    const prog = (name: string): string => `module.exports = {
  name: '${name}',
  start(ctx) { ctx.exposeObject('marks', { items: ['started'] }); },
};
`;
    fs.writeFileSync(path.join(dir, 'one.cjs'), prog('one'));
    fs.writeFileSync(path.join(dir, 'two.cjs'), prog('two'));
    const oneYaml = path.join(dir, 'one.yaml');
    fs.writeFileSync(oneYaml, yamlFor('one', { startEvents: ['core:startup'] }));
    fs.writeFileSync(path.join(dir, 'two.yaml'), yamlFor('two', { startEvents: ['core:startup'] }));
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 40 });
    await core.start();
    await waitFor(() => core.getModule('one')?.status === 'running' && core.getModule('two')?.status === 'running');
    // one.yaml 的 name 改成已被 two.yaml 占用的 two（内容与 two.yaml 不同，改名会被消费方拒绝）
    fs.writeFileSync(oneYaml, yamlFor('two', { startEvents: ['core:startup'], listen: ['*:ping'] }));
    await waitFor(() =>
      core.log.all().some((l) => l.type === 'error' && l.source === 'two' && String(l.message).includes('rejected')),
    );
    // 改名被拒：one 没有被移除，两个模块都还在运行
    assert.deepEqual(core.listModules().map((m) => m.name), ['one', 'two']);
    assert.equal(core.getModule('one')!.status, 'running');
    assert.deepEqual(items(core, 'public:one:marks'), ['started']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

// ============ 启动过程中改 YAML：在途启动的收敛 ============

/** start() 阻塞在 gate 文件上（测试放行后才返回），用于制造"启动中"窗口。 */
const SLOW_START = `const fs = require('fs');
const path = require('path');
const HOOK = path.join(__dirname, 'slow.log');
const GATE = path.join(__dirname, 'slow.gate');
module.exports = {
  start() {
    fs.appendFileSync(HOOK, 'start\\n');
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (fs.existsSync(GATE)) {
          clearInterval(timer);
          fs.appendFileSync(HOOK, 'start-return\\n');
          resolve();
        }
      }, 10);
      timer.unref();
    });
  },
  stop() { fs.appendFileSync(HOOK, 'stop\\n'); },
};
`;

test('启动中改 YAML：在途启动完成后状态与实际一致（不留在 starting）', async () => {
  const dir = mkTmpDir('start-update');
  try {
    const yamlPath = path.join(dir, 'slowstart.yaml');
    fs.writeFileSync(path.join(dir, 'slowstart.cjs'), SLOW_START);
    fs.writeFileSync(yamlPath, yamlFor('slowstart', { listen: ['*:slow:ping'] }));
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 40 });
    await core.start();
    // 启动不等待返回：start() 阻塞在 gate 上，状态停在 starting
    const starting = core.startModule('slowstart', 'manual');
    await waitFor(() => core.getModule('slowstart')!.status === 'starting');
    // 启动中改写 YAML：配置更新作废这次在途启动（代数递增）
    fs.writeFileSync(yamlPath, yamlFor('slowstart', { listen: ['*:slow:ping', '*:slow:other'] }));
    await waitFor(() => core.log.byType('config-update').some((l) => l.source === 'slowstart'));
    fs.writeFileSync(path.join(dir, 'slow.gate'), '');
    await starting;
    // 在途启动完成后：状态收敛为 stopped（启动结果作废并被回收），与实际一致
    assert.equal(core.getModule('slowstart')!.status, 'stopped');
    const hook = fs.readFileSync(path.join(dir, 'slow.log'), 'utf8');
    assert.ok(hook.includes('start-return'), 'start 已返回');
    assert.ok(hook.includes('stop'), '作废的实例已被回收（stop 调用过）');
    // 状态已收敛：此后停止走正常运行分支，不再记 cancelled during start
    await core.stopModule('slowstart');
    assert.equal(
      core.log.byType('module-stop').filter((l) => l.source === 'slowstart' && String(l.message).includes('cancelled during start')).length,
      0,
    );
    // 启动锁已释放：可以再次启动（start 第二次不再阻塞在 gate 上）
    await core.startModule('slowstart', 'manual');
    assert.equal(core.getModule('slowstart')!.status, 'running');
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

/** start() 阻塞在 gate 上，放行后公开一个对象：用于观察作废实例公开的对象是否被注销。 */
const SLOW_ARRAY_START = `const fs = require('fs');
const path = require('path');
const GATE = path.join(__dirname, 'slowarr.gate');
module.exports = {
  name: 'slowarr',
  start(ctx) {
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (fs.existsSync(GATE)) {
          clearInterval(timer);
          resolve();
        }
      }, 10);
      timer.unref();
    }).then(() => { ctx.exposeObject('marks', { items: ['started'] }); });
  },
  stop() {},
};
`;

test('启动中改 YAML：作废实例公开的对象一并注销，模块可再次启动', async () => {
  const dir = mkTmpDir('start-update-array');
  try {
    const yamlPath = path.join(dir, 'slowarr.yaml');
    fs.writeFileSync(path.join(dir, 'slowarr.cjs'), SLOW_ARRAY_START);
    fs.writeFileSync(yamlPath, yamlFor('slowarr', { listen: ['*:slowarr:ping'] }));
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 40 });
    await core.start();
    const starting = core.startModule('slowarr', 'manual');
    await waitFor(() => core.getModule('slowarr')!.status === 'starting');
    fs.writeFileSync(yamlPath, yamlFor('slowarr', { listen: ['*:slowarr:ping', '*:slowarr:other'] }));
    await waitFor(() => core.log.byType('config-update').some((l) => l.source === 'slowarr'));
    fs.writeFileSync(path.join(dir, 'slowarr.gate'), '');
    await starting;
    assert.equal(core.getModule('slowarr')!.status, 'stopped');
    // 作废实例公开的对象随实例一起注销：名字不被已停止的实例占住
    assert.throws(() => core.object('public:slowarr:marks'), /not found/);
    // 因此可以再次启动，同名对象重新公开
    await core.startModule('slowarr', 'manual');
    assert.equal(core.getModule('slowarr')!.status, 'running');
    assert.deepEqual(items(core, 'public:slowarr:marks'), ['started']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

