import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOG_TYPES,
  categoryOf,
  CATEGORY_TITLES,
  formatLogEntry,
  groupLogEntries,
} from '../../src/core/logFormat';
import type { LogEntry } from '../../src/core/EventStreamLog';

test('日志类型命名统一为 kebab-case（域-动作），无风格混杂', () => {
  for (const type of Object.values(LOG_TYPES)) {
    assert.match(String(type), /^[a-z]+(-[a-z]+)*$/, String(type) + ' 不符合 kebab-case');
  }
});

test('categoryOf：类型归类正确', () => {
  assert.equal(categoryOf('event'), 'event');
  assert.equal(categoryOf('event-drop'), 'event');
  assert.equal(categoryOf('module-start'), 'module');
  assert.equal(categoryOf('core-start'), 'core');
  assert.equal(categoryOf('config-load'), 'config');
  assert.equal(categoryOf('module-log'), 'log');
  assert.equal(categoryOf('error'), 'error');
  assert.equal(categoryOf('未知类型'), 'error'); // 未登记类型暴露问题
});

test('CATEGORY_TITLES：所有类别都有标题', () => {
  for (const cat of ['core', 'event', 'module', 'config', 'log', 'error'] as const) {
    assert.ok(CATEGORY_TITLES[cat].length > 0);
  }
});

test('formatLogEntry：HH:MM:SS.mmm [type] source: message + 附加字段', () => {
  const line = formatLogEntry({
    t: '2026-08-16T11:11:55.315Z',
    type: 'event',
    source: 'external',
    message: 'echo',
    event: 'echo',
    data: { text: '世界' },
    recipients: ['echo'],
  } as LogEntry);
  assert.equal(line, '11:11:55.315 [event] external: echo  [转发=echo  data={"text":"世界"}]');
});

test('formatLogEntry：event/event-drop 的 message 就是事件名，不重复显示', () => {
  const line = formatLogEntry({
    t: '2026-08-16T11:11:55.316Z',
    type: 'event-drop',
    source: 'external',
    message: 'nobody',
  } as LogEntry);
  assert.equal(line, '11:11:55.316 [event-drop] external: nobody');
});

test('formatLogEntry：module-start 显示启动原因', () => {
  const line = formatLogEntry({
    t: '2026-08-16T11:11:55.314Z',
    type: 'module-start',
    source: 'greeter',
    message: '事件 core:startup 匹配启动条件',
    reason: 'core:startup',
  } as LogEntry);
  assert.equal(line, '11:11:55.314 [module-start] greeter: 事件 core:startup 匹配启动条件  [reason=core:startup]');
});

test('groupLogEntries：按类别分组、固定顺序、保持时间顺序', () => {
  const entries = [
    { t: 'a', type: 'module-start', source: 'm', message: '启动' },
    { t: 'b', type: 'core-start', source: 'core', message: '核心启动' },
    { t: 'c', type: 'event', source: 'external', message: 'a' },
    { t: 'd', type: 'event-drop', source: 'external', message: 'b' },
  ] as unknown as LogEntry[];
  const groups = groupLogEntries(entries);
  assert.deepEqual(groups.map((g) => g.category), ['core', 'event', 'module']);
  assert.equal(groups[1].lines.length, 2);
});