import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { EventStreamLog } from '../../src/core/EventStreamLog';
import { mkTmpDir, rmDir } from '../helpers';

test('record 按顺序记录并自动填充时间戳', () => {
  const log = new EventStreamLog();
  log.record({ type: 'event', event: 'a' });
  log.record({ type: 'event', event: 'b' });
  log.record({ type: 'module:start', module: 'm' });
  const all = log.all();
  assert.equal(all.length, 3);
  assert.equal(all[0].event, 'a');
  assert.equal(all[1].event, 'b');
  assert.ok(all.every((e) => typeof e.t === 'string' && e.t.length > 0));
  assert.equal(log.byType('event').length, 2);
  assert.equal(log.byType('module:start').length, 1);
});

test('落盘：JSONL 文件与内存一致，目录自动创建', async () => {
  const dir = mkTmpDir('log');
  try {
    const file = path.join(dir, 'logs', 'event-stream.log');
    const log = new EventStreamLog({ filePath: file });
    log.record({ type: 'event', event: 'core:startup', source: 'core' });
    log.record({ type: 'module:start', module: 'greeter' });
    await log.close();
    const lines = log.readFileLines();
    assert.equal(lines.length, 2);
    const parsed = lines.map((l) => JSON.parse(l));
    assert.equal(parsed[0].event, 'core:startup');
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
  log.record({ type: 'core:start' });
  assert.equal(log.all().length, 1);
  await log.close();
});
