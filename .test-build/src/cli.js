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
/**
 * Connect-Core 命令行入口：启动它等于启动整个软件。
 * 用法：node dist/cli.js [connect-core.yaml]
 * 配置文件示例：
 *   core:
 *     moduleDir: ./modules
 *     logFile: ./logs/event-stream.log
 *     watch: true
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml_1 = require("yaml");
const index_1 = require("./index");
async function main() {
    const configPath = path.resolve(process.argv[2] ?? 'connect-core.yaml');
    const options = {};
    if (fs.existsSync(configPath)) {
        const raw = (0, yaml_1.parse)(fs.readFileSync(configPath, 'utf8'));
        const coreCfg = (raw?.core ?? raw ?? {});
        const baseDir = path.dirname(configPath);
        if (coreCfg.moduleDir)
            options.moduleDir = path.resolve(baseDir, String(coreCfg.moduleDir));
        if (coreCfg.logFile)
            options.logFile = path.resolve(baseDir, String(coreCfg.logFile));
        if (coreCfg.watch !== undefined)
            options.watch = Boolean(coreCfg.watch);
        if (coreCfg.logToConsole)
            options.logToConsole = true;
        // eslint-disable-next-line no-console
        console.log(`[connect-core] 读取配置文件: ${configPath}`);
    }
    else {
        // eslint-disable-next-line no-console
        console.log(`[connect-core] 未找到 ${configPath}，使用默认配置`);
    }
    const core = await (0, index_1.startCore)(options);
    // eslint-disable-next-line no-console
    console.log('[connect-core] 核心已启动 —— 启动它等于启动整个软件');
    // eslint-disable-next-line no-console
    console.log(`[connect-core] 模块目录: ${core.options.moduleDir}`);
    // eslint-disable-next-line no-console
    console.log(`[connect-core] 事件流水: ${core.options.logFile}`);
    // eslint-disable-next-line no-console
    console.log('[connect-core] 已加载模块: ' +
        (core.listModules().map((m) => m.name).join(', ') || '(无)'));
    // 保持进程存活：核心启动后持续监听模块文件夹并响应事件
    setInterval(() => { }, 60_000);
    const shutdown = async () => {
        // eslint-disable-next-line no-console
        console.log('[connect-core] 正在关闭...');
        await core.stop();
        process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
}
main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[connect-core] 启动失败:', err.message);
    process.exit(1);
});
