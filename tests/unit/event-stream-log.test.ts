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
    // 文件真实存在于磁盘（按天+序号命名的轮转文件）
    assert.ok(fs.readdirSync(path.join(dir, 'logs')).some((n) => /^event-stream\.\d{4}-\d{2}-\d{2}\.\d{3}\.log$/.test(n)));
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

test('轮转：单文件超 128KB 后下一条进新文件，压线记录保持完整不截断', async () => {
  const dir = mkTmpDir('rotate');
  try {
    const file = path.join(dir, 'logs', 'event-stream.log');
    const log = new EventStreamLog({ filePath: file });
    log.record({ type: 'event', source: 'core', message: 'first' });
    const blob = 'y'.repeat(130 * 1024); // 这条写入后文件超过 128KB
    log.record({ type: 'event', source: 'core', message: 'big-crossing', data: { blob } });
    log.record({ type: 'event', source: 'core', message: 'after-limit' });
    await log.close();
    // 三条都在：压线那条没有被截断、也没有被搬家
    const lines = log.readFileLines();
    assert.equal(lines.length, 3);
    const crossing = JSON.parse(lines[1]);
    assert.equal(crossing.message, 'big-crossing');
    assert.equal(crossing.data.blob.length, 130 * 1024); // 完整保留
    const after = JSON.parse(lines[2]);
    assert.equal(after.message, 'after-limit'); // 下一条已进入新文件
    // 确实产生了两个轮转文件
    const names = fs.readdirSync(path.join(dir, 'logs')).filter((n) => n.startsWith('event-stream.'));
    assert.equal(names.length, 2);
  } finally {
    rmDir(dir);
  }
});

test('跨天自动分文件（文件名日期与条目时间一致）', async () => {
  const dir = mkTmpDir('rotate-day');
  try {
    const file = path.join(dir, 'logs', 'event-stream.log');
    const log = new EventStreamLog({ filePath: file });
    log.record({ t: '2026-08-15T23:59:59.000Z', type: 'event', source: 'core', message: 'day1' });
    log.record({ t: '2026-08-16T00:00:01.000Z', type: 'event', source: 'core', message: 'day2' });
    await log.close();
    const names = fs.readdirSync(path.join(dir, 'logs')).filter((n) => n.startsWith('event-stream.')).sort();
    assert.equal(names.length, 2);
    assert.ok(names[0].includes('2026-08-15'));
    assert.ok(names[1].includes('2026-08-16'));
    assert.equal(log.readFileLines().length, 2);
  } finally {
    rmDir(dir);
  }
});

test('进程重启后自动续写当天未超限的文件（不覆盖历史）', async () => {
  const dir = mkTmpDir('rotate-resume');
  try {
    const file = path.join(dir, 'logs', 'event-stream.log');
    const first = new EventStreamLog({ filePath: file });
    first.record({ type: 'event', source: 'core', message: 'a' });
    first.record({ type: 'event', source: 'core', message: 'b' });
    await first.close();
    const second = new EventStreamLog({ filePath: file });
    second.record({ type: 'event', source: 'core', message: 'c' });
    await second.close();
    const names = fs.readdirSync(path.join(dir, 'logs')).filter((n) => n.startsWith('event-stream.'));
    assert.equal(names.length, 1); // 续写同一个文件，没有开新序号
    const lines = second.readFileLines();
    assert.equal(lines.length, 3);
    assert.equal(JSON.parse(lines[2]).message, 'c');
  } finally {
    rmDir(dir);
  }
});
