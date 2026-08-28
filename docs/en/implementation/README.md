# Implementation Documentation

This document describes how each Connect-Core feature is implemented. It is intended for maintainers.

## Core components

| Component | File | Responsibility |
| --- | --- | --- |
| ConnectCore | src/core/ConnectCore.ts | Core class: lifecycle, config hot-reload, array API, queries; delegates to the two below |
| ModuleManager | src/core/ModuleManager.ts | Module state machine: start/stop/restart/shutdown + slot table |
| EventDispatcher | src/core/EventDispatcher.ts | Event dispatch and directed channels: sendEvent/sendDirected/sendTo |
| MatchIndex | src/core/MatchIndex.ts | Event matching index: exact table + wildcard list |
| EventMatcher | src/core/EventMatcher.ts | Event name matching rules and regex compilation cache |
| ConfigWatcher | src/core/ConfigWatcher.ts | Module folder polling and YAML parsing |
| ArrayRegistry | src/core/ArrayRegistry.ts | Shared array registry (three-part names, matching pull) |
| EventStreamLog | src/core/EventStreamLog.ts | Two-tier log storage and rotation |
| CliProtocol | src/core/CliProtocol.ts | CLI directed instruction protocol |
| ModuleContext | src/core/ModuleContext.ts | Module context (ctx) |
| loadModule | src/module/loadModule.ts | Module program loader |

## Event flow path

The full path of sendEvent:

1. Validate startup state and shutdown freeze
2. Assemble the full event name (source:event-name-segment)
3. dispatch: modules hit by startIndex that are not running are started one by one
4. Modules hit by listenIndex that are running are delivered one by one; a single-point failure only records a log
5. If no module matches, record event-drop

## Requirement coverage mapping

Correspondence between the 12 chapters of the requirement document and the implementation, docs, and tests:

| Requirement chapter | Implementation | Usage doc | Implementation doc | Test |
| --- | --- | --- | --- | --- |
| 1 Software form | types/loadModule | Module Config / Module Program | module-lifecycle | unit |
| 2 Config hot-reload | ConfigWatcher | Module Config | config-watching | yaml-watcher |
| 3.1 Event broadcast | EventDispatcher | Event Broadcast | event-dispatch | core-lifecycle |
| 3.2 Directed messages | EventDispatcher | Directed Messages | event-dispatch | directed-message |
| 3.3 Shared arrays | ArrayRegistry | Shared Arrays | shared-arrays | array-registry/public-arrays |
| 4 Module lifecycle | ModuleManager | Restart and Status | module-lifecycle | core-lifecycle/module-reload |
| 5 Core lifecycle | ConnectCore | Host Integration Interface | scenarios cold-start/shutdown | boot/shutdown-ack |
| 6 Failure handling | ConnectCore | Module Program | failure-handling | core-lifecycle |
| 7 Logging | EventStreamLog | Logs and Command Line | logging | event-stream-log/log-format |
| 8 Command line | CliProtocol/cli | Logs and Command Line | cli-protocol | cli-commands |
| 9 Host integration | ConnectCore | Host Integration Interface | event-dispatch | usability |
| 10 Tech stack | tsconfig | — | verification | all |

## Measured performance

- Event matching (benchmarks/perf.js): exact table + wildcard list vs full comparison, about 9-11x speedup
  (MatchIndex 1.35-1.68 us/event, full comparison 15.4-15.5 us/event).
- Config polling: steady state only statSync (about 26 us/file); read + sha1 only when content changes (about 51 us/file).
- End-to-end dispatch measurement (100 listening modules): starting 100 modules 357ms; dispatching 500 events x 100 listeners
  = 50000 deliveries 27ms (0.05ms/event, 0.001ms/delivery); writing 5000 log entries 13ms (3us/entry).
  The dispatch chain overhead is negligible; the cost is in the modules' own processing and file I/O.

## Documentation navigation

- Event dispatch and matching index: docs/en/implementation/event-dispatch.md
- Module lifecycle: docs/en/implementation/module-lifecycle.md
- Config watching: docs/en/implementation/config-watching.md
- Shared arrays: docs/en/implementation/shared-arrays.md
- Logging: docs/en/implementation/logging.md
- CLI protocol: docs/en/implementation/cli-protocol.md
- Failure handling and guarding: docs/en/implementation/failure-handling.md
- Known issues: docs/en/implementation/known-issues.md
- Verification: docs/en/implementation/verification.md
