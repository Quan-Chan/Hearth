# Logs and CLI

## Logs

Logs record only the core's actions and form a continuous timeline. Each log entry has three fields:

- type: log type
- source: the object involved in the action (core, module name, external)
- message: the specific content

Additional structured fields appear by type: event (event name), data, recipients (forwarding list), reason, error, file, removedArrays, command.

### Full Type Set (15 Types)

Grouped by category:

- Core start/stop: core-start, core-stop
- Event handling: event, event-drop
- Module lifecycle: module-start, module-stop, module-skip, module-start-timeout, module-restart
- Config hot reload: config-load, config-update, config-remove
- Module logs: module-log
- CLI instructions: cli-command
- Errors: error

### Storage and Rotation

- Written to disk as JSONL with complete content
- Files are split by day; a single file over 128KB starts a new file
- The current day's file is reused after a process restart
- Memory keeps the most recent 20000 entries for in-process queries
- The display layer truncates overly long content and marks the original length; the disk content is unchanged

### Module Logs

\`\`\`js
ctx.log('Start cooling', room);
\`\`\`

## CLI

The cli module in the modules/cli directory provides a terminal interface. Instructions are sent through the directed channel, and results are returned via onMessage.

| Instruction | Parameters | Description |
| --- | --- | --- |
| event | name, data | Produce an event |
| start | module | Start a module |
| stop | module | Stop a module |
| send | name, targets | Send an event directly; * broadcasts, multiple targets separated by commas, targets need not declare listening |
| state | none | Query modules and shared arrays |
| exit | none | Deliver the result to the initiator first, then shut down the core |

Local instructions (handled by the cli module itself):

- log [filter] [count]: view the log timeline
- help: show help
- print: output test text
