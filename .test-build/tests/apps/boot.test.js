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
 * 启动即整机：从公共入口 startCore 启动核心 == 启动整个软件，
 * 无需单独启动任何模块（examples/basic 演示目录）。
 */
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const path = __importStar(require("path"));
const index_1 = require("../../src/index");
const helpers_1 = require("../helpers");
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DEMO_DIR = path.join(ROOT, 'examples', 'basic', 'modules');
(0, node_test_1.test)('startCore：一次启动整机软件，模块按事件自动启动', async () => {
    const tmp = (0, helpers_1.mkTmpDir)('boot');
    try {
        const core = await (0, index_1.startCore)({ moduleDir: DEMO_DIR, logFile: path.join(tmp, 'boot.log'), watch: false });
        strict_1.default.equal(core.started, true);
        // 无需手动启动任何模块
        strict_1.default.deepEqual(core.listModules().map((m) => m.name).sort(), ['echo', 'greeter']);
        strict_1.default.equal(core.getModule('greeter').status, 'running');
        // 链式协作：echo 事件 -> greet 事件 -> greetings 数组
        await core.sendEvent('echo', { text: '世界' });
        strict_1.default.deepEqual(core.pullArray('greetings'), ['你好, 世界!']);
        await core.stop();
        strict_1.default.equal(core.started, false);
    }
    finally {
        (0, helpers_1.rmDir)(tmp);
    }
});
(0, node_test_1.test)('createCore + start 与 startCore 等价', async () => {
    const tmp = (0, helpers_1.mkTmpDir)('boot');
    try {
        const core = (0, index_1.createCore)({ moduleDir: DEMO_DIR, logFile: path.join(tmp, 'boot.log'), watch: false });
        strict_1.default.equal(core.started, false);
        await core.start();
        strict_1.default.equal(core.started, true);
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(tmp);
    }
});
