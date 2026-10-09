/**
 * 测试产物自足：集成测试在 worker 内加载核心时读取 .test-build 下的编译产物，
 * 与 tsconfig.test.json 的 outDir 对应，不依赖 npm run build 生成的 dist。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import { coreEntryPath } from '../helpers';

const ROOT = path.resolve(__dirname, '..', '..', '..');

test('核心测试产物位于 .test-build 且可在 worker 内加载', async () => {
  assert.ok(
    !path.relative(ROOT, coreEntryPath).split(path.sep).includes('dist'),
    '核心测试产物路径不得经过 dist：' + coreEntryPath,
  );
  assert.ok(fs.existsSync(coreEntryPath), '缺少测试编译产物：' + coreEntryPath);
  const hasStart = await new Promise<boolean>((resolve, reject) => {
    const w = new Worker(
      `
      const { parentPort, workerData } = require('worker_threads');
      const { Hearth } = require(workerData.corePath);
      parentPort.postMessage(typeof Hearth.prototype.start === 'function');
      `,
      { eval: true, workerData: { corePath: coreEntryPath } },
    );
    w.on('message', (msg) => resolve(msg as boolean));
    w.on('error', (err) => reject(err));
  });
  assert.equal(hasStart, true, 'worker 内加载的核心导出缺少 start 方法');
});
