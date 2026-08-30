/**
 * 进程守卫（已知问题 7）：guardProcess 开启时，模块私下发起的
 * 未处理异步失败（unhandledRejection）与未捕获异常（uncaughtException）
 * 被捕获并写入 error 日志，进程不退出。
 * 用 worker_threads 隔离：guardProcess 是进程级安装，在 worker 内开启不污染主进程。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import { mkTmpDir, rmDir } from '../helpers';

const ROOT = path.resolve(__dirname, '..', '..', '..');

function runInWorker(guardOn: boolean, dir: string): Promise<{ hasRejection: boolean; hasException: boolean; errCount: number; exitOk: boolean }> {
  return new Promise((resolve, reject) => {
    const workerCode = `
      const { parentPort, workerData } = require('worker_threads');
      const { Hearth } = require(workerData.corePath);
      const fs = require('fs');
      const path = require('path');
      const dir = workerData.dir;
      fs.writeFileSync(path.join(dir, 'bad.cjs'), 'module.exports = { start() { setTimeout(() => { Promise.reject(new Error("private async failure")); }, 30); setTimeout(() => { throw new Error("private sync exception"); }, 60); } };');
      fs.writeFileSync(path.join(dir, 'bad.yaml'), 'name: bad\\nfile: ./bad.cjs\\nstartEvents: ["core:startup"]\\n');
      const core = new Hearth({ moduleDir: dir, watch: false, guardProcess: ${guardOn}, logFile: path.join(dir, 'app.log') });
      core.start().then(() => {
        setTimeout(() => {
          const errs = core.log.byType('error');
          const hasRejection = errs.some(e => String(e.message).includes('caught unhandled async failure'));
          const hasException = errs.some(e => String(e.message).includes('caught uncaught exception'));
          parentPort.postMessage({ hasRejection, hasException, errCount: errs.length });
        }, 300);
      });
    `;
    const w = new Worker(workerCode, {
      eval: true,
      workerData: { corePath: path.join(ROOT, 'dist', 'core', 'Hearth.js'), dir },
    });
    w.on('message', (msg) => resolve({ ...msg, exitOk: true }));
    w.on('error', (err) => reject(err));
    w.on('exit', (code) => {
      if (code !== 0) resolve({ hasRejection: false, hasException: false, errCount: 0, exitOk: false });
    });
  });
}

test('guardProcess 开启：未处理异步失败与未捕获异常被捕获记日志，进程不退出', async () => {
  const dir = mkTmpDir('guard');
  try {
    const r = await runInWorker(true, dir);
    assert.equal(r.hasRejection, true, '应捕获 unhandledRejection 并记日志');
    assert.equal(r.hasException, true, '应捕获 uncaughtException 并记日志');
    assert.ok(r.errCount >= 2, '应有至少 2 条 error 日志，实际 ' + r.errCount);
  } finally {
    rmDir(dir);
  }
});