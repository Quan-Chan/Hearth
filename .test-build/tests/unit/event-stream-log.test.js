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
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const EventStreamLog_1 = require("../../src/core/EventStreamLog");
const helpers_1 = require("../helpers");
(0, node_test_1.test)('record 按顺序记录并自动填充时间戳', () => {
    const log = new EventStreamLog_1.EventStreamLog();
    log.record({ type: 'event', event: 'a' });
    log.record({ type: 'event', event: 'b' });
    log.record({ type: 'module:start', module: 'm' });
    const all = log.all();
    strict_1.default.equal(all.length, 3);
    strict_1.default.equal(all[0].event, 'a');
    strict_1.default.equal(all[1].event, 'b');
    strict_1.default.ok(all.every((e) => typeof e.t === 'string' && e.t.length > 0));
    strict_1.default.equal(log.byType('event').length, 2);
    strict_1.default.equal(log.byType('module:start').length, 1);
});
(0, node_test_1.test)('落盘：JSONL 文件与内存一致，目录自动创建', async () => {
    const dir = (0, helpers_1.mkTmpDir)('log');
    try {
        const file = path.join(dir, 'logs', 'event-stream.log');
        const log = new EventStreamLog_1.EventStreamLog({ filePath: file });
        log.record({ type: 'event', event: 'core:startup', source: 'core' });
        log.record({ type: 'module:start', module: 'greeter' });
        await log.close();
        const lines = log.readFileLines();
        strict_1.default.equal(lines.length, 2);
        const parsed = lines.map((l) => JSON.parse(l));
        strict_1.default.equal(parsed[0].event, 'core:startup');
        strict_1.default.equal(parsed[1].module, 'greeter');
        // 文件真实存在于磁盘
        strict_1.default.ok(fs.existsSync(file));
        // close 后再次 close 不报错
        await log.close();
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
(0, node_test_1.test)('无文件路径时只记录内存', async () => {
    const log = new EventStreamLog_1.EventStreamLog();
    log.record({ type: 'core:start' });
    strict_1.default.equal(log.all().length, 1);
    await log.close();
});
