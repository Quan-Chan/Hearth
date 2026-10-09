# Scenario: Failure isolation and process guard

How module hook errors and private unhandled failures of modules are each handled.

## Flow

1. A module's start() throws: set failed, write the error field, log error, do not propagate upward, event dispatch continues.
2. A module's onEvent throws: log error, continue delivering to the remaining listeners.
3. A module's stop() throws: log error, still set stopped and unregister objects.
4. An async operation initiated privately by a module fails and no one catches it: the process exits when guardProcess is off; when on, it is caught and an error log is written, the process continues.
5. Query afterwards via getModule()'s status and error fields, and log.byType('error'); a failed module recovers via manual start or a config update.

## Boundaries

- Startup failure is silent to the caller; only the log can be checked (see known issue 2).
- A failed module is retried for startup by every matching event, one error per failure, no backoff.
- A throw in the middle of start leaves an orphan object: failed is not in the stop cleanup scope, and config removal does not clean it either.
- Event dispatch is blocked by the startup step: if start never returns, listeners of that event receive nothing (see known issues 2, 6).
- A throwing stop is treated as closed; the data has already disappeared with its owner.
- stop never returning splits state from fact: the state stays running while the log is already closed (see known issue 4).
- Events sent by a module during shutdown throw and escape as process-level failures (see known issue 5).
- With guardProcess off by default, unhandled async failures kill the process (see known issue 7).
- After guardProcess is enabled the process keeps running; the host weighs the tradeoff.
- The guard core only grows, never shrinks: escaped failures after shutdown still write logs (see known issues 10, 11).
