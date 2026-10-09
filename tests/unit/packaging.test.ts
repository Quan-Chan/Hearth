import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 打包与命令行元数据约束：
 *  - dist 被 .gitignore 忽略，克隆后不存在，发布前必须构建；
 *  - bin 指向 dist/hearth.js，其首行 shebang 来自 src/hearth.ts，由 tsc 保留；
 *  - exports 给出 require 与 types 入口，与 main/types/bin 并存。
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('发布前置：prepublishOnly 构建 dist', () => {
  assert.equal(pkg.scripts.prepublishOnly, 'npm run build');
});

test('files 收录 dist，main/types/bin 都指向 dist 内的文件', () => {
  assert.deepEqual(pkg.files, ['dist']);
  for (const target of [pkg.main, pkg.types, pkg.bin.hearth]) {
    assert.ok(target.startsWith('dist/'), target);
  }
});

test('src/hearth.ts 首行是 shebang', () => {
  const first = fs.readFileSync(path.join(ROOT, 'src', 'hearth.ts'), 'utf8').split(/\r?\n/)[0];
  assert.equal(first, '#!/usr/bin/env node');
});

test('包元数据：repository/bugs/homepage 指向 Hearth 仓库', () => {
  assert.equal(pkg.repository.url, 'https://github.com/Quan-Chan/Hearth.git');
  assert.ok(pkg.bugs.url.startsWith('https://github.com/Quan-Chan/Hearth'), pkg.bugs.url);
  assert.ok(pkg.homepage.startsWith('https://github.com/Quan-Chan/Hearth'), pkg.homepage);
});

test('exports 同时提供 require 与 types 入口，bin 入口可解析', () => {
  const entry = pkg.exports['.'];
  assert.equal(entry.require, './dist/index.js');
  assert.equal(entry.types, './dist/index.d.ts');
  assert.ok(pkg.exports['./dist/hearth.js'], 'bin 指向的文件需要出现在 exports 里');
});
