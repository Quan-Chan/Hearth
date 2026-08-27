/**
 * 测试应用：聊天机器人（类似 QQ/Discord 机器人、客服助手）。
 * 场景：用户消息 -> 命令识别 -> 应答，聊天记录与在线用户通过公共数组共享。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, arr } from '../helpers';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MODULE_DIR = path.join(ROOT, 'tests', 'fixtures', 'chat-bot', 'modules');

test('聊天机器人：消息流转、命令应答、历史与用户数组', async () => {
  const tmp = mkTmpDir('chatbot');
  try {
    const core = new ConnectCore({ moduleDir: MODULE_DIR, logFile: path.join(tmp, 'log.log'), watch: false });
    await core.start();
    // 5 个模块全部由 core:startup 自动启动
    assert.deepEqual(
      core.listModules().map((m) => m.name).sort(),
      ['echo', 'gateway', 'help', 'router', 'stats'],
    );
    // 普通消息：进历史，不产生应答
    await core.sendEvent('chat:receive', { user: 'alice', room: 'lobby', text: '大家好' });
    let history = arr(core, 'public:gateway:history');
    assert.equal(history.length, 1);
    assert.equal(history[0].type, 'message');
    assert.equal(history[0].user, 'alice');
    // 新用户进入在线用户数组
    assert.deepEqual(arr(core, 'public:gateway:users').map((u) => u.name), ['alice']);
    // !help -> 消息 + 应答写入历史
    await core.sendEvent('chat:receive', { user: 'bob', room: 'lobby', text: '!help' });
    history = arr(core, 'public:gateway:history');
    assert.equal(history.length, 3); // 消息(大家好) + 消息(!help) + 应答
    assert.equal(history[2].type, 'reply');
    assert.ok(String(history[2].text).includes('!echo'));
    // !echo hi there -> 回声
    await core.sendEvent('chat:receive', { user: 'bob', room: 'lobby', text: '!echo hi there' });
    history = arr(core, 'public:gateway:history');
    assert.equal(history.length, 5);
    assert.equal(history[4].type, 'reply');
    assert.equal(history[4].text, 'hi there');
    // 未知命令：只有消息，无应答
    await core.sendEvent('chat:receive', { user: 'alice', room: 'lobby', text: '!unknown' });
    assert.equal(arr(core, 'public:gateway:history').length, 6);
    // 通配符统计：chat:receive x4 + chat:command x3 + chat:reply x2 = 9 个事件
    assert.equal(arr(core, 'public:stats:stats')[0].count, 9);
    // 日志记录了所有事件（含派生事件）
    const events = core.log.byType('event').map((e) => e.event);
    assert.ok(events.includes('external:chat:receive'));
    assert.ok(events.includes('router:chat:command'));
    assert.ok(events.some((e) => String(e).endsWith(':chat:reply')));
    await core.stop();
  } finally {
    rmDir(tmp);
  }
});

test('聊天机器人：日志文件记录全部事件（原样记录所有发生的事情）', async () => {
  const tmp = mkTmpDir('chatbot');
  try {
    const logFile = path.join(tmp, 'stream.log');
    const core = new ConnectCore({ moduleDir: MODULE_DIR, logFile, watch: false });
    await core.start();
    await core.sendEvent('chat:receive', { user: 'carol', room: 'hall', text: '!help' });
    await core.stop();
    const lines = core.log.readFileLines();
    assert.ok(lines.length > 0);
    const parsed = lines.map((l) => JSON.parse(l));
    // 第一行是核心启动；随后 core:startup 事件被原样记录（无模块监听 -> event-drop）
    assert.equal(parsed[0].type, 'core-start');
    const startup = parsed.find((e) => e.type === 'event-drop' && e.event === 'core:startup');
    assert.ok(startup);
    assert.equal(startup.source, 'core');
    // 模块启动事件被记录
    assert.ok(parsed.some((e) => e.type === 'module-start' && e.module === 'gateway'));
    // 用户消息被原样记录
    const recv = parsed.find((e) => e.type === 'event' && e.event === 'external:chat:receive');
    assert.equal(recv.data.user, 'carol');
    await core.stop();
  } finally {
    rmDir(tmp);
  }
});