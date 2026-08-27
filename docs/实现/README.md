# 实现文档

本文档描述 Connect-Core 各项功能是如何实现的，面向维护者。

## 核心部件

| 部件 | 文件 | 职责 |
| --- | --- | --- |
| ConnectCore | src/core/ConnectCore.ts | 核心类：生命周期、配置热加载、数组 API、查询，委托下两者 |
| ModuleManager | src/core/ModuleManager.ts | 模块状态机：启动/停止/重启/停机收尾 + 槽位表 |
| EventDispatcher | src/core/EventDispatcher.ts | 事件派发与定向通道：sendEvent/sendDirected/sendTo |
| MatchIndex | src/core/MatchIndex.ts | 事件比对索引：精确表 + 通配列表 |
| EventMatcher | src/core/EventMatcher.ts | 事件名匹配规则与正则编译缓存 |
| ConfigWatcher | src/core/ConfigWatcher.ts | 模块文件夹轮询监听与 YAML 解析 |
| ArrayRegistry | src/core/ArrayRegistry.ts | 公共数组注册表（三段式名、匹配拉取） |
| EventStreamLog | src/core/EventStreamLog.ts | 日志双层存储与轮转 |
| CliProtocol | src/core/CliProtocol.ts | CLI 定向指令协议 |
| ModuleContext | src/core/ModuleContext.ts | 模块上下文（ctx） |
| loadModule | src/module/loadModule.ts | 模块程序加载器 |

## 事件流转路径

sendEvent 的完整路径：

1. 校验启动状态与停机冻结
2. 拼装完整事件名（来源:事件名段）
3. dispatch：startIndex 命中未运行模块逐个启动
4. listenIndex 命中的运行模块逐个投递，单点失败只记日志
5. 无人命中记 event-drop

## 文档导航

- 事件派发与比对索引：docs/实现/事件派发.md
- 模块生命周期：docs/实现/模块生命周期.md
- 配置监听：docs/实现/配置监听.md
- 公共数组：docs/实现/公共数组.md
- 日志体系：docs/实现/日志体系.md
- CLI 协议：docs/实现/CLI协议.md
- 失败处理与守护：docs/实现/失败处理.md
- 已知问题：docs/实现/已知问题.md
- 验证方法：docs/实现/验证方法.md