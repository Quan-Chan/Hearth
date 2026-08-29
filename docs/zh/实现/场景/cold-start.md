# 场景：冷启动

宿主调用 startCore(options) 或 createCore 后 start()，核心扫描模块目录、广播 core:startup，startEvents 匹配的模块逐个启动。

## 流程

1. 构造核心，解析选项默认值，创建日志。
2. start() 置 started 标志，guardProcess 开启时安装进程守卫，记 core-start 日志。
3. ConfigWatcher 首次扫描模块目录：按自然排序收集两层 YAML（数字按数值、字符按字典序、大小写敏感），逐个注册、重建两套索引，记 config-load。同名冲突拒绝并记 error。
4. 广播 core:startup：命中的未运行模块按加载顺序逐个启动。
5. 每个模块启动：
   - 置 starting，从磁盘加载程序，构造上下文
   - 等待 start() 返回
   - 成功：置 running，记 module-start
   - 失败：置 failed，记 error
6. core:startup 无人监听时记 event-drop。
7. startCore 返回已启动的核心。

## 边界

- 重复调用 start() 抛错。
- 核心未启动或停机中调用发送接口抛错。
- 模块启动失败对调用方静默，只有日志。
- 启动超时只放弃等待：函数悬空运行，自动重试锁死（见 已知问题 3）。
- 坏 YAML 与同名冲突每轮一条 error 日志。
- 分层目录之外的 YAML 静默不上线。
- 启动串行，顺序为自然排序（模块名/文件夹名），慢 start 推迟后续。
- 停机只能作废进行中的启动结果，启动函数的副作用照常发生。
- 来源段对持有核心句柄的调用方可伪冒（核心层可显式传来源）；模块通道不可（见 已知问题 8、20）。