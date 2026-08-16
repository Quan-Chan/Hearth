"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * 测试应用：聊天机器人（类似 QQ/Discord 机器人、客服助手）。
 * 场景：用户消息 -> 命令识别 -> 应答，聊天记录与在线用户通过公共数组共享。
 */
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const path = __importStar(require("path"));
const ConnectCore_1 = require("../../src/core/ConnectCore");
const helpers_1 = require("../helpers");
const ROOT = path.resolve(__dirname, '..', '..', '..');
const MODULE_DIR = path.join(ROOT, 'tests', 'fixtures', 'chat-bot', 'modules');
(0, node_test_1.test)('聊天机器人：消息流转、命令应答、历史与用户数组', async () => {
    const tmp = (0, helpers_1.mkTmpDir)('chatbot');
    try {
        const core = new ConnectCore_1.ConnectCore({ moduleDir: MODULE_DIR, logFile: path.join(tmp, 'log.log'), watch: false });
        await core.start();
        // 5 个模块全部由 core:startup 自动启动
        strict_1.default.deepEqual(core.listModules().map((m) => m.name).sort(), ['echo', 'gateway', 'help', 'router', 'stats']);
        // 普通消息：进历史，不产生应答
        await core.sendEvent('chat:receive', { user: 'alice', room: 'lobby', text: '大家好' });
        let history = core.pullArray('chat:history');
        strict_1.default.equal(history.length, 1);
        strict_1.default.equal(history[0].type, 'message');
        strict_1.default.equal(history[0].user, 'alice');
        // 新用户进入在线用户数组
        strict_1.default.deepEqual(core.pullArray('chat:users').map((u) => u.name), ['alice']);
        // !help -> 消息 + 应答写入历史
        await core.sendEvent('chat:receive', { user: 'bob', room: 'lobby', text: '!help' });
        history = core.pullArray('chat:history');
        strict_1.default.equal(history.length, 3); // 消息(大家好) + 消息(!help) + 应答
        strict_1.default.equal(history[2].type, 'reply');
        strict_1.default.ok(String(history[2].text).includes('!echo'));
        // !echo hi there -> 回声
        await core.sendEvent('chat:receive', { user: 'bob', room: 'lobby', text: '!echo hi there' });
        history = core.pullArray('chat:history');
        strict_1.default.equal(history.length, 5);
        strict_1.default.equal(history[4].type, 'reply');
        strict_1.default.equal(history[4].text, 'hi there');
        // 未知命令：只有消息，无应答
        await core.sendEvent('chat:receive', { user: 'alice', room: 'lobby', text: '!unknown' });
        strict_1.default.equal(core.pullArray('chat:history').length, 6);
        // 通配符统计：chat:receive x4 + chat:command x3 + chat:reply x2 = 9 个事件
        strict_1.default.equal(core.pullArray('chat:stats')[0].count, 9);
        // 事件流水记录了所有事件（含派生事件）
        const events = core.log.byType('event').map((e) => e.event);
        strict_1.default.ok(events.includes('chat:receive'));
        strict_1.default.ok(events.includes('chat:command'));
        strict_1.default.ok(events.includes('chat:reply'));
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(tmp);
    }
});
(0, node_test_1.test)('聊天机器人：日志文件记录事件流水（原样记录所有发生的事情）', async () => {
    const tmp = (0, helpers_1.mkTmpDir)('chatbot');
    try {
        const logFile = path.join(tmp, 'stream.log');
        const core = new ConnectCore_1.ConnectCore({ moduleDir: MODULE_DIR, logFile, watch: false });
        await core.start();
        await core.sendEvent('chat:receive', { user: 'carol', room: 'hall', text: '!help' });
        await core.stop();
        const lines = core.log.readFileLines();
        strict_1.default.ok(lines.length > 0);
        const parsed = lines.map((l) => JSON.parse(l));
        // 第一行是核心启动；随后 core:startup 事件被原样记录
        strict_1.default.equal(parsed[0].type, 'core:start');
        const startup = parsed.find((e) => e.type === 'event' && e.event === 'core:startup');
        strict_1.default.ok(startup);
        strict_1.default.equal(startup.source, 'core');
        // 模块启动事件被记录
        strict_1.default.ok(parsed.some((e) => e.type === 'module:start' && e.module === 'gateway'));
        // 用户消息被原样记录
        const recv = parsed.find((e) => e.type === 'event' && e.event === 'chat:receive');
        strict_1.default.equal(recv.data.user, 'carol');
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(tmp);
    }
});
