# 场景：CLI 指令协议

cli 模块经定向通道向核心发送指令，核心执行并经定向信息回传结果。

## 流程

1. CLI 解析终端行，调用 sendTo('core', { cmd, args })。
2. 核心拦截目标为 core 的定向信息，按指令派发表执行（event、start、stop、send、state），记 cli-command 日志。
3. 结果 { cmd, ok, result, error } 经 sendTo 直接回传发起方。
4. onMessage 收到后按 cmd 分支打印；exit 或 quit 先回执再停止核心。

## 边界

- stop 指令使模块对象立即消失，持有引用者抛错。
- 定向回传依赖发起方运行中且有 onMessage：外部进程发指令收不到结果。
- start 指令的模块启动失败 ok 仍为 true，错误需 state 另查。
- send 对无效目标静默成功：ok 为 true 但无收件人。
- 对象名无拥有者校验，任何模块可注入指令（见 已知问题 20）。