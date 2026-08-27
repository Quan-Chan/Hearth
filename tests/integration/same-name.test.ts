/**
 * 同名模块拒绝：模块名是全局身份，同名文件一律不准注册（防顶替/伪装注入）。
 *   - 两个 YAML 声明同名 -> 后注册者被拒绝，记 error，先注册者保留
 *   - 拒绝持续可见：被拒文件存在期间每轮扫描都会再次请求并记录
 *   - 先注册者消失（删除 YAML）后，被拒者自动获得注册资格
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, waitFor, arr, yamlFor } from '../helpers';

const IDENTITY_A = `module.exports = {
  start(ctx) { ctx.exposeArray('owner', ['a']); },
  onEvent(ctx, event) { if (event.name.endsWith(':same:ping')) ctx.array('owner').push('a-ping'); },
};
`;

const IDENTITY_UPDATE = `module.exports = {
  start(ctx) { ctx.exposeArray('owner', ['a']); },
  onEvent(ctx, event) {
    if (event.name.endsWith(':same:ping')) ctx.array('owner').push('a-ping');
    if (event.name.endsWith(':same:ping2')) ctx.array('owner').push('a-ping2');
  },
};
`;

const IDENTITY_B = `module.exports = {
  start(ctx) { ctx.exposeArray('owner', ['b']); },
  onEvent(ctx, event) { if (event.name.endsWith(':same:ping')) ctx.array('owner').push('b-ping'); },
};
`;

test('同名模块：第二个文件被拒绝注册，先注册者保留，拒绝有 error 日志', async () => {
  const dir = mkTmpDir('same-name');
  try {
    fs.writeFileSync(path.join(dir, 'a.cjs'), IDENTITY_A);
    fs.writeFileSync(path.join(dir, 'a.yaml'), 'name: identity\nfile: ./a.cjs\nstartEvents:\n  - "core:startup"\nlisten:\n  - "*:same:ping"\n');
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    assert.equal(core.listModules().length, 1);
    assert.equal(core.getModule('identity')!.status, 'running');

    fs.writeFileSync(path.join(dir, 'b.cjs'), IDENTITY_B);
    fs.writeFileSync(path.join(dir, 'b.yaml'), 'name: identity\nfile: ./b.cjs\nstartEvents:\n  - "core:startup"\nlisten:\n  - "same:ping"\n');
    await core.rescanModules();

    assert.equal(core.listModules().length, 1);
    assert.equal(core.getModule('identity')!.status, 'running');
    await core.sendEvent('same:ping');
    assert.deepEqual(arr(core as any, 'public:identity:owner'), ['a', 'a-ping']);
    const errs = core.log.byType('error');
    assert.ok(errs.some((e) => String(e.message).includes('同名')));
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('同名模块：先注册者消失后，被拒者获得注册资格（让位）', async () => {
  const dir = mkTmpDir('same-name-relieve');
  try {
    fs.writeFileSync(path.join(dir, 'a.cjs'), IDENTITY_A);
    fs.writeFileSync(path.join(dir, 'a.yaml'), 'name: identity\nfile: ./a.cjs\nstartEvents:\n  - "core:startup"\n');
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();
    assert.equal(core.listModules().length, 1);

    fs.writeFileSync(path.join(dir, 'b.cjs'), IDENTITY_B);
    fs.writeFileSync(path.join(dir, 'b.yaml'), 'name: identity\nfile: ./b.cjs\nstartEvents:\n  - "core:startup"\n');
    await core.rescanModules();
    assert.equal(core.listModules().length, 1);

    fs.unlinkSync(path.join(dir, 'a.yaml'));
    await core.rescanModules();
    assert.equal(core.listModules().length, 1);
    assert.equal(core.getModule('identity')!.status, 'stopped');
    await core.startModule('identity');
    await waitFor(() => core.getModule('identity')!.status === 'running');
    assert.deepEqual(arr(core as any, 'public:identity:owner'), ['b']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('同名模块：同文件更新不受影响，仍正常应用', async () => {
  const dir = mkTmpDir('same-name-update');
  try {
    fs.writeFileSync(path.join(dir, 'u.cjs'), IDENTITY_UPDATE);
    fs.writeFileSync(path.join(dir, 'u.yaml'), 'name: identity\nfile: ./u.cjs\nstartEvents:\n  - "core:startup"\nlisten:\n  - "*:same:ping"\n');
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();

    fs.writeFileSync(path.join(dir, 'u.yaml'), 'name: identity\nfile: ./u.cjs\nstartEvents:\n  - "core:startup"\nlisten:\n  - "*:same:ping"\n  - "*:same:ping2"\n');
    await core.rescanModules();
    await waitFor(() => core.log.byType('config-update').length >= 1);
    assert.equal(core.listModules().length, 1);
    await core.sendEvent('same:ping2');
    assert.deepEqual(arr(core as any, 'public:identity:owner'), ['a', 'a-ping2']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});