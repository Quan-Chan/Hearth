import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { loadModuleProgram } from '../../src/module/loadModule';
import { mkTmpDir, rmDir } from '../helpers';

test('加载 CJS 对象模块', async () => {
  const dir = mkTmpDir('loader');
  try {
    const file = path.join(dir, 'm.cjs');
    fs.writeFileSync(
      file,
      `module.exports = {
  name: 'm',
  start(ctx) { ctx.log('started'); },
  onEvent(ctx, event) { ctx.log(event.name); },
};
`,
    );
    const def = await loadModuleProgram(file);
    assert.equal(typeof def.start, 'function');
    assert.equal(typeof def.onEvent, 'function');
    assert.equal((def as any).name, 'm');
  } finally {
    rmDir(dir);
  }
});

test('加载 CJS 工厂函数模块', async () => {
  const dir = mkTmpDir('loader');
  try {
    const file = path.join(dir, 'f.cjs');
    fs.writeFileSync(file, 'module.exports = () => ({ start() {} });\n');
    const def = await loadModuleProgram(file);
    assert.equal(typeof (def as any).start, 'function');
  } finally {
    rmDir(dir);
  }
});

test('加载 ESM (.mjs) 模块', async () => {
  const dir = mkTmpDir('loader');
  try {
    const file = path.join(dir, 'e.mjs');
    fs.writeFileSync(file, 'export default { stop() {} };\n');
    const def = await loadModuleProgram(file);
    assert.equal(typeof (def as any).stop, 'function');
  } finally {
    rmDir(dir);
  }
});

test('文件不存在 / 导出非法 抛错', async () => {
  const dir = mkTmpDir('loader');
  try {
    await assert.rejects(() => loadModuleProgram(path.join(dir, 'ghost.cjs')), /not found/);
    const file = path.join(dir, 'bad.cjs');
    fs.writeFileSync(file, 'module.exports = "just a string";\n');
    await assert.rejects(() => loadModuleProgram(file), /must be an object or factory function/);
  } finally {
    rmDir(dir);
  }
});

test('热更新：清缓存后重新加载得到新代码', async () => {
  const dir = mkTmpDir('loader');
  try {
    const file = path.join(dir, 'hot.cjs');
    fs.writeFileSync(file, 'module.exports = { tag: "v1" };\n');
    const first = await loadModuleProgram(file);
    fs.writeFileSync(file, 'module.exports = { tag: "v2" };\n');
    const second = await loadModuleProgram(file);
    assert.equal((first as any).tag, 'v1');
    assert.equal((second as any).tag, 'v2');
  } finally {
    rmDir(dir);
  }
});