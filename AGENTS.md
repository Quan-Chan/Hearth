# AGENTS.md

本文件为 AI 助手（或任何阅读代码库的代理）提供本项目的结构、理念与工作约定。
在修改代码、编写文档、添加功能前，先读本文件。

## 项目概览

Hearth 是一个事件驱动的模块化框架核心，运行在 Node.js 上，使用 TypeScript 编写，版本 0.1.0（预发布）。

软件由核心与模块组成：

- 核心（src/）：启动模块、在模块之间转发事件、提供共享数据
- 模块：YAML 配置 + 程序文件的组合，程序文件导出四个可选钩子（start/stop/onEvent/onMessage）

模块之间的协作经三条通道：

- 事件广播（sendEvent/onEvent）：纯字符串信号，携带可选内容，即发即弃
- 定向消息（sendTo/onMessage）：点对点直通，目标为核心时可寻址（CLI 指令入口）
- 共享数组（exposeArray/array）：公开数组对象引用，一次修改处处可见

## 项目理念（重要）

1. 极简核心：框架刻意保持基础，只做"启动模块、转发事件、共享数据"三件事。
2. 中间层职责：权限控制、持久化、UI、HTTP、消息队列等能力不由框架内置，
   由开发者写模块/中间层实现。判定"有没有这个功能"的标准是：能否用现有机制实现，
   而不是框架是否内置。
3. 简单+有用：新增功能必须同时满足简单和有明确收益，否则不加。
4. 不引入过度设计：不添加多余的抽象、字段、配置项。

## 文件结构

仓库被克隆到本地后呈现的结构如下：

```
Hearth/
├── src/                      # TypeScript 源码
│   ├── core/                 # 核心实现
│   │   ├── Hearth.ts    # 主类：生命周期/配置热加载/数组API/查询，委托下两者
│   │   ├── ModuleManager.ts  # 模块状态机：启动/停止/重启/停机收尾 + 槽位表
│   │   ├── EventDispatcher.ts# 事件派发与定向通道（sendEvent/sendDirected/sendTo）
│   │   ├── ConfigWatcher.ts  # 模块文件夹轮询监听 + YAML 解析（200ms 指纹轮询）
│   │   ├── EventStreamLog.ts # 日志双层存储（内存窗口 + JSONL 落盘，按天/大小轮转）
│   │   ├── ArrayRegistry.ts  # 公共数组注册表（三段式名、匹配拉取）
│   │   ├── MatchIndex.ts     # 事件比对索引（精确表 + 通配列表）
│   │   ├── EventMatcher.ts   # 事件名匹配规则（* 与 ? 通配）
│   │   ├── CliProtocol.ts    # CLI 定向指令协议
│   │   ├── ModuleContext.ts  # 模块上下文（ctx，模块看到的 API 面）
│   │   └── logFormat.ts      # 日志类型/格式/展示截断
│   ├── module/loadModule.ts  # 模块程序加载器（CJS/ESM/工厂函数）
│   ├── index.ts              # 公共导出（createCore/startCore 等）
│   ├── hearth.ts             # 命令行入口
│   └── types.ts              # 共享类型定义
├── tests/                    # 测试（100 个）
│   ├── unit/                 # 单元测试（组件级）
│   ├── integration/          # 集成测试（真实核心行为）
│   ├── apps/                 # 应用测试（真实软件形态：聊天机器人/任务调度/智能家居/监控）
│   ├── fixtures/             # 应用测试的真实模块夹具
│   └── helpers.ts            # 测试工具（mkTmpDir/waitFor/yamlFor 等）
├── docs/                     # 文档（双语）
│   ├── zh/                   # 中文文档
│   │   ├── 需求.md           # 需求文档（12 章）
│   │   ├── 使用/             # 使用文档（模块编写与宿主集成）
│   │   └── 实现/             # 实现文档（内部机制/已知问题 20 项/场景 9 篇）
│   └── en/                   # 英文文档（与中文一一对应）
├── modules/                  # 官方示例模块
│   └── cli/                  # CLI 终端界面模块（可选）
├── scripts/                  # 文档检查脚本
│   ├── verify-docs.mjs       # 文档事实对照（15 条事实，docs:check 用）
│   └── check-doc-duplicates.mjs # 跨文档重复检查
├── benchmarks/perf.js        # 性能基准（npm run bench）
├── .github/workflows/ci.yml  # CI：typecheck + test + docs:check + build（Node 22/24）
├── package.json              # 包定义（依赖仅 yaml；engines >=22）
├── package-lock.json         # 依赖锁定
├── tsconfig.json             # 编译配置（src -> dist）
├── tsconfig.test.json        # 测试编译配置（src+tests -> .test-build）
├── hearth.yaml         # 命令行启动的默认配置
├── README.md                 # 英文介绍（默认）
├── README.zh.md              # 中文介绍
├── LICENSE                   # Apache-2.0
└── .gitignore
```

## 开发命令

```bash
npm run build          # 编译 src -> dist
npm run typecheck      # 类型检查（tsc --noEmit）
npm test               # 全部测试（单元+集成+应用，100 个）
npm run test:unit      # 单元测试
npm run test:integration # 集成测试
npm run test:apps      # 应用测试
npm run docs:check     # 文档检查（15 条事实对照 + 跨文档查重）
npm run bench          # 性能基准
npm start              # 命令行启动
```

## 命名与编码约定

- 日志类型：kebab-case（如 module-start、event-drop）
- 事件名：两段式 来源:事件名（来源段由核心按调用方自动拼装，模块不可伪造）
- 数组名：三段式 public:模块名:数组名
- 日志与错误消息：全英文（避免编码问题；代码注释可用中文）
- 模块名全局唯一，不允许重复

## 文档与注释规范（AI 必读，强制）

编写或修改本项目任何文档、注释时，必须遵守以下规范。

### 禁止

- 不加粗，无任何形式的强调
- 不使用评价词
- 不写推荐语
- 不极端化，不过度简化，不过度复杂化
- 不制造转折与悬念，不用营销口吻
- 不自我抬高，不自我辩护
- 不可过度解释一个基础概念
- 不可在非被解释的位置解释
- 类型、选项等说明放在正文
- 代码不解释每一行代码
- 不预设观看者存在偏见而去澄清概念
- 不自证清白，不低自尊，不讨好
- 不写元信息，不留分析痕迹（来源、方法、数据）
- 必要信息作头信息直接陈述，不标榜

### 不推荐的用词

拆解、兜底、优雅、流水、约定、语义、精通、一步步、稳稳、只记、一律、精准、原子、准则、原则

### 不推荐的句式

1. 不是…，是
2. 不是…，…
3. …，但…
4. …就…

### 要求

- 不可使用比喻
- 不可使用拟人化
- 高信息密度
- 代码示例放入代码块
- 行内代码和路径使用反引号
- 只写软件本身的内容
- 会删除的内容不进入文档
- 默认值、行为、顺序、名称准确

### 文档双语结构

- 文档按语言分目录：docs/zh/（中文）与 docs/en/（英文），一一对应
- 新增或修改文档时，中英文版本必须同步更新
- README.md 为英文默认，中文版在 README.zh.md
- 修改文档后运行 npm run docs:check 验证

## 修改代码的注意事项

1. 保持公开 API 签名不变（测试依赖它们）。
2. 修改后必须运行 npm run typecheck 和 npm test，全部通过才能提交。
3. 修改日志消息时，同步更新测试断言（测试断言了日志内容）。
4. 新增行为时，补充相应测试（tests/ 按 unit/integration/apps 分层）。
5. 新功能遵循"简单+有用"标准，不做过度设计。
6. 提交信息用中文 conventional 风格（feat:/fix:/refactor:/docs:/test:/ci:/chore:）。