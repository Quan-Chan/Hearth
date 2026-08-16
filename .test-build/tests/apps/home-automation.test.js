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
 * 测试应用：智能家居（类似 Home Assistant / 米家自动化）。
 * 场景：人体感应 -> 灯光联动；温度上报 -> 超阈值自动制冷；安全日志记录一切。
 */
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const path = __importStar(require("path"));
const ConnectCore_1 = require("../../src/core/ConnectCore");
const helpers_1 = require("../helpers");
const ROOT = path.resolve(__dirname, '..', '..', '..');
const MODULE_DIR = path.join(ROOT, 'tests', 'fixtures', 'home-automation', 'modules');
(0, node_test_1.test)('智能家居：人体感应联动灯光，多个模块同时监听同一事件', async () => {
    const tmp = (0, helpers_1.mkTmpDir)('home');
    try {
        const core = new ConnectCore_1.ConnectCore({ moduleDir: MODULE_DIR, logFile: path.join(tmp, 'log.log'), watch: false });
        await core.start();
        // 有人进入客厅 -> 灯亮 + 传感器更新
        await core.sendEvent('home:motion', { room: 'living', motion: true });
        strict_1.default.deepEqual(core.pullArray('home:lights'), [{ room: 'living', on: true }]);
        strict_1.default.deepEqual(core.pullArray('home:sensors'), [{ room: 'living', motion: true }]);
        // 无人 -> 灯灭
        await core.sendEvent('home:motion', { room: 'living', motion: false });
        strict_1.default.deepEqual(core.pullArray('home:lights'), [{ room: 'living', on: false }]);
        // 新房间自动加入
        await core.sendEvent('home:motion', { room: 'kitchen', motion: true });
        strict_1.default.deepEqual(core.pullArray('home:lights').map((l) => l.room).sort(), ['kitchen', 'living']);
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(tmp);
    }
});
(0, node_test_1.test)('智能家居：温度超阈值自动制冷，链式事件 + 模块日志', async () => {
    const tmp = (0, helpers_1.mkTmpDir)('home');
    try {
        const core = new ConnectCore_1.ConnectCore({ moduleDir: MODULE_DIR, logFile: path.join(tmp, 'log.log'), watch: false });
        await core.start();
        // 30 度 > 26 -> 制冷
        await core.sendEvent('home:temperature', { room: 'living', temp: 30 });
        strict_1.default.deepEqual(core.pullArray('home:devices'), [{ room: 'living', cooling: true }]);
        strict_1.default.ok(core.log.byType('module:log').some((l) => l.module === 'cooler' && String(l.message).includes('制冷')));
        // 22 度 -> 不制冷
        await core.sendEvent('home:temperature', { room: 'living', temp: 22 });
        strict_1.default.equal(core.pullArray('home:devices')[0].cooling, true); // 保持开启（不自动关）
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(tmp);
    }
});
(0, node_test_1.test)('智能家居：安全日志用通配符原样记录所有 home:* 事件', async () => {
    const tmp = (0, helpers_1.mkTmpDir)('home');
    try {
        const core = new ConnectCore_1.ConnectCore({ moduleDir: MODULE_DIR, logFile: path.join(tmp, 'log.log'), watch: false });
        await core.start();
        await core.sendEvent('home:motion', { room: 'living', motion: true });
        await core.sendEvent('home:temperature', { room: 'living', temp: 30 });
        const log = core.pullArray('home:log');
        strict_1.default.deepEqual(log.map((l) => l.event), ['home:motion', 'home:temperature', 'home:cooling']);
        strict_1.default.equal(log[2].data.room, 'living');
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(tmp);
    }
});
