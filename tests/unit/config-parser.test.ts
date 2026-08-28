import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { parseModuleConfig } from '../../src/core/ConfigWatcher';

const BASE = path.resolve('/base/modules');

test('最小配置：默认值正确', () => {
  const cfg = parseModuleConfig('name: hello\nfile: ./hello.cjs\n', BASE);
  assert.equal(cfg.name, 'hello');
  assert.equal(cfg.file, path.join(BASE, 'hello.cjs'));
  assert.equal(cfg.startEvents, undefined);
  assert.equal(cfg.listen, undefined);
  assert.equal(cfg.enabled, true);
  assert.deepEqual(cfg.config, {});
});

test('完整配置：所有字段解析正确', () => {
  const yaml = [
    'name: greeter',
    'file: ./greeter.cjs',
    'startEvents:',
    '  - "core:startup"',
    'listen:',
    '  - "greet"',
    '  - "chat:*"',
    'enabled: false',
    'config:',
    '  threshold: 100',
    '  label: "生产环境"',
  ].join('\n');
  const cfg = parseModuleConfig(yaml, BASE);
  assert.deepEqual(cfg.startEvents, ['core:startup']);
  assert.deepEqual(cfg.listen, ['greet', 'chat:*']);
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.config!.threshold, 100);
  assert.equal(cfg.config!.label, '生产环境');
});

test('startEvents 可以是单个字符串', () => {
  const cfg = parseModuleConfig('name: a\nfile: ./a.cjs\nstartEvents: "core:startup"\n', BASE);
  assert.deepEqual(cfg.startEvents, ['core:startup']);
});

test('非法输入：坏 YAML / 缺 name / 缺 file / 顶层非对象', () => {
  assert.throws(() => parseModuleConfig('name: [unclosed', BASE), /YAML parse failed/);
  assert.throws(() => parseModuleConfig('file: ./a.cjs\n', BASE), /missing name/);
  assert.throws(() => parseModuleConfig('name: a\n', BASE), /missing file/);
  assert.throws(() => parseModuleConfig('- a\n- b\n', BASE), /top level must be a mapping object/);
});