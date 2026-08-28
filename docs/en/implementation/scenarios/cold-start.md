# Scenario: Cold start

The host calls startCore(options), or createCore followed by start(); the core scans the module directory, broadcasts core:startup, and modules matched by startEvents start one by one.

## Flow

1. Construct the core, resolve option defaults, create the log.
2. start() sets the started flag, installs the process guard when guardProcess is enabled, logs core-start.
3. ConfigWatcher scans the module directory for the first time: collects YAML from two levels in alphabetical order, registers each, rebuilds both indexes, logs config-load. Duplicate names are rejected and logged as error.
4. Broadcast core:startup: matched not-running modules start one by one in load order.
5. Each module starts:
   - Set starting, load the program from disk, construct the context
   - Wait for start() to return
   - Success: set running, log module-start
   - Failure: set failed, log error
6. When no one listens to core:startup, log event-drop.
7. startCore returns the started core.

## Boundaries

- Calling start() again throws.
- Calling send interfaces while the core is not started or is shutting down throws.
- Module startup failure is silent to the caller; only the log shows it.
- Startup timeout only gives up waiting: the function runs dangling, auto-retry deadlocks (see known issue 3).
- Bad YAML and duplicate names produce one error log per round.
- YAML outside the layered directories silently does not come online.
- Startup is serial, in alphabetical order; a slow start delays the rest.
- Shutdown can only void the result of an in-progress startup; the side effects of the startup function still occur.
- The source segment can be spoofed by callers holding a core handle (the core layer can pass the source explicitly); module channels cannot (see known issues 8, 20).
