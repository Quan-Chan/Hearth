# Connect-Core Requirements

## 1. Software form

The software consists of a core and modules. Responsibilities of the core:

- Start modules
- Forward events between modules
- Provide shared data for modules

Composition of a module:

- A module is a combination of YAML config and a program file
- The YAML declares the identity, the program location, and the four elements of event relationships
- The program file can be one of three forms: a CJS object, an ESM default export, or a factory function returning an object
- The exported object can contain four optional hooks: start on startup, stop on shutdown, onEvent for receiving events, onMessage for receiving directed messages
- Each startup reloads the program file from disk

Module layout rules:

- One subfolder per module; the folder contains a YAML and a program file with the same name as the module
- Flat placement at the top level is also recognized
- Only these two levels are recognized; deeper directories are not recursed

## 2. Module registration and config hot reload

Module folders are continuously watched by the core; the following changes take effect in place without restart:

- New YAML file: register the module
- Content change: update the module's config and forwarding table
- File deletion: stop and remove the module

Rules for applying config changes:

- An update only affects the YAML itself; the running module instance and code stay unchanged
- The module reads the new config at any time and decides on its own when to apply it
- When the config flips the enable switch to off, the running module is stopped
- YAML that fails to parse is logged and retried next round, without affecting the core or other modules
- Module names are globally unique; when a module with the same name already exists, the new file is refused registration, and the refused file keeps re-requesting until the problem is fixed
- Config changes are detected with double validation (file status and content hash); touch-only operations do not trigger an update

## 3. Communication mechanism

Information exchange between modules goes through three channels: event broadcast, directed messages, shared arrays.

### 3.1 Event broadcast

Structure of an event:

- An event consists of a full event name and optional content: the full event name is two-segment (source:event-name), the source segment is assembled automatically by the core per caller (module sends are the module name, core self-produced is core, host calls are external), the event-name segment is defined by the module; the content data is arbitrary data written by the module itself
- Matching uses the full event name; data does not participate in matching; a wildcard responds to same-name events from any source

Rules for event delivery:

- Events are fire-and-forget, with no queue and no retry
- For a not-running module the same event is a startup signal; for a running module it is a work instruction
- On arrival an event first compares the startup condition, then the listening condition
- Listeners receive the event one by one in load order; one module's processing failure does not affect other modules
- An event no one listens to is recorded as an event drop
- Event name matching supports wildcards: * matches any character sequence, ? matches a single character

Lifecycle events:

- core:startup: emitted when the core finishes starting; modules that declare a dependency on this event start automatically

### 3.2 Directed messages

A module can send messages to a specified module, passing through the core in between. Rules:

- The core validates that the target module exists and is running; invalid targets are not delivered
- A module without onMessage does not receive directed messages; the sender receives a not-delivered result
- Messages carry a source field: the core automatically fills in the sender module name (cannot be forged)
- The core is addressable as a target: it serves as the management command entry, and results are returned directly to the initiator
- Request-response is supported: the responder replies directly to the requester; multiple requesters do not interfere with each other

### 3.3 Shared arrays

A module can expose an array, and other modules can fetch it. Rules:

- What is exposed is the array object reference, not a copy
- Other modules can modify the original array content directly; the modification is immediately visible to all holders

- Un-exposing can only be performed by the owner
- When the module that exposed the array is closed, the array disappears with it
- Array capacity and persistence are the responsibility of the user
- Array operations are not logged: arrays are a business data channel that may be read and written at high frequency, and per-record logging would blow up the log

## 4. Module lifecycle

### 4.1 State

Module states: stopped, starting, running, failed. The start time and failure reason are not stored in the state: module-start and error logs carry timestamps; check the logs.

Repeated starts of an already running module, shutdown of a not-running module, and operations on a disabled module log a skip record.

### 4.2 Start

- When a startup event appears, the core starts modules that are not running and enabled
- Before one startup attempt completes, the same module does not accept another start
- Each startup reloads the program file and calls the start hook
- The start hook throws: the module is marked failed and an error log is written
- The start hook does not return within the deadline: the core gives up waiting and marks it failed; the module is no longer retried automatically by events; recovery requires manual or config-side intervention
- A module that failed to start can be recovered by a manual start or a config update

### 4.3 Stop

- Stop a single module: call its stop hook and wait for the return; a return means closed
- Stop an in-progress startup: that startup is voided, and the side effects of its start hook still occur

### 4.4 Restart

After replacing its program file, a module can request a restart of itself. Rules:

- The core first validates that the new code can be loaded
- Validation fails: the old instance keeps running, the requester receives a failure result
- Validation passes: stop the old instance and start a new instance with the validated code
- State preservation and recovery are the module's responsibility; the core does not migrate any state

## 5. Core lifecycle

### 5.1 Start

Starting the core means starting the whole software:

1. Scan the module directory
2. Register all module configs and build the forwarding table
3. Emit core:startup
4. Modules matched by the startup event start automatically

Two entries are provided: construct only without starting, and construct and start immediately.

### 5.2 Stop

The process of stopping the core:

1. Stop config watching
2. Call the stop hooks of all running modules and wait for the returns
3. All returned means complete

Rules:

- The wait has an overall deadline; on timeout force close and record the modules that did not return
- New events, directed messages, and config changes are all rejected during shutdown
- Calling send interfaces during shutdown receives an error

### 5.3 Code reload

- Program files are reloaded on startup; after a module restart the latest code is obtained
- Config updates do not reload code; code reload is initiated by the module

## 6. Failure handling and process guard

- The core catches exceptions for each hook call independently; one module's failure does not affect other modules or the core
- Private unhandled async failures of modules follow the runtime's default behavior by default
- A process guard can be enabled: catch unhandled async failures and uncaught exceptions, log only, the process continues
- Failures can be queried through module state and logs

## 7. Logging

The log only records what the core framework itself does. Entry structure:

- Each log entry contains three items: log type, log source, log message
- Additional structured fields: event name, data, forwarding list, reason, error, file name, cleanup arrays

Storage and display:

- The log is a continuous timeline, ordered by occurrence, filterable by type or category
- Two-layer storage: memory keeps the most recent entries, the complete set is written to a JSONL file
- Disk files rotate by day and size; the current file is reused after a process restart
- The written content is complete; the display layer shortens overlong content and marks the original length
- Array operations are not logged
- A module can write logs on its own, with the type module log
- Logs can be output to the console synchronously

Log types include:

1. Core start and stop: core start, core shutdown
2. Event handling: event forwarding, event drop
3. Module lifecycle: start module, stop module, skip start/stop, start timeout, restart
4. Config hot reload: load config, update config, remove config
5. Module logs: logs explicitly requested by modules
6. CLI commands: command execution records
7. Errors: startup failure, event handling failure, config parse failure, and others

## 8. Command line interface

An optional command line interface module is provided to make the framework's behavior visible and operable.

Commands:

- event: produce an event
- start: start a module
- stop: stop a module
- send: send directed events, supporting broadcast and multiple targets
- state: query modules and public arrays
- exit: deliver the result first, then shut down the core
- log: view the log timeline, filtered by keyword and count



## 9. Host integration interface

Capabilities available to the host:

- Create and start the core
- Query: module list, single module state, array list (wildcard fetch)
- Manage: start a module, stop a module, restart a module, manual rescan, send an event, directed send

Configurable options of the core:

- Module directory, log file path, watching switch
- Polling interval, default module start timeout, shutdown deadline, in-memory log entry count
- Console output, process guard

## 10. Tech stack and engineering requirements

The language is TypeScript; the runtime is Node.js.

A large number of test cases must be built to validate the framework. Testing approach:

1. Analyze what the framework does
2. Analyze which software would use these features
3. Test by building that software

A user-controllable demo software should be provided to make the framework's behavior visible and operable.

## 11. Collaboration structure

- Dependencies between modules are established at runtime through events; modules are unaware of each other
- Collaboration between modules uses event signals and shared arrays
- Modules can still use any external channel such as files, network, and subprocesses
- A single minimal central file manages a large number of plugins

## 12. Notes

Chinese concept names in the requirements doc do not equal the identifiers actually used in code; implementation naming follows the code.
