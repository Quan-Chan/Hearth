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
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventStreamLog = void 0;
/**
 * 事件流水日志：原样记录所有发生的事情。
 * 每条记录一行 JSON（JSONL 格式），可落盘、可内存读取，写入顺序有保证。
 * 示例：核心刚打开时记录 "core:startup" 事件，以及哪些模块因此启动。
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class EventStreamLog {
    entries = [];
    filePath;
    stream;
    consoleOut;
    constructor(opts = {}) {
        this.filePath = opts.filePath;
        this.consoleOut = opts.logToConsole ?? false;
    }
    /** 追加一条记录（同步写内存，异步落盘，顺序保证）。 */
    record(entry) {
        const full = { t: new Date().toISOString(), ...entry };
        this.entries.push(full);
        this.ensureStream();
        if (this.consoleOut) {
            // eslint-disable-next-line no-console
            console.log(JSON.stringify(full));
        }
        if (this.stream) {
            this.stream.write(JSON.stringify(full) + '\n');
        }
    }
    /** 惰性打开文件流（目录自动创建）。 */
    ensureStream() {
        if (this.stream || !this.filePath)
            return;
        fs.mkdirSync(path.dirname(path.resolve(this.filePath)), { recursive: true });
        this.stream = fs.createWriteStream(this.filePath, { flags: 'a', encoding: 'utf8' });
        this.stream.on('error', () => {
            /* 日志写入失败不影响核心运行 */
        });
    }
    /** 所有内存中的条目（含未落盘部分）。 */
    all() {
        return this.entries;
    }
    /** 按类型过滤。 */
    byType(type) {
        return this.entries.filter((e) => e.type === type);
    }
    /** 读取已落盘文件的所有行（测试用）。 */
    readFileLines() {
        if (!this.filePath || !fs.existsSync(this.filePath))
            return [];
        return fs
            .readFileSync(this.filePath, 'utf8')
            .split(/\r?\n/)
            .filter((l) => l.length > 0);
    }
    async close() {
        if (!this.stream)
            return;
        await new Promise((resolve) => {
            this.stream.end(() => resolve());
        });
        this.stream = undefined;
    }
}
exports.EventStreamLog = EventStreamLog;
