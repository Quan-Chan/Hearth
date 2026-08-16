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
exports.mkTmpDir = mkTmpDir;
exports.rmDir = rmDir;
exports.waitFor = waitFor;
exports.sleep = sleep;
exports.writeModuleFixture = writeModuleFixture;
exports.yamlFor = yamlFor;
/**
 * 测试辅助工具：临时目录、等待条件、模块夹具生成。
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** 在 tests/.tmp 下创建唯一临时目录（工作区内，避免沙箱限制）。 */
function mkTmpDir(prefix) {
    const dir = path.resolve(__dirname, '..', '.tmp', prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
/** 删除目录（含内容）。 */
function rmDir(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}
/** 轮询等待条件成立，超时抛错。 */
async function waitFor(fn, timeoutMs = 3000, intervalMs = 25) {
    const start = Date.now();
    for (;;) {
        if (await fn())
            return;
        if (Date.now() - start > timeoutMs) {
            throw new Error(`waitFor 超时（${timeoutMs}ms）`);
        }
        await sleep(intervalMs);
    }
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
/** 写入模块夹具：YAML 配置 + CJS 程序。返回 { yamlPath, programPath }。 */
function writeModuleFixture(dir, name, yaml, program) {
    const yamlPath = path.join(dir, name + '.yaml');
    const programPath = path.join(dir, name + '.cjs');
    fs.writeFileSync(yamlPath, yaml, 'utf8');
    fs.writeFileSync(programPath, program, 'utf8');
    return { yamlPath, programPath };
}
/** 常用 YAML 模板。 */
function yamlFor(name, opts = {}) {
    const lines = ['name: ' + name, 'file: ./' + name + '.cjs'];
    if (opts.startEvents)
        lines.push('startEvents: [' + opts.startEvents.map((e) => '"' + e + '"').join(', ') + ']');
    if (opts.listen)
        lines.push('listen: [' + opts.listen.map((e) => '"' + e + '"').join(', ') + ']');
    if (opts.extra)
        lines.push(opts.extra);
    return lines.join('\n') + '\n';
}
