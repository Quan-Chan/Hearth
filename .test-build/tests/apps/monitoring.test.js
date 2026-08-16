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
 * 测试应用：监控告警（类似 Prometheus 告警 / APM 系统）。
 * 场景：指标上报 -> 聚合最新值；超过 YAML 配置阈值 -> 告警 -> 历史归档。
 */
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const path = __importStar(require("path"));
const ConnectCore_1 = require("../../src/core/ConnectCore");
const helpers_1 = require("../helpers");
const ROOT = path.resolve(__dirname, '..', '..', '..');
const MODULE_DIR = path.join(ROOT, 'tests', 'fixtures', 'monitoring', 'modules');
(0, node_test_1.test)('监控告警：指标聚合去重 + 阈值告警 + 历史归档', async () => {
    const tmp = (0, helpers_1.mkTmpDir)('mon');
    try {
        const core = new ConnectCore_1.ConnectCore({ moduleDir: MODULE_DIR, logFile: path.join(tmp, 'log.log'), watch: false });
        await core.start();
        // YAML 配置的阈值被模块读取（阈值 100）
        const alerting = core.getModule('alerting');
        strict_1.default.equal(alerting.config.config.threshold, 100);
        // 低值：只聚合，不告警
        await core.sendEvent('app:metric', { name: 'cpu', value: 30 });
        await core.sendEvent('app:metric', { name: 'mem', value: 80 });
        strict_1.default.equal(core.pullArray('metrics:latest').length, 2);
        strict_1.default.equal(core.pullArray('alerts:active').length, 0);
        strict_1.default.equal(core.pullArray('alerts:history').length, 0);
        // 高值：告警
        await core.sendEvent('app:metric', { name: 'cpu', value: 150 });
        strict_1.default.equal(core.pullArray('alerts:active').length, 1);
        strict_1.default.equal(core.pullArray('alerts:active')[0].value, 150);
        strict_1.default.equal(core.pullArray('alerts:history').length, 1);
        // 再次上报同名指标 -> 覆盖旧值（去重）
        await core.sendEvent('app:metric', { name: 'cpu', value: 42 });
        const latest = core.pullArray('metrics:latest');
        strict_1.default.equal(latest.length, 2);
        const cpu = latest.find((m) => m.name === 'cpu');
        strict_1.default.equal(cpu.value, 42);
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(tmp);
    }
});
