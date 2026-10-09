# CLI Instruction Protocol

## Single-channel design

Directed messages targeting core are interpreted as management instructions, and the result is returned directly to the initiator via a directed message. The previous doorbell protocol (instruction + request event + result + completion event) has been deleted entirely, converging on a single channel.

## Flow

1. Caller sends sendTo('core', { cmd, args })
2. CliProtocol.handleDirected parses the instruction and arguments, records a cli-command log
3. Execute per the instruction dispatch table (event, start, stop, send, state)
4. Result { cmd, ok, result, error } is returned to the initiator via sendTo
5. exit / quit acknowledge first, then stop the core

## Instruction dispatch table

| Instruction | Execution logic |
| --- | --- |
| event | Produce an event with the initiator as source (event-name-segment + data) |
| start | Start a module, reason recorded as cli (unlocks the timeout lock) |
| stop | Stop a module; its objects are unregistered along with it |
| send | Directed delivery of an event: * broadcasts to all running modules with onEvent, comma-separated for multiple targets |
| state | Return the module list and the object list (object('*') matching pull) |

A single instruction failure only affects that instruction's result (ok:false); the core stays usable.
