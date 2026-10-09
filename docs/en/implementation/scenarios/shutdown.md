# Scenario: Shutdown protocol

The host calls core.stop() to shut down the whole software.

## Flow

1. Guard: not started or already shutting down returns directly; set the stoppingFlag.
2. Stop config watching, freeze the file side.
3. Iterate modules: skip stopped and failed; void the startup of starting ones (increment the generation, set stopped, unregister objects); generate shutdown tasks for running ones.
5. Shutdown tasks run in parallel: call stop(), return means closed, a throw only logs error; set stopped, unregister public objects, log module-stop.
6. Wait for all shutdown tasks to complete; force close past stopTimeoutMs and name the modules that did not return in the error log.
7. Unregister the core's own objects, reset the flag, log core-stop, close the log file.

## Boundaries

- A hanging module (stop never returns) cannot be terminated: the timeout only stops waiting, its state stays running, objects not unregistered (see known issue 4).
- The timeout boundary race may wrongly name a module that just returned.
- A stop hook throw is swallowed: the host cannot perceive the failure through the rejection of await stop(), only the log.
- Modules calling send interfaces during shutdown throw (see known issue 5).
- A single hanging module holds up the whole shutdown for 20 seconds by default (see known issue 4).
- The startup of a starting module is voided, reclaimed by the core afterwards.
- File changes within the shutdown window are silently swallowed, with no log.
- Closing the log file is not a hard seal: a hanging module returning afterwards reopens the stream and keeps writing.
- After shutdown, start() on the same instance does not clear the field; old slots remain.
