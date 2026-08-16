"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadModuleProgram = exports.parseModuleConfig = exports.ConfigWatcher = exports.patternToRegExp = exports.anyEventMatches = exports.eventMatches = exports.applyOp = exports.ArrayRegistry = exports.EventStreamLog = exports.ModuleContext = exports.ConnectCore = void 0;
exports.createCore = createCore;
exports.startCore = startCore;
/**
 * Connect-Core 公共入口。
 * 启动核心 == 启动整个软件：startCore() 会启动核心并让所有模块按事件自动启动。
 */
var ConnectCore_1 = require("./core/ConnectCore");
Object.defineProperty(exports, "ConnectCore", { enumerable: true, get: function () { return ConnectCore_1.ConnectCore; } });
var ModuleContext_1 = require("./core/ModuleContext");
Object.defineProperty(exports, "ModuleContext", { enumerable: true, get: function () { return ModuleContext_1.ModuleContext; } });
var EventStreamLog_1 = require("./core/EventStreamLog");
Object.defineProperty(exports, "EventStreamLog", { enumerable: true, get: function () { return EventStreamLog_1.EventStreamLog; } });
var ArrayRegistry_1 = require("./core/ArrayRegistry");
Object.defineProperty(exports, "ArrayRegistry", { enumerable: true, get: function () { return ArrayRegistry_1.ArrayRegistry; } });
Object.defineProperty(exports, "applyOp", { enumerable: true, get: function () { return ArrayRegistry_1.applyOp; } });
var EventMatcher_1 = require("./core/EventMatcher");
Object.defineProperty(exports, "eventMatches", { enumerable: true, get: function () { return EventMatcher_1.eventMatches; } });
Object.defineProperty(exports, "anyEventMatches", { enumerable: true, get: function () { return EventMatcher_1.anyEventMatches; } });
Object.defineProperty(exports, "patternToRegExp", { enumerable: true, get: function () { return EventMatcher_1.patternToRegExp; } });
var ConfigWatcher_1 = require("./core/ConfigWatcher");
Object.defineProperty(exports, "ConfigWatcher", { enumerable: true, get: function () { return ConfigWatcher_1.ConfigWatcher; } });
Object.defineProperty(exports, "parseModuleConfig", { enumerable: true, get: function () { return ConfigWatcher_1.parseModuleConfig; } });
var loadModule_1 = require("./module/loadModule");
Object.defineProperty(exports, "loadModuleProgram", { enumerable: true, get: function () { return loadModule_1.loadModuleProgram; } });
const ConnectCore_2 = require("./core/ConnectCore");
/** 创建核心（不会自动启动）。 */
function createCore(options = {}) {
    return new ConnectCore_2.ConnectCore(options);
}
/** 启动整个软件：创建核心并启动。模块按事件自动加载、启动。 */
async function startCore(options = {}) {
    const core = new ConnectCore_2.ConnectCore(options);
    await core.start();
    return core;
}
