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
exports.loadModuleProgram = loadModuleProgram;
/**
 * 模块程序加载器：把 YAML 里 file 指向的"程序"加载为 ModuleDefinition。
 * 支持：
 *  - .cjs / .js  -> CommonJS require（清除缓存以支持热更新）
 *  - .mjs / .ts  -> 动态 import（ESM）
 *  - 导出对象（{ start, stop, onEvent }）或工厂函数（() => ({...})）
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const url_1 = require("url");
async function loadModuleProgram(filePath) {
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs))
        throw new Error(`模块程序文件不存在: ${abs}`);
    const ext = path.extname(abs).toLowerCase();
    let loaded;
    if (ext === '.mjs' || ext === '.ts') {
        // 注意：tsc 在 CJS 输出下会把 import() 编译成 require()，导致 ESM 加载失败。
        // 用 Function 包装得到真正的动态 import。
        const dynamicImport = new Function('s', 'return import(s)');
        loaded = await dynamicImport((0, url_1.pathToFileURL)(abs).href);
    }
    else {
        // CommonJS：清缓存后 require，保证 YAML 更新后重新加载最新代码
        delete require.cache[abs];
        loaded = require(abs);
    }
    let def = loaded;
    if (loaded && typeof loaded === 'object' && 'default' in loaded) {
        def = loaded.default;
    }
    if (typeof def === 'function') {
        def = await def();
    }
    if (typeof def !== 'object' || def === null) {
        throw new Error(`模块程序导出必须是对象或工厂函数: ${abs}`);
    }
    return def;
}
