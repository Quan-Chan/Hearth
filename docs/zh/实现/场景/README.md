# Hearth 场景

场景描述软件在运行时实际发生的行为序列。场景覆盖三个面：启动、转发、共享。

- [冷启动](cold-start.md)：宿主调用 startCore()，软件按事件自动启动
- [事件链式转发](event-chain.md)：模块收到事件后产生新事件，形成链
- [动态转发](dynamic-forward.md)：模块自改 YAML 的 listen，转发表实时变化
- [请求重启](request-reload.md)：模块替换代码后请求重启
- [停机协议](shutdown.md)：core.stop() 的完整序列
- [公共数组共享](shared-array.md)：公开、拉取、修改、注销
- [失败隔离与进程守卫](failure-isolation.md)：钩子抛错与未处理拒绝的处理
- [CLI 指令协议](cli-protocol.md)：两条通道执行指令