# CLI 指令协议

## 单通道设计

目标为 core 的定向信息被解释为管理指令，结果经定向信息直接回传发起方。此前存在的门铃协议（指令 + 请求事件 + 结果 + 完成事件）已整体删除，收敛为单一通道。

## 流程

1. 调用方 sendTo('core', { cmd, args })
2. CliProtocol.handleDirected 解析指令与参数，记 cli-command 日志
3. 按指令派发表执行（event、start、stop、send、state）
4. 结果 { cmd, ok, result, error } 经 sendTo 回传发起方
5. exit / quit 先回执再停止核心

## 指令派发表

| 指令 | 执行逻辑 |
| --- | --- |
| event | 以发起方为来源产生事件（事件名段 + 数据） |
| start | 启动模块，原因记为 cli（解锁超时锁） |
| stop | 停止模块，其对象随之注销 |
| send | 定向投递事件：* 广播给所有运行且有 onEvent 的模块，逗号分隔多目标 |
| state | 返回模块清单与对象清单（object('*') 匹配拉取） |

单条指令失败只影响该条结果（ok:false），核心继续可用。