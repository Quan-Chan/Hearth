import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { EventStreamLog } from '../../src/core/EventStreamLog';
import { mkTmpDir, rmDir } from '../helpers';

test('record：三字段主结构齐全，按顺序记录并自动填充时间戳', async () => {
  const log = new EventStreamLog();
  log.record({ type: 'event', source: 'external', message: 'a', event: 'a' });
  log.record({ type: 'event-drop', source: 'external', message: 'b', event: 'b' });
  log.record({ type: 'module-start', source: 'm', message: '启动模块 m', module: 'm' });
  const all = log.all();
  assert.equal(all.length, 3);
  // ① 日志类型 ② 日志来源 ③ 日志信息 全部非空
  assert.ok(all.every((e) => typeof e.type === 'string' && e.type.length > 0));
  assert.ok(all.every((e) => typeof e.source === 'string' && e.source.length > 0));
  assert.ok(all.every((e) => typeof e.message === 'string' && e.message.length > 0));
  assert.ok(all.every((e) => typeof e.t === 'string' && e.t.length > 0));
  assert.equal(all[0].event, 'a');
  assert.equal(all[1].event, 'b');
  assert.equal(log.byType('event').length, 1);
  assert.equal(log.byType('event-drop').length, 1);
  assert.equal(log.byCategory('event').length, 2);
  assert.equal(log.byCategory('module').length, 1);
  await log.close();
});

test('落盘：JSONL 文件与内存一致，目录自动创建', async () => {
  const dir = mkTmpDir('log');
  try {
    const file = path.join(dir, 'logs', 'event-stream.log');
    const log = new EventStreamLog({ filePath: file });
    log.record({ type: 'event', source: 'core', message: 'core:startup', event: 'core:startup' });
    log.record({ type: 'module-start', source: 'greeter', message: '事件 core:startup 匹配启动条件', module: 'greeter' });
    await log.close();
    const lines = log.readFileLines();
    assert.equal(lines.length, 2);
    const parsed = lines.map((l) => JSON.parse(l));
    assert.equal(parsed[0].event, 'core:startup');
    assert.equal(parsed[0].source, 'core');
    assert.equal(parsed[1].module, 'greeter');
    // 文件真实存在于磁盘
    assert.ok(fs.existsSync(file));
    // close 后再次 close 不报错
    await log.close();
  } finally {
    rmDir(dir);
  }
});

test('无文件路径时只记录内存', async () => {
  const log = new EventStreamLog();
  log.record({ type: 'core-start', source: 'core', message: '核心启动' });
  assert.equal(log.all().length, 1);
  await log.close();
});
