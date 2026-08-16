"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModuleContext = void 0;
class ModuleContext {
    /** 模块名 */
    moduleName;
    /** 模块 YAML 中的自定义配置 */
    config;
    core;
    constructor(core, moduleName, config) {
        this.core = core;
        this.moduleName = moduleName;
        this.config = config;
    }
    /** 产生一个事件消息（框架核心会负责比对与分发）。 */
    sendEvent(name, data) {
        return this.core.sendEvent(name, data, this.moduleName);
    }
    /** 公开数组（模块选择公开的数组，其他人可拉取/编辑内容，但不能改名）。 */
    exposeArray(name, initial = []) {
        this.core.exposeArray(name, this.moduleName, initial);
    }
    /** 取消公开数组（仅限自己公开的）。 */
    unexposeArray(name) {
        this.core.unexposeArray(name, this.moduleName);
    }
    /** 拉取特定数组（深拷贝快照）。 */
    pullArray(name) {
        return this.core.pullArray(name);
    }
    /** 编辑特定数组的内容（结构化操作；数组名不可改变）。 */
    editArray(name, op) {
        this.core.editArray(name, op);
    }
    /** 模块自有日志（写入事件流水，type=module:log）。 */
    log(...parts) {
        this.core.logModule(this.moduleName, ...parts);
    }
}
exports.ModuleContext = ModuleContext;
