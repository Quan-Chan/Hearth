import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir } from '../helpers';

/**
 * 模块加载顺序（自然排序）：模块文件夹按自然排序（数字按数值），
 * 加载顺序即启动顺序。m2 在 m10 前、alpha-2 在 alpha-10 前。
 */

function writeModule(dir: string, name: string): void {
  const sub = path.join(dir, name);
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, name + '.cjs'), 'module.exports = { name: "' + name + '", start(ctx) { ctx.exposeArray("mark", []); }, onEvent(ctx) { ctx.array("mark").push("x"); } };');
  fs.writeFileSync(path.join(sub, name + '.yaml'), 'name: ' + name + '\nfile: ./' + name + '.cjs\nstartEvents: ["*:go"]\n');
}

test('模块加载顺序按自然排序：m2 在 m10 前，alpha-2 在 alpha-10 前', async () => {
  const dir = mkTmpDir('nat');
  try {
    for (const m of ['m10', 'alpha-10', 'm2', 'alpha-2']) writeModule(dir, m);
    const core = new ConnectCore({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    await core.sendEvent('go');
    const reg = core.listModules().map((m) => m.name);
    assert.deepEqual(reg, ['alpha-2', 'alpha-10', 'm2', 'm10']);
    const starts = core.log.byType('module-start').map((e) => e.source);
    assert.deepEqual(starts, ['alpha-2', 'alpha-10', 'm2', 'm10']);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});