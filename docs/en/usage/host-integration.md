# Host Integration

The entry for host code to create and operate the core. Compared with the CLI approach, this is the code-call approach.

## Entry Functions

- createCore(options): constructs the core, does not start it
- startCore(options): constructs and starts it immediately, returns the started core

\`\`\`ts
import { startCore } from './src';
const core = await startCore({ moduleDir: './modules' });
\`\`\`

## Core Options

| Option | Default | Description |
| --- | --- | --- |
| moduleDir | ./modules | Module folder path |
| logFile | ./logs/event-stream.log | Log file path |
| watch | true | Whether to poll the module folder for changes |
| pollIntervalMs | 200 | Polling interval of the watcher in milliseconds |
| logToConsole | false | Whether to also output logs to the console |
| guardProcess | false | Whether to capture unhandled async failures and uncaught exceptions, only logging them and not letting the process exit |
| defaultStartTimeoutMs | 0 | Default module start timeout for the whole core in milliseconds; 0 or unset means no timeout |
| maxLogMemoryEntries | 20000 | Upper limit of log entries kept in memory |
| stopTimeoutMs | 20000 | Time limit in milliseconds for waiting for all modules to report closed during shutdown |

The core section of the root config file connect-core.yaml can write the same fields; relative paths are resolved against the directory containing the config file.

## Core Methods

Lifecycle: start(), stop(), started.

Module management: startModule(name, reason?), stopModule(name), reloadModule(name), rescanModules().

Events and messages: sendEvent(name, data?, source?) produces an event; sendTo(target, data?, source?) sends point-to-point; sendDirected(targets, name, data?, source?) delivers an event directly to the specified targets or broadcasts to all; targets need not declare listening, and no start-event matching is performed (the underlying capability of the CLI send instruction).

Shared arrays: exposeArray(name, owner, items), unexposeArray(name, owner), array(pattern).

Query and logs: listModules(), getModule(name), logModule(name, ...parts).

## Module Status Query

listModules() returns all modules (name, config, status); getModule(name) returns a single module. Status has four values: stopped, starting, running, failed.
