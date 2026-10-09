import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { Hearth } from '../../src/core/Hearth';
import { EventStreamLog } from '../../src/core/EventStreamLog';
import { mkTmpDir, rmDir } from '../helpers';

/**
 * 名称校验与资源独占：
 *  - 模块名与对象名不能含冒号（':' 是事件名/对象名的分隔符）；
 *  - 同一日志文件只允许一个 EventStreamLog 实例；
 *  - rescanModules 返回是否真正执行。
 */

test('模块名含冒号：配置解析抛错', () => {
  const dir = mkTmpDir('name');
  try {
    fs.writeFileSync(path.join(dir, 'a.cjs'), 'module.exports = { start() {} };');
    fs.writeFileSync(path.join(dir, 'a.yaml'), 'name: "my:mod"\nfile: ./a.cjs\n');
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: true, pollIntervalMs: 30 });
    return core.start().then(() => {
      // 坏配置记 error，模块不注册
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          assert.equal(core.getModule('my:mod'), undefined);
          assert.ok(core.log.byType('error').some((e) => String(e.message).includes('must not contain')));
          resolve();
        }, 200);
      });
    }).finally(() => core.stop());
  } finally {
    rmDir(dir);
  }
});

test('对象名含冒号：expose 抛错', async () => {
  const dir = mkTmpDir('arrname');
  try {
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    assert.throws(() => core.exposeObject('a:b', 'owner', { items: [] }), /must not contain/);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});

test('同一日志文件不允许两个实例', async () => {
  const dir = mkTmpDir('logx');
  try {
    const file = path.join(dir, 'shared.log');
    const log1 = new EventStreamLog({ filePath: file });
    log1.record({ type: 'core-start', source: 'core', message: 'a' });
    assert.throws(() => new EventStreamLog({ filePath: file }), /already in use/);
    await log1.close();
    // close 后释放，可再创建
    const log2 = new EventStreamLog({ filePath: file });
    log2.record({ type: 'core-start', source: 'core', message: 'b' });
    await log2.close();
  } finally {
    rmDir(dir);
  }
});

test('rescanModules 返回是否真正执行', async () => {
  const dir = mkTmpDir('rescan');
  try {
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    // watch:false 时手动扫描：第一次执行返回 true
    fs.writeFileSync(path.join(dir, 'm.cjs'), 'module.exports = { start() {} };');
    fs.writeFileSync(path.join(dir, 'm.yaml'), 'name: m\nfile: ./m.cjs\n');
    const ok = await core.rescanModules();
    assert.equal(ok, true);
    assert.equal(core.getModule('m') !== undefined, true);
    // 停机中调用返回 false
    await core.stop();
    const afterStop = await core.rescanModules();
    assert.equal(afterStop, false);
  } finally {
    rmDir(dir);
  }
});