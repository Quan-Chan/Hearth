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

## 需求覆盖对应

需求 12 章与实现、文档、测试的对应：

| 需求章节 | 实现 | 使用文档 | 实现文档 | 测试 |
| --- | --- | --- | --- | --- |
| 1 软件形式 | types/loadModule | 模块配置/程序 | 模块生命周期 | unit |
| 2 配置热加载 | ConfigWatcher | 模块配置 | 配置监听 | yaml-watcher |
| 3.1 事件广播 | EventDispatcher | 事件广播 | 事件派发 | core-lifecycle |
| 3.2 定向消息 | EventDispatcher | 定向信息 | 事件派发 | directed-message |
| 3.3 共享数组 | ArrayRegistry | 公共数组 | 公共数组 | array-registry/public-arrays |
| 4 模块生命周期 | ModuleManager | 重启与状态 | 模块生命周期 | core-lifecycle/module-reload |
| 5 核心生命周期 | ConnectCore | 宿主集成接口 | 场景 cold-start/shutdown | boot/shutdown-ack |
| 6 失败处理 | ConnectCore | 模块程序 | 失败处理 | core-lifecycle |
| 7 日志 | EventStreamLog | 日志与命令行 | 日志体系 | event-stream-log/log-format |
| 8 命令行 | CliProtocol/cli | 日志与命令行 | CLI协议 | cli-commands |
| 9 宿主集成 | ConnectCore | 宿主集成接口 | 事件派发 | usability |
| 10 技术栈 | tsconfig | — | 验证方法 | 全部 |

## 性能实测

- 事件比对（benchmarks/perf.js）：精确表+通配列表 vs 全量比对，加速约 9-11x
  （MatchIndex 1.35-1.68 us/事件，全量 15.4-15.5 us/事件）。
- 配置轮询：稳态仅 statSync（约 26 us/文件），内容变化才读+sha1（约 51 us/文件）。
- 端到端派发实测（100 个监听模块）：启动 100 模块 357ms；派发 500 事件 x 100 监听者
  = 50000 次投递 27ms（0.05ms/事件、0.001ms/次投递）；写 5000 条日志 13ms（3us/条）。
  派发链路开销可忽略，成本在模块自身处理与文件 IO。

## 文档导航

- 事件派发与比对索引：docs/zh/实现/事件派发.md
- 模块生命周期：docs/zh/实现/模块生命周期.md
- 配置监听：docs/zh/实现/配置监听.md
- 公共数组：docs/zh/实现/公共数组.md
- 日志体系：docs/zh/实现/日志体系.md
- CLI 协议：docs/zh/实现/CLI协议.md
- 失败处理与守护：docs/zh/实现/失败处理.md
- 已知问题：docs/zh/实现/已知问题.md
- 验证方法：docs/zh/实现/验证方法.md