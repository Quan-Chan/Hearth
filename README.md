# Connect-Core

> 事件驱动的极简模块化框架核心 —— 用极小的中心文件管理大量插件，高通用、低开销。
> TypeScript + Node.js。

**启动核心 == 启动整个软件。** 核心启动时发出 `core:startup` 事件，所有依赖该事件的模块自动启动；模块文件夹中的 YAML 配置被持续监听，新增/修改/删除都会热生效。

## 1. 设计思想（对应 REQUIREMENTS.md）

| 需求 | 实现 |
| --- | --- |
| 事件是纯字符串消息信号 | `CoreEvent.name` 为字符串信号（如 `core:startup`），支持精确匹配与通配符（`*`、`?`）比对 |
| 公共数组：公开、可拉取、不能改名 | **映射语义**：公开 = 把数组对象映射到名字（存引用）；`array()` 返回实时引用，像原生数组一样使用；公开者消失（模块停止）数组自动消失；数组名不可变 |
| 模块 = 可被加载的程序，靠 YAML 启动 | 模块 = YAML 配置 + 程序文件（`.cjs/.js/.mjs/.ts`），YAML 声明 `startEvents`（出现即启动）与 `listen`（出现即向其发送事件消息） |
| 核心方法：启动/关闭模块、发送事件 | `startModule / stopModule / sendEvent` |
| 核心自产事件 | `core:startup`（核心启动）、`core:shutdown`（核心关闭） |
| 比对事件 | 每个事件到达时：①未运行的模块若 `startEvents` 匹配则启动；②运行中的模块若 `listen` 匹配则向其发送事件消息 |
| 监听模块文件夹 | `ConfigWatcher` 轮询模块目录，YAML 新增→加载、变化→更新并重启模块、删除→停止并移除 |
| 日志：记录核心自己干的事情（事件流水） | `EventStreamLog` JSONL 落盘，三字段 `{type, source, message}`：类型（核心的动作）/ 来源 / 信息；只记事件收发、模块启停、配置加载、模块日志与错误，数组操作不记（防高频爆日志） |

**模块间通信被严格限制**：只能通过「事件信号 + 公共数组数据」协作，不能互相直接调用 —— 模块间的 DAG 由事件涌现产生，核心因此保持极小。

## 2. 快速开始

```bash
npm install
npm run build

# 方式一：命令行启动（读取 connect-core.yaml）
node dist/cli.js examples/basic/connect-core.yaml

# 方式二：代码启动（启动即整机）
```ts
import { startCore } from './src/index';
const core = await startCore({ moduleDir: './examples/basic/modules' });
await core.sendEvent('echo', { text: '世界' });
console.log(core.array('greetings')); // ['你好, 世界!']
await core.stop();
```
```

## 3. 模块开发指南

### 3.1 YAML 配置（放在模块文件夹中）

```yaml
name: greeter            # 模块名（全局唯一）
file: ./greeter.cjs      # 模块程序路径（相对 YAML）
startEvents:             # 启动事件：出现该事件时核心启动此模块
  - "core:startup"
listen:                  # 监听事件：出现时核心向模块发送事件消息
  - "greet"
  - "chat:*"
enabled: true            # 可选，默认 true
config:                  # 可选，透传给模块（ctx.config.config）
  threshold: 100
```

事件名支持通配符：`*` 匹配任意字符序列，`?` 匹配单个字符。

### 3.2 模块程序

```js
// greeter.cjs —— 导出对象或工厂函数即可
module.exports = {
  name: 'greeter',
  async start(ctx) {            // 被核心启动时调用
    ctx.exposeArray('greetings', []);          // 公开数组
    ctx.log('问候模块已就绪');                    // 模块日志（进入事件流水）
  },
  async onEvent(ctx, event) {  // 核心向模块发送事件消息时调用
    if (event.name === 'greet') {
      ctx.array('greetings').push('你好, ' + event.data.name + '!');
      ctx.sendEvent('greet:done', { name: event.data.name });  // 产生新事件（链式协作）
    }
  },
  async stop(ctx) { }           // 被核心关闭时调用
};
```

### 3.3 模块上下文 API（模块内方法）

| 方法 | 对应需求 |
| --- | --- |
| `onEvent(ctx, event)`（由核心调用） | 接收事件信息 |
| `ctx.exposeArray(name, initial?)` | 公开数组（同拥有者重新公开 = 重置内容） |
| `ctx.unexposeArray(name)` | 取消公开数组（仅拥有者） |
| `ctx.array(name)` | 拉取特定数组：返回被映射对象引用（O(1)），原生数组语法，一次修改处处有效 |
| `ctx.sendEvent(name, data?)` | 产生事件消息 |
| `ctx.log(...)` / `ctx.config` | 模块日志 / YAML 配置 |


## 4. 事件流水日志

日志只记录**核心框架自己干的事情**，每条三字段主结构：

| 字段 | 含义 | 示例 |
| --- | --- | --- |
| `type` | ① 日志类型：核心的动作（kebab-case 统一命名） | `event` / `event-drop` / `module-start` |
| `source` | ② 日志来源：动作涉及的对象 | `core` / `external` / 模块名 |
| `message` | ③ 日志信息：人类可读的具体内容 | `echo` / `事件 core:startup 匹配启动条件` |

**日志类型全集**：`core-start` `core-stop`（核心启停）、`event`（收到并转发）、`event-drop`（收到但无模块匹配，丢弃）、`module-start` `module-stop` `module-skip`（模块启停）、`config-load` `config-update` `config-remove`（配置热加载）、`module-log`（模块显式请求的日志）、`cli-command`（CLI 指令）、`error`。

> 数组操作（公开/编辑/读取）**不记录日志**——数组是模块间的数据通道，可能是高频流式操作，逐条记录会撑爆日志。

日志是一条**连续的时间线**：发生什么就记录什么，按发生顺序逐条输出，不需要脑内排序。需要分区/过滤时，直接对 JSONL 按 `type` 过滤（等价于 grep），不在展示层做分区。落盘为 JSONL（`logs/event-stream.log`），人类可读格式示例：

```
12:05:31.032 [core-start] core: 核心启动
12:05:31.046 [event-drop] core: core:startup
12:05:31.046 [module-start] echo: 事件 core:startup 匹配启动条件  [reason=core:startup]
12:05:31.047 [event] external: echo  [转发=echo  data={"text":"世界"}]
12:05:31.047 [event] echo: greet  [转发=greeter  data={"name":"世界"}]
12:05:31.047 [module-log] greeter: 收到问候: 世界
12:05:31.047 [event-drop] external: no:one-listens  [data={"note":"测试丢弃"}]
12:05:31.047 [module-stop] greeter: 关闭模块，清理 1 个公共数组  [清理数组=greetings]
12:05:31.047 [core-stop] core: 核心关闭
```

## 5. 测试：用真实软件驱动框架验证

测试策略：先分析框架能做什么（事件驱动插件化），再选取依赖这些能力的真实软件形态，把它们构建在框架之上进行端到端验证。

**69 个测试用例全部通过**（`npm test`）：

| 层级 | 文件 | 覆盖 |
| --- | --- | --- |
| 单元 | `tests/unit/`（6 文件，31 用例） | 事件匹配器、公共数组注册表、事件流水日志、YAML 解析、模块加载、日志格式 |
| 集成 | `tests/integration/`（5 文件，28 用例） | 核心生命周期、事件路由、失败隔离、YAML 热加载、公共数组跨模块、模块自改 YAML、CLI 命令面 |
| 应用 | `tests/apps/`（5 文件，10 用例） | 见下表 |

**构建在框架上的真实软件（即测试载体）：**

| 软件 | 现实对应 | 模块 | 验证点 |
| --- | --- | --- | --- |
| 聊天机器人 | QQ/Discord 机器人、客服助手 | gateway / router / help / echo / stats | 消息流转、!命令识别、应答写入共享历史、在线用户、通配符统计 |
| 任务调度器 | cron / 任务队列 / CI 调度 | scheduler / worker / notifier | 提交→定时到期→执行→通知全链路、取消任务 |
| 智能家居 | Home Assistant / 米家自动化 | sensor / light / logger / thermostat / cooler | 多模块同听一事件、温度超阈值链式制冷、通配符安全日志 |
| 监控告警 | Prometheus 告警 / APM | collector / alerting / dashboard | 指标去重聚合、YAML 阈值配置、告警历史归档 |
| 启动即整机 | 框架核心形态 | examples/basic | `startCore` 一次启动全部模块，链式事件协作 |

## 6. 目录结构

```
src/                  # 框架核心（极简中间层）
  core/               # ConnectCore / EventMatcher / ArrayRegistry / ConfigWatcher / EventStreamLog / ModuleContext
  module/loadModule.ts# 模块程序加载器
  index.ts            # 公共入口（createCore / startCore）
  cli.ts              # 命令行入口（启动即整机）
tests/
  unit/               # 单元测试
  integration/        # 集成测试
  apps/               # 真实软件测试（聊天机器人/任务调度器/智能家居/监控告警）
  fixtures/           # 各应用的模块夹具
examples/basic/       # 演示：最小可用整机
  modules/            # 模块 YAML + 程序（echo / greeter）
  demo.cjs            # 演示脚本（npm run demo）
examples/web-demo/    # 演示：网页控制台（数据工坊，npm run demo:web）
  modules/            # 模块 YAML + 程序（collector / processor / reporter / alarm / notifier）
  server.cjs          # HTTP 服务器 + 网页控制
  public/index.html   # 控制页面
examples/cli/         # 演示：CLI（可选模块，npm run demo:cli）
  modules/            # cli（REPL 命令面）+ echo（不监听，被定向发送）+ listener（正常监听）
  connect-core.yaml   # cli 模块所在整机的配置
```

## 6.5 CLI（可选模块）
CLI 是一个**可选模块**（`examples/cli/modules/cli.*`）：把它放进模块目录，核心启动后你就获得一个命令行界面；不放它就完全没有 CLI。它必须与核心的 CLI 命令面联动才能工作——启动时它会发一条 `core:cli:state` 自检，核心不回应则 CLI 不可用。

```bash
npm run demo:cli    # 交互式 REPL（或 node dist/cli.js examples/cli/connect-core.yaml）
```

**核心只提供命令面（`core:cli:*` 指令即事件），界面、解析、日志展示等高级功能全部在 cli 模块端实现**——核心保持极简。

| 指令 | 作用 | 核心命令面 |
| --- | --- | --- |
| `event <名称> [JSON]` | 生成一个自定义事件 | 直接 `ctx.sendEvent`（普通事件通道） |
| `start <模块>` | 开启模块（即使没有事件） | `core:cli:start-module` |
| `stop <模块>` | 关闭模块 | `core:cli:stop-module` |
| `send <目标|*> <名称> [JSON]` | 定向发送事件（目标无需监听；`*` 广播） | `core:cli:send-event` |
| `state` | 查看模块与公共数组（回复 `core:cli:reply-state`） | `core:cli:state` |
| `log [过滤词] [条数]` | 查看日志时间线（CLI 自己读 JSONL 文件 grep，核心不参与） | — |
| `help` / `exit` | 帮助 / 优雅关闭（`core:cli:stop-core`） | — |

**响应的两种模式**（不把所有东西塞进事件）：
- (a) 模块只广播"已完成/有信息"信号事件（如 echo 处理完广播 `echo:done`）；
- (b) 实际内容放公开数组（如 `echo:out`），CLI 或其他模块用 `ctx.array()` 自己拉取——`state` 命令只回名字/状态，内容由 cli 模块拉。

## 7. 常用命令

```bash
npm run typecheck     # 类型检查
npm run build         # 编译到 dist/
npm test              # 全量测试（69 用例）
npm run test:unit     # 仅单元
npm run test:integration
npm run test:apps
npm run demo          # 最小整机演示（examples/basic）
npm run demo:web      # 网页演示（http://127.0.0.1:3081）
npm run demo:cli      # 命令行演示（examples/cli，交互式 REPL）
npm start             # 用 node dist/cli.js 启动（读当前目录 connect-core.yaml）
```