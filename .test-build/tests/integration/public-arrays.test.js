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
function makeDir(dir) {
    fs.writeFileSync(path.join(dir, 'producer.cjs'), `module.exports = {
  name: 'producer',
  start(ctx) {
    ctx.exposeArray('shared:items', [{ id: 1 }, { id: 2 }]);
    ctx.exposeArray('producer:own', ['p']);
  },
};
`);
    fs.writeFileSync(path.join(dir, 'consumer.cjs'), `module.exports = {
  name: 'consumer',
  start(ctx) {
    ctx.exposeArray('consumer:own', []);
  },
  onEvent(ctx, event) {
    if (event.name === 'consume') {
      const items = ctx.pullArray('shared:items');
      ctx.editArray('shared:items', { type: 'push', value: { id: items.length + 1 } });
    }
  },
};
`);
    fs.writeFileSync(path.join(dir, 'producer.yaml'), (0, helpers_1.yamlFor)('producer', { startEvents: ['core:startup'] }));
    fs.writeFileSync(path.join(dir, 'consumer.yaml'), (0, helpers_1.yamlFor)('consumer', { startEvents: ['core:startup'], listen: ['consume'] }));
}
(0, node_test_1.test)('模块间公共数组：拉取快照、编辑内容、拥有者可见', async () => {
    const dir = (0, helpers_1.mkTmpDir)('arr');
    try {
        makeDir(dir);
        const core = new ConnectCore_1.ConnectCore({ moduleDir: dir, watch: false });
        await core.start();
        strict_1.default.deepEqual(core.listArrays().sort(), ['consumer:own', 'producer:own', 'shared:items']);
        strict_1.default.equal(core.arrayOwner('shared:items'), 'producer');
        // 消费者拉取快照并编辑
        await core.sendEvent('consume');
        await core.sendEvent('consume');
        // 拥有者再次拉取可见变化
        strict_1.default.deepEqual(core.pullArray('shared:items'), [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
(0, node_test_1.test)('取消公开：仅拥有者可以，取消后他人不可拉取', async () => {
    const dir = (0, helpers_1.mkTmpDir)('arr');
    try {
        makeDir(dir);
        const core = new ConnectCore_1.ConnectCore({ moduleDir: dir, watch: false });
        await core.start();
        // 消费者不能取消别人的数组
        strict_1.default.throws(() => core.unexposeArray('shared:items', 'consumer'), /无权取消公开/);
        // 拥有者可以
        core.unexposeArray('shared:items', 'producer');
        strict_1.default.deepEqual(core.listArrays(), ['consumer:own', 'producer:own']);
        strict_1.default.throws(() => core.pullArray('shared:items'), /不存在/);
        // 不同拥有者重名公开抛错；同拥有者重新公开 = 重置
        strict_1.default.throws(() => core.exposeArray('producer:own', 'consumer', []), /已存在/);
        core.exposeArray('producer:own', 'producer', ['reset']);
        strict_1.default.deepEqual(core.pullArray('producer:own'), ['reset']);
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
(0, node_test_1.test)('核心直接操作公共数组 + 编辑操作完整生效', async () => {
    const dir = (0, helpers_1.mkTmpDir)('arr');
    try {
        makeDir(dir);
        const core = new ConnectCore_1.ConnectCore({ moduleDir: dir, watch: false });
        await core.start();
        core.exposeArray('admin:list', 'admin', ['a', 'b', 'c']);
        core.editArray('admin:list', { type: 'removeAt', index: 1 });
        core.editArray('admin:list', { type: 'unshift', value: 'z' });
        core.editArray('admin:list', { type: 'push', values: ['d', 'e'] });
        strict_1.default.deepEqual(core.pullArray('admin:list'), ['z', 'a', 'c', 'd', 'e']);
        // 编辑不存在的数组抛错
        strict_1.default.throws(() => core.editArray('nope', { type: 'push', value: 1 }), /不存在/);
        // 数组编辑被记录到事件流水
        strict_1.default.ok(core.log.byType('array:edit').length >= 3);
        await core.stop();
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
