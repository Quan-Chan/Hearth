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
exports.ConfigWatcher = void 0;
exports.parseModuleConfig = parseModuleConfig;
/**
 * 模块文件夹监听器：框架核心始终监听模块文件夹。
 *  - 新的 YAML 配置文件出现   -> onLoad
 *  - 已有 YAML 文件内容变化   -> onUpdate
 *  - YAML 文件被删除          -> onRemove
 * 通过内容哈希比对实现，轮询（默认 200ms）跨平台可靠。
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const yaml_1 = require("yaml");
class ConfigWatcher {
    dir;
    callbacks;
    pollIntervalMs;
    enabled;
    timer;
    /** 已知配置：模块名 -> 文件信息 */
    known = new Map();
    scanning = false;
    constructor(opts) {
        this.dir = path.resolve(opts.dir);
        this.callbacks = opts.callbacks;
        this.pollIntervalMs = opts.pollIntervalMs ?? 200;
        this.enabled = opts.watch !== false;
    }
    /** 初始扫描 + 启动轮询监听。 */
    async start() {
        fs.mkdirSync(this.dir, { recursive: true });
        await this.rescan();
        if (this.enabled) {
            this.timer = setInterval(() => {
                void this.rescan();
            }, this.pollIntervalMs);
            this.timer.unref();
        }
    }
    async stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }
    /** 全量扫描目录，与已知状态比对并触发回调。 */
    async rescan() {
        if (this.scanning)
            return;
        this.scanning = true;
        try {
            const files = fs
                .readdirSync(this.dir)
                .filter((f) => /\.ya?ml$/i.test(f))
                .sort();
            const seen = new Set();
            for (const f of files) {
                const yamlPath = path.join(this.dir, f);
                let text;
                try {
                    text = fs.readFileSync(yamlPath, 'utf8');
                }
                catch {
                    continue;
                }
                const hash = (0, crypto_1.createHash)('sha1').update(text).digest('hex');
                let cfg;
                try {
                    cfg = parseModuleConfig(text, this.dir);
                }
                catch (err) {
                    this.callbacks.onError?.(path.basename(f, path.extname(f)), err instanceof Error ? err.message : String(err));
                    continue;
                }
                const prev = this.known.get(cfg.name);
                if (!prev) {
                    this.known.set(cfg.name, { yamlPath, hash });
                    await this.callbacks.onLoad(cfg, yamlPath);
                }
                else if (prev.hash !== hash) {
                    this.known.set(cfg.name, { yamlPath, hash });
                    await this.callbacks.onUpdate(cfg, yamlPath);
                }
                seen.add(cfg.name);
            }
            for (const [name, info] of [...this.known]) {
                if (!seen.has(name)) {
                    this.known.delete(name);
                    await this.callbacks.onRemove(name);
                }
            }
        }
        finally {
            this.scanning = false;
        }
    }
    listNames() {
        return [...this.known.keys()];
    }
}
exports.ConfigWatcher = ConfigWatcher;
/** 解析模块 YAML 文本为 ModuleConfig。file 相对路径基于 baseDir 解析。 */
function parseModuleConfig(text, baseDir) {
    let raw;
    try {
        raw = (0, yaml_1.parse)(text);
    }
    catch (err) {
        throw new Error(`YAML 解析失败: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('YAML 顶层必须是映射对象');
    }
    const obj = raw;
    const name = obj.name;
    if (typeof name !== 'string' || name.length === 0)
        throw new Error('缺少 name（模块名）');
    const file = obj.file;
    if (typeof file !== 'string' || file.length === 0) {
        throw new Error(`模块 ${name} 缺少 file（模块程序路径）`);
    }
    return {
        name,
        file: path.resolve(baseDir, file),
        startEvents: normalizeStringArray(obj.startEvents),
        listen: normalizeStringArray(obj.listen),
        enabled: obj.enabled !== false,
        config: typeof obj.config === 'object' && obj.config !== null && !Array.isArray(obj.config)
            ? obj.config
            : {},
    };
}
function normalizeStringArray(v) {
    if (v === undefined || v === null)
        return undefined;
    if (typeof v === 'string')
        return [v];
    if (Array.isArray(v) && v.every((x) => typeof x === 'string'))
        return v;
    return undefined;
}
