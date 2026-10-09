/**
 * 启动整个软件：从公共入口 startCore 启动核心 == 启动整个软件，
 * 无需单独启动任何模块（模块按 YAML 的 startEvents 看事件自动启动）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { startCore, createCore } from '../../src/index';
import { mkTmpDir, rmDir, items, yamlFor } from '../helpers';

test('startCore：一次启动软件，模块按事件自动启动', async () => {
  const tmp = mkTmpDir('boot');
  try {
    // 自包含夹具：hello 模块 core:startup 即启动；echo 模块监听 greet
    fs.writeFileSync(
      path.join(tmp, 'hello.cjs'),
      `module.exports = { name: 'hello', start(ctx){ ctx.exposeObject('marks', { items: ['ready'] }); }, onEvent(ctx, e){ ctx.object('marks').items.push(e.name); } };`,
    );
    fs.writeFileSync(path.join(tmp, 'hello.yaml'), yamlFor('hello', { startEvents: ['core:startup'], listen: ['*:greet'] }));
    fs.writeFileSync(
      path.join(tmp, 'echo.cjs'),
      `module.exports = { name: 'echo', onEvent(ctx, e){ if (e.name.endsWith(':echo')) ctx.sendEvent('greet', { name: e.data && e.data.text }); } };`,
    );
    fs.writeFileSync(path.join(tmp, 'echo.yaml'), yamlFor('echo', { startEvents: ['core:startup'], listen: ['*:echo'] }));

    const core = await startCore({ moduleDir: tmp, logFile: path.join(tmp, 'boot.log'), watch: false });
    assert.equal(core.started, true);
    // 无需手动启动任何模块：core:startup 自动拉起
    assert.deepEqual(core.listModules().map((m) => m.name).sort(), ['echo', 'hello']);
    assert.equal(core.getModule('hello')!.status, 'running');
    // 链式协作：echo 事件 -> greet 事件 -> hello 记录
    await core.sendEvent('echo', { text: '世界' });
    assert.deepEqual(items(core as any, 'public:hello:marks'), ['ready', 'echo:greet']);
    await core.stop();
    assert.equal(core.started, false);
  } finally {
    rmDir(tmp);
  }
});

test('createCore + start 与 startCore 等价', async () => {
  const tmp = mkTmpDir('boot');
  try {
    fs.writeFileSync(
      path.join(tmp, 'hello.cjs'),
      `module.exports = { name: 'hello', start(){} };`,
    );
    fs.writeFileSync(path.join(tmp, 'hello.yaml'), yamlFor('hello', { startEvents: ['core:startup'] }));
    const core = createCore({ moduleDir: tmp, logFile: path.join(tmp, 'boot.log'), watch: false });
    assert.equal(core.started, false);
    await core.start();
    assert.equal(core.started, true);
    assert.equal(core.getModule('hello')!.status, 'running');
    await core.stop();
  } finally {
    rmDir(tmp);
  }
});