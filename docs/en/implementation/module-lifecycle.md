# Module Lifecycle

## State machine

Module state has four values: stopped, starting, running, failed.

Start time and failure reason are not stored in the state: module-start and error logs carry timestamps and details.

## Start flow

Steps of startModuleCore:

1. Pre-checks: already running, starting, disabled, timeout-locked each record module-skip
2. startSeq generation incremented, state set to starting
3. Load the program file from disk (reloaded on every start)
4. Construct ModuleContext, wait for start() to return
5. Success: set running, record module-start
6. Throws: set failed, record error

## Start protections

Three mechanisms handle races of async starts:

- Start generation (startSeq): stop and config update increment the generation; after start completes, if the generation changed, the result is voided (running state not written, stop called to reclaim), and the attempt releases the start lock and settles the state to stopped — prevents a stale result from reviving a stopped module, and leaves no slot in starting
- A config update rewrites the slot object in place instead of replacing it: an in-flight start holds that same slot, so the generation bump and the state settling both reach it
- Start attempt lock (inflightStart): only one start attempt per module at a time, prevents repeated pulls when events arrive densely
- Start timeout and auto-retry lock (startTimedOut): on timeout only the wait is abandoned (JS cannot terminate a function), marked failed and locked; unlocked by five paths — manual, CLI, config load, config update, restart — prevents dangling calls from accumulating

## Restart

Flow of requestReload / reloadModule:

1. Load and validate the new code (file exists, load with cleared cache, ESM dynamic import, factory evaluation, export must be an object)
2. Validation fails: record error, old instance keeps running, return false
3. Validation passes: stop the old instance (objects unregistered), start the new instance with the validated def, without reloading again
4. Returns whether the new instance is running: false when the start is skipped (shutting down, starting, disabled, timeout lock) or the new instance fails to start

## Shutdown protocol

Flow of core.stop():

1. Set stoppingFlag, freeze the event surface (external events, directed messages, config changes all rejected)
2. Stop the config watcher, freeze the file surface
3. Void the starts of starting modules (generation incremented, set stopped, unregister objects)
4. Run shutdown of running modules in parallel: call stop(), return means closed, throw only records error
5. Wait for all to return; past stopTimeoutMs force close and name the module in the error log
6. Unregister the core's own objects, reset flags, record core-stop, close the log file

Shutdown no longer broadcasts a shutdown signal event: the only entry point to stop is the stop hook, modules implement their own cleanup logic.
