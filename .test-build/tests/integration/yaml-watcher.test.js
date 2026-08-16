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
const ConnectCore_1 = require("../../src/core/ConnectCore");
const helpers_1 = require("../helpers");
const GREETER = `module.exports = {
  name: 'greeter',
  start(ctx) { ctx.exposeArray('greet:out', []); },
  onEvent(ctx, event) { ctx.editArray('greet:out', { type: 'push', value: event.name }); },
};
`;
const LATE = `module.exports = {
  name: 'late',
  onEvent(ctx, event) { ctx.editArray('late:marks', { type: 'push', value: event.name }); },
  start(ctx) { ctx.exposeArray('late:marks', ['late-started']); },
};
`;
(0, node_test_1.test)('监听模块文件夹：新增 YAML 自动加载，匹配已发生事件则立即启动', async () => {
    const dir = (0, helpers_1.mkTmpDir)('watch');
    try {
        const core = new ConnectCore_1.ConnectCore({ moduleDir: dir, watch: true, pollIntervalMs: 50 });
        await core.start();
        strict_1.default.equal(core.listModules().length, 0);
        // 放入新的 YAML 配置 + 程序（先写程序文件，避免加载竞态）
        fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
        fs.writeFileSync(path.join(dir, 'greeter.yaml'), (0, helpers_1.yamlFor)('greeter', { startEvents: ['core:startup'], listen: ['greet'] }));
        // core:startup 已经发生过 -> 模块自动启动
        await (0, helpers_1.waitFor)(() => core.getModule('greeter')?.status === 'running');
        strict_1.default.ok(core.log.byType('config:load').some((l) => l.module === 'greeter'));
        // 事件可以正常送达
        await core.sendEvent('greet', { name: 'world' });
        strict_1.default.deepEqual(core.pullArray('greet:out'), ['greet']);
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
(0, node_test_1.test)('新增模块：启动事件未发生过则不启动，事件到来时启动', async () => {
    const dir = (0, helpers_1.mkTmpDir)('watch');
    try {
        const core = new ConnectCore_1.ConnectCore({ moduleDir: dir, watch: true, pollIntervalMs: 50 });
        await core.start();
        fs.writeFileSync(path.join(dir, 'late.cjs'), LATE);
        fs.writeFileSync(path.join(dir, 'late.yaml'), (0, helpers_1.yamlFor)('late', { startEvents: ['later:event'], listen: ['later:event'] }));
        await (0, helpers_1.waitFor)(() => core.getModule('late') !== undefined);
        // 事件未出现过 -> 未启动
        strict_1.default.equal(core.getModule('late').status, 'stopped');
        // 事件出现 -> 启动
        await core.sendEvent('later:event');
        await (0, helpers_1.waitFor)(() => core.getModule('late').status === 'running');
        strict_1.default.deepEqual(core.pullArray('late:marks'), ['late-started', 'later:event']);
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
(0, node_test_1.test)('YAML 变化：更新配置并重启模块，新监听生效', async () => {
    const dir = (0, helpers_1.mkTmpDir)('watch');
    try {
        const core = new ConnectCore_1.ConnectCore({ moduleDir: dir, watch: true, pollIntervalMs: 50 });
        await core.start();
        const yamlPath = path.join(dir, 'greeter.yaml');
        fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
        fs.writeFileSync(yamlPath, (0, helpers_1.yamlFor)('greeter', { startEvents: ['core:startup'], listen: ['greet'] }));
        await (0, helpers_1.waitFor)(() => core.getModule('greeter')?.status === 'running');
        // 修改 YAML：listen 改为另一事件
        fs.writeFileSync(yamlPath, (0, helpers_1.yamlFor)('greeter', { startEvents: ['core:startup'], listen: ['greet:new'] }));
        await (0, helpers_1.waitFor)(() => core.log.byType('config:update').some((l) => l.module === 'greeter'));
        // 重启：先停后启
        await (0, helpers_1.waitFor)(() => {
            const stops = core.log.byType('module:stop').filter((s) => s.module === 'greeter').length;
            const starts = core.log.byType('module:start').filter((s) => s.module === 'greeter').length;
            return stops >= 1 && starts >= 2;
        });
        // 新监听生效，旧监听失效
        await core.sendEvent('greet');
        strict_1.default.deepEqual(core.pullArray('greet:out'), []);
        await core.sendEvent('greet:new');
        strict_1.default.deepEqual(core.pullArray('greet:out'), ['greet:new']);
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
(0, node_test_1.test)('删除 YAML：模块被停止并移除', async () => {
    const dir = (0, helpers_1.mkTmpDir)('watch');
    try {
        const core = new ConnectCore_1.ConnectCore({ moduleDir: dir, watch: true, pollIntervalMs: 50 });
        await core.start();
        fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
        fs.writeFileSync(path.join(dir, 'greeter.yaml'), (0, helpers_1.yamlFor)('greeter', { startEvents: ['core:startup'] }));
        await (0, helpers_1.waitFor)(() => core.getModule('greeter')?.status === 'running');
        fs.rmSync(path.join(dir, 'greeter.yaml'));
        await (0, helpers_1.waitFor)(() => core.getModule('greeter') === undefined);
        strict_1.default.ok(core.log.byType('module:stop').some((s) => s.module === 'greeter'));
        strict_1.default.ok(core.log.byType('config:remove').some((l) => l.module === 'greeter'));
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
(0, node_test_1.test)('非法 YAML：记录 config:error，核心继续运行', async () => {
    const dir = (0, helpers_1.mkTmpDir)('watch');
    try {
        const core = new ConnectCore_1.ConnectCore({ moduleDir: dir, watch: true, pollIntervalMs: 50 });
        await core.start();
        fs.writeFileSync(path.join(dir, 'bad.yaml'), 'name: [unclosed\n');
        await (0, helpers_1.waitFor)(() => core.log.byType('config:error').length >= 1);
        strict_1.default.equal(core.listModules().length, 0);
        // 核心仍然可发事件
        await core.sendEvent('anything:go');
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
(0, node_test_1.test)('watch:false 时不自动监听，rescanModules 手动扫描生效', async () => {
    const dir = (0, helpers_1.mkTmpDir)('watch');
    try {
        const core = new ConnectCore_1.ConnectCore({ moduleDir: dir, watch: false });
        await core.start();
        fs.writeFileSync(path.join(dir, 'greeter.cjs'), GREETER);
        fs.writeFileSync(path.join(dir, 'greeter.yaml'), (0, helpers_1.yamlFor)('greeter', { startEvents: ['core:startup'] }));
        // 不自动加载
        await new Promise((r) => setTimeout(r, 150));
        strict_1.default.equal(core.listModules().length, 0);
        await core.rescanModules();
        strict_1.default.equal(core.listModules().length, 1);
        await (0, helpers_1.waitFor)(() => core.getModule('greeter')?.status === 'running');
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
