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
const loadModule_1 = require("../../src/module/loadModule");
const helpers_1 = require("../helpers");
(0, node_test_1.test)('加载 CJS 对象模块', async () => {
    const dir = (0, helpers_1.mkTmpDir)('loader');
    try {
        const file = path.join(dir, 'm.cjs');
        fs.writeFileSync(file, `module.exports = {
  name: 'm',
  start(ctx) { ctx.log('started'); },
  onEvent(ctx, event) { ctx.log(event.name); },
};
`);
        const def = await (0, loadModule_1.loadModuleProgram)(file);
        strict_1.default.equal(typeof def.start, 'function');
        strict_1.default.equal(typeof def.onEvent, 'function');
        strict_1.default.equal(def.name, 'm');
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
(0, node_test_1.test)('加载 CJS 工厂函数模块', async () => {
    const dir = (0, helpers_1.mkTmpDir)('loader');
    try {
        const file = path.join(dir, 'f.cjs');
        fs.writeFileSync(file, 'module.exports = () => ({ start() {} });\n');
        const def = await (0, loadModule_1.loadModuleProgram)(file);
        strict_1.default.equal(typeof def.start, 'function');
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
(0, node_test_1.test)('加载 ESM (.mjs) 模块', async () => {
    const dir = (0, helpers_1.mkTmpDir)('loader');
    try {
        const file = path.join(dir, 'e.mjs');
        fs.writeFileSync(file, 'export default { stop() {} };\n');
        const def = await (0, loadModule_1.loadModuleProgram)(file);
        strict_1.default.equal(typeof def.stop, 'function');
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
(0, node_test_1.test)('文件不存在 / 导出非法 抛错', async () => {
    const dir = (0, helpers_1.mkTmpDir)('loader');
    try {
        await strict_1.default.rejects(() => (0, loadModule_1.loadModuleProgram)(path.join(dir, 'ghost.cjs')), /不存在/);
        const file = path.join(dir, 'bad.cjs');
        fs.writeFileSync(file, 'module.exports = "just a string";\n');
        await strict_1.default.rejects(() => (0, loadModule_1.loadModuleProgram)(file), /必须是对象或工厂函数/);
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
(0, node_test_1.test)('热更新：清缓存后重新加载得到新代码', async () => {
    const dir = (0, helpers_1.mkTmpDir)('loader');
    try {
        const file = path.join(dir, 'hot.cjs');
        fs.writeFileSync(file, 'module.exports = { tag: "v1" };\n');
        const first = await (0, loadModule_1.loadModuleProgram)(file);
        fs.writeFileSync(file, 'module.exports = { tag: "v2" };\n');
        const second = await (0, loadModule_1.loadModuleProgram)(file);
        strict_1.default.equal(first.tag, 'v1');
        strict_1.default.equal(second.tag, 'v2');
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
