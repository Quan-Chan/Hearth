# Failure Handling and Guarding

## Hook call-point isolation

The four hook call points (start, stop, onEvent, onMessage) each catch exceptions independently:

- start throws: module set to failed, error recorded, event dispatch not interrupted
- onEvent throws: error recorded, remaining listeners still delivered
- stop throws: error recorded, module still treated as closed
- onMessage throws: error recorded, the delivery receipt is still true

## Process guard

When guardProcess (disabled by default) is enabled:

- Registers global handlers for unhandledRejection and uncaughtException
- After capture, writes to the error logs of all enabled cores; the process does not exit
- Installed once, shared by multiple enabled cores

When it is not enabled, unhandled async failures inside modules kill the process per Node's default behavior.

## Shutdown freeze

Once stoppingFlag is set: external events, directed messages, and config changes are all rejected; during shutdown, module calls to the send interfaces throw a "Hearth is stopping" error. The file surface is frozen by watcher.stop(), preventing new config from being loaded mid-shutdown.