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
/** 生成一组生命周期测试模块夹具。 */
function makeFixtures(dir) {
    // boot：core:startup 启动，暴露数组并记录收到的事件
    fs.writeFileSync(path.join(dir, 'boot.cjs'), `module.exports = {
  name: 'boot',
  start(ctx) {
    ctx.exposeArray('boot:marks', ['started']);
  },
  onEvent(ctx, event) {
    ctx.editArray('boot:marks', { type: 'push', value: event.name });
  },
};
`);
    // lazy：只有 lazy:go 事件才启动
    fs.writeFileSync(path.join(dir, 'lazy.cjs'), `module.exports = {
  name: 'lazy',
  onEvent(ctx, event) {
    ctx.editArray('lazy:marks', { type: 'push', value: event.name });
  },
  start(ctx) {
    ctx.exposeArray('lazy:marks', ['lazy-started']);
  },
};
`);
    // wild：通配符监听
    fs.writeFileSync(path.join(dir, 'wild.cjs'), `module.exports = {
  name: 'wild',
  start(ctx) { ctx.exposeArray('wild:marks', []); },
  onEvent(ctx, event) { ctx.editArray('wild:marks', { type: 'push', value: event.name }); },
};
`);
    // boom：启动时抛错
    fs.writeFileSync(path.join(dir, 'boom.cjs'), `module.exports = {
  name: 'boom',
  start() { throw new Error('boom 模块启动失败'); },
};
`);
    // badhandler：事件处理抛错
    fs.writeFileSync(path.join(dir, 'badhandler.cjs'), `module.exports = {
  name: 'badhandler',
  start(ctx) { ctx.exposeArray('bh:marks', []); },
  onEvent() { throw new Error('badhandler 处理出错'); },
};
`);
    fs.writeFileSync(path.join(dir, 'boot.yaml'), (0, helpers_1.yamlFor)('boot', { startEvents: ['core:startup'], listen: ['chat:message', 'chat:reply'] }));
    fs.writeFileSync(path.join(dir, 'lazy.yaml'), (0, helpers_1.yamlFor)('lazy', { startEvents: ['lazy:go'], listen: ['lazy:go'] }));
    fs.writeFileSync(path.join(dir, 'wild.yaml'), (0, helpers_1.yamlFor)('wild', { startEvents: ['core:startup'], listen: ['wild:*'] }));
    fs.writeFileSync(path.join(dir, 'boom.yaml'), (0, helpers_1.yamlFor)('boom', { startEvents: ['core:startup'] }));
    fs.writeFileSync(path.join(dir, 'badhandler.yaml'), (0, helpers_1.yamlFor)('badhandler', { startEvents: ['core:startup'], listen: ['chat:message'] }));
}
function makeCore(dir) {
    return new ConnectCore_1.ConnectCore({ moduleDir: dir, watch: false });
}
(0, node_test_1.test)('启动核心 == 启动整个软件：core:startup 自动启动匹配模块', async () => {
    const dir = (0, helpers_1.mkTmpDir)('life');
    try {
        makeFixtures(dir);
        const core = makeCore(dir);
        await core.start();
        // 模块自动启动（无需手动 startModule）
        strict_1.default.equal(core.getModule('boot').status, 'running');
        strict_1.default.equal(core.getModule('wild').status, 'running');
        strict_1.default.equal(core.getModule('boom').status, 'failed');
        strict_1.default.equal(core.getModule('lazy').status, 'stopped'); // 启动事件未出现
        // 启动时暴露的数组可用
        strict_1.default.deepEqual(core.pullArray('boot:marks'), ['started']);
        // 事件流水：核心启动事件原样记录，且记录了哪些模块因此启动
        const events = core.log.byType('event');
        strict_1.default.equal(events[0].event, 'core:startup');
        strict_1.default.equal(events[0].source, 'core');
        const starts = core.log.byType('module:start');
        strict_1.default.ok(starts.every((s) => s.reason === 'core:startup'));
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
(0, node_test_1.test)('事件路由：精确匹配 + 通配符匹配，非监听者不收', async () => {
    const dir = (0, helpers_1.mkTmpDir)('life');
    try {
        makeFixtures(dir);
        const core = makeCore(dir);
        await core.start();
        await core.sendEvent('chat:message', { text: 'hi' }, 'tester');
        strict_1.default.deepEqual(core.pullArray('boot:marks'), ['started', 'chat:message']);
        // badhandler 也监听 chat:message：它抛错，但日志记录且不影响其他模块
        strict_1.default.equal(core.log.byType('module:event-failed').length, 1);
        // wild 通配符收不到 chat:message
        strict_1.default.deepEqual(core.pullArray('wild:marks'), []);
        await core.sendEvent('wild:ping');
        strict_1.default.deepEqual(core.pullArray('wild:marks'), ['wild:ping']);
        // lazy 未启动，收不到事件
        await core.sendEvent('lazy:go', { v: 1 }, 'tester');
        strict_1.default.equal(core.getModule('lazy').status, 'running'); // 事件触发启动
        strict_1.default.deepEqual(core.pullArray('lazy:marks'), ['lazy-started', 'lazy:go']); // 启动后也收到了事件
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
(0, node_test_1.test)('框架核心方法：startModule / stopModule / sendEvent', async () => {
    const dir = (0, helpers_1.mkTmpDir)('life');
    try {
        makeFixtures(dir);
        const core = makeCore(dir);
        await core.start();
        // 手动停止与启动
        await core.stopModule('boot');
        strict_1.default.equal(core.getModule('boot').status, 'stopped');
        strict_1.default.ok(core.log.byType('module:stop').some((s) => s.module === 'boot'));
        await core.startModule('boot', 'manual');
        strict_1.default.equal(core.getModule('boot').status, 'running');
        // 未知模块抛错
        await strict_1.default.rejects(() => core.startModule('ghost'), /未知模块/);
        await strict_1.default.rejects(() => core.stopModule('ghost'), /未知模块/);
        // 重复启动/停止不报错，仅记录跳过
        await core.startModule('boot');
        strict_1.default.equal(core.log.byType('module:start-skipped').length, 1);
        await core.stopModule('lazy'); // 未运行
        strict_1.default.equal(core.log.byType('module:stop-skipped').length, 1);
        // sendEvent 事件名校验
        await strict_1.default.rejects(() => core.sendEvent(''), /非空字符串/);
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
(0, node_test_1.test)('模块失败隔离：启动失败/事件处理失败不影响核心与其他模块', async () => {
    const dir = (0, helpers_1.mkTmpDir)('life');
    try {
        makeFixtures(dir);
        const core = makeCore(dir);
        await core.start();
        strict_1.default.equal(core.getModule('boom').status, 'failed');
        strict_1.default.ok(core.getModule('boom').error.includes('启动失败'));
        strict_1.default.equal(core.log.byType('module:start-failed').length, 1);
        // 核心仍然工作
        await core.sendEvent('wild:ok');
        strict_1.default.deepEqual(core.pullArray('wild:marks'), ['wild:ok']);
        // badhandler 抛错被记录，boot 仍收到事件
        await core.sendEvent('chat:message', { text: 'x' });
        strict_1.default.equal(core.log.byType('module:event-failed').length, 1);
        strict_1.default.deepEqual(core.pullArray('boot:marks'), ['started', 'chat:message']);
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
(0, node_test_1.test)('关闭：core:shutdown 先广播，模块逆序停止，之后不能再发事件', async () => {
    const dir = (0, helpers_1.mkTmpDir)('life');
    try {
        makeFixtures(dir);
        const core = makeCore(dir);
        await core.start();
        // 启动顺序：badhandler, boot, boom, lazy, wild（文件名字母序）
        const startOrder = core.log.byType('module:start').map((s) => s.module);
        await core.stop();
        // core:shutdown 事件在 module:stop 之前
        const shutdownIdx = core.log.byType('event').findIndex((e) => e.event === 'core:shutdown');
        const stopEntries = core.log.byType('module:stop');
        strict_1.default.ok(shutdownIdx >= 0);
        strict_1.default.ok(stopEntries.length >= 2);
        const stopOrder = stopEntries.map((s) => s.module);
        // 逆序停止
        strict_1.default.deepEqual(stopOrder, [...startOrder].reverse());
        strict_1.default.equal(core.log.byType('core:stop').length, 1);
        strict_1.default.equal(core.started, false);
        // 停止后不能发送事件
        await strict_1.default.rejects(() => core.sendEvent('x'), /未启动/);
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
(0, node_test_1.test)('重复启动抛错', async () => {
    const dir = (0, helpers_1.mkTmpDir)('life');
    try {
        makeFixtures(dir);
        const core = makeCore(dir);
        await core.start();
        await strict_1.default.rejects(() => core.start(), /已经启动/);
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
