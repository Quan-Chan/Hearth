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
const path = __importStar(require("path"));
const ConfigWatcher_1 = require("../../src/core/ConfigWatcher");
const BASE = path.resolve('/base/modules');
(0, node_test_1.test)('最小配置：默认值正确', () => {
    const cfg = (0, ConfigWatcher_1.parseModuleConfig)('name: hello\nfile: ./hello.cjs\n', BASE);
    strict_1.default.equal(cfg.name, 'hello');
    strict_1.default.equal(cfg.file, path.join(BASE, 'hello.cjs'));
    strict_1.default.equal(cfg.startEvents, undefined);
    strict_1.default.equal(cfg.listen, undefined);
    strict_1.default.equal(cfg.enabled, true);
    strict_1.default.deepEqual(cfg.config, {});
});
(0, node_test_1.test)('完整配置：所有字段解析正确', () => {
    const yaml = [
        'name: greeter',
        'file: ./greeter.cjs',
        'startEvents:',
        '  - "core:startup"',
        'listen:',
        '  - "greet"',
        '  - "chat:*"',
        'enabled: false',
        'config:',
        '  threshold: 100',
        '  label: "生产环境"',
    ].join('\n');
    const cfg = (0, ConfigWatcher_1.parseModuleConfig)(yaml, BASE);
    strict_1.default.deepEqual(cfg.startEvents, ['core:startup']);
    strict_1.default.deepEqual(cfg.listen, ['greet', 'chat:*']);
    strict_1.default.equal(cfg.enabled, false);
    strict_1.default.equal(cfg.config.threshold, 100);
    strict_1.default.equal(cfg.config.label, '生产环境');
});
(0, node_test_1.test)('startEvents 可以是单个字符串', () => {
    const cfg = (0, ConfigWatcher_1.parseModuleConfig)('name: a\nfile: ./a.cjs\nstartEvents: "core:startup"\n', BASE);
    strict_1.default.deepEqual(cfg.startEvents, ['core:startup']);
});
(0, node_test_1.test)('非法输入：坏 YAML / 缺 name / 缺 file / 顶层非对象', () => {
    strict_1.default.throws(() => (0, ConfigWatcher_1.parseModuleConfig)('name: [unclosed', BASE), /YAML 解析失败/);
    strict_1.default.throws(() => (0, ConfigWatcher_1.parseModuleConfig)('file: ./a.cjs\n', BASE), /缺少 name/);
    strict_1.default.throws(() => (0, ConfigWatcher_1.parseModuleConfig)('name: a\n', BASE), /缺少 file/);
    strict_1.default.throws(() => (0, ConfigWatcher_1.parseModuleConfig)('- a\n- b\n', BASE), /顶层必须是映射对象/);
});
