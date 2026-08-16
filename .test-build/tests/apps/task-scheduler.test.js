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
 * 测试应用：任务调度器（类似 cron / 任务队列 / CI 调度中心）。
 * 场景：提交任务 -> 定时到期 -> 执行 -> 通知；支持取消任务。
 */
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const path = __importStar(require("path"));
const ConnectCore_1 = require("../../src/core/ConnectCore");
const helpers_1 = require("../helpers");
const ROOT = path.resolve(__dirname, '..', '..', '..');
const MODULE_DIR = path.join(ROOT, 'tests', 'fixtures', 'task-scheduler', 'modules');
(0, node_test_1.test)('任务调度器：提交 -> 到期 -> 执行 -> 通知 全链路', async () => {
    const tmp = (0, helpers_1.mkTmpDir)('sched');
    try {
        const core = new ConnectCore_1.ConnectCore({ moduleDir: MODULE_DIR, logFile: path.join(tmp, 'log.log'), watch: false });
        await core.start();
        // 提交 3 个任务，不同延迟
        await core.sendEvent('task:submit', { id: 't1', name: '构建前端', delayMs: 30 });
        await core.sendEvent('task:submit', { id: 't2', name: '跑测试', delayMs: 15 });
        await core.sendEvent('task:submit', { id: 't3', name: '发版', delayMs: 45 });
        // 队列中可见
        strict_1.default.equal(core.pullArray('tasks:queue').length, 3);
        // 等待全部到期
        await (0, helpers_1.waitFor)(() => core.pullArray('tasks:done').length === 3, 3000);
        // 执行结果按到期顺序（t2 最先）
        const done = core.pullArray('tasks:done');
        strict_1.default.deepEqual(done.map((d) => d.id), ['t2', 't1', 't3']);
        strict_1.default.ok(done.every((d) => d.status === 'done'));
        // 队列被清空（无删除操作，任务完成后留在队列为 queued？—— 设计：完成后仍在队列中标记？）
        // 通知已产生
        const notices = core.pullArray('tasks:notifications');
        strict_1.default.equal(notices.length, 3);
        strict_1.default.ok(String(notices[0].text).includes('跑测试'));
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(tmp);
    }
});
(0, node_test_1.test)('任务调度器：取消任务后不再执行', async () => {
    const tmp = (0, helpers_1.mkTmpDir)('sched');
    try {
        const core = new ConnectCore_1.ConnectCore({ moduleDir: MODULE_DIR, logFile: path.join(tmp, 'log.log'), watch: false });
        await core.start();
        await core.sendEvent('task:submit', { id: 'keep', name: '保留', delayMs: 200 });
        await core.sendEvent('task:submit', { id: 'drop', name: '取消我', delayMs: 60 });
        // 取消 drop
        await core.sendEvent('task:cancel', { id: 'drop' });
        const queue = core.pullArray('tasks:queue');
        strict_1.default.deepEqual(queue.map((q) => q.id), ['keep']);
        // keep 正常完成，drop 永不执行
        await (0, helpers_1.waitFor)(() => core.pullArray('tasks:done').length === 1, 3000);
        strict_1.default.equal(core.pullArray('tasks:done')[0].id, 'keep');
        strict_1.default.equal(core.pullArray('tasks:notifications').length, 1);
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(tmp);
    }
});
