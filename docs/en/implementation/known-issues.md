# Known Issues and Their Sources

## 1. Threading

### 1. Synchronous code in one module pauses all activity

Symptom:

- For every millisecond that a piece of synchronous code runs, all other modules, the core's event forwarding, config watching, and log flushing stop making progress
- Everything resumes automatically when the code finishes; no error or log is produced during the pause
- A 3-second synchronous loop in one module pauses all activity, including periodic activity, for about 3 seconds

Source:

- All modules and the core share the same thread; there is no thread-level isolation between modules
- As long as any piece of code does not yield the thread, no other code can run

## 2. Startup

### 2. When the start function never returns, the module can never enter the running state

Symptom:

- While the wait inside start() has not ended, the module state stays at "stopped" and does not become "running"
- When no start timeout is declared, the core waits indefinitely
- The event dispatch that triggered this start also hangs along with it, and the caller never gets its return
- Other modules already started through it are unaffected

Source:

- The core waits directly on the module's start function in the start path
- The "running" state is written only after the start function returns
- JS cannot terminate a function that is already running

### 3. A module with a configured start timeout is no longer auto-woken by events after one timeout

Symptom:

- A module that declares startTimeoutMs (or whose host configures a default timeout) does not finish starting within the limit; a module-start-timeout log is recorded and it is marked failed
- After that, even if its start event appears again, it is only skipped with a skip log, until a manual start or a config update

Source:

- After giving up waiting, the original start function is still running in the background, and JS cannot terminate it
- If events were allowed to retry repeatedly, each retry would pile up one more dangling call, so automatic retry is locked after a timeout

## 3. Shutdown

### 4. (Fixed) Shutdown used to be serial; it now waits in parallel with forced close on timeout

Symptom (old behavior):

- If any module's stop() did not return, the stops of the modules behind it, shared array cleanup, and log finalization all had to wait for it
- A module that deliberately waits 3 seconds dragged shutdown from milliseconds to 3 seconds

Fix:

- Shutdown now calls the stop() of all modules in parallel; total duration equals the slowest module
- The core waits for all to return "closed"; past stopTimeoutMs (default 20s) it forces close and names the module that did not return in the error log

Source (old behavior):

- The old shutdown sequence waited for each module's stop to finish one by one in reverse start order
- The wait now has a global cap and no longer hangs indefinitely

### 5. After the core begins shutting down, new events and directed messages throw errors

Symptom:

- Between the start and the end of stop(), a module or the host calling the send interfaces receives a "Hearth is stopping" exception
- Call points that do not catch this exception throw errors in a cluster during the shutdown phase

Source:

- The routing surface is frozen as a whole during shutdown, to close the races of a module being revived or new config being loaded mid-shutdown

## 4. Events

### 6. Listeners of the same event forward in a queue; those behind do not receive until the ones ahead return

Symptom:

- When the same event has multiple listeners, they are delivered one by one in load order
- While the handler of an earlier listener has not returned, the listeners behind it do not receive this event
- After the earlier one returns, the core continues delivering this event to the listeners behind (delayed catch-up); the delay equals the earlier handler's execution time
- If the earlier handler never returns, the listeners behind never receive this kind of event

Source:

- Event forwarding waits for each listener one by one in load order, so the delivery order is deterministic

### 7. An unhandled Promise rejection kills the whole process

Symptom:

- A module starts an async operation that fails, and nothing anywhere catches the failure; the whole process exits immediately (exit code 1)
- This record is not in the core's error log
- All other modules terminate together

Source:

- The core's error isolation only wraps the hooks it calls itself (event forwarding, start, stop, instruction execution, etc.)
- Async operations started privately by modules do not pass through these wrappers and fall straight into Node's default behavior for unhandled rejections
- The host can change the default behavior to log-only via the guardProcess option

### 8. (Fixed) Lifecycle events with the same name could be forged and trigger other modules' reactions

Symptom (old behavior):

- When module A emitted an event named core:startup, all stopped modules whose start condition used that name would be started again, and logic that used it as an initialization condition would run again, even if this happened mid-shutdown of the core

Fix:

- Event names are now two-segment (source:event-name); the source segment is assembled automatically by the core according to the caller
- For any event emitted by a module, the source segment is the module's own name, so the assembled result is no longer core:startup and cannot hit lifecycle events

Source (old behavior):

- In the old implementation, event matching compared only event names; the source did not participate in matching

### 9. Request-response style message chains can multiply exponentially

Symptom:

- When two modules answer each other and each answer spawns new requests, the message volume doubles by powers of two, and all of it is faithfully executed

Source:

- Event and directed message dispatch has no rate limit and no depth cap; every arriving message is fully processed

## 5. Logging

### 10. Writing very large data scales up log file and memory usage proportionally

Symptom:

- When a single log entry carries 512KB of data, that 512KB goes fully into the on-disk file and the in-memory copy
- The file hits the 128KB rotation line faster, and the same large chunk occupies the in-memory window too

Source:

- The storage layer does not truncate
- The in-memory window keeps the complete content of the most recent 20000 entries

### 11. High-frequency logging pushes earlier entries out of the in-memory window

Symptom:

- When the log frequency is higher than the eviction speed, the memory holds only the most recent 20000 entries; earlier records can only be found in the on-disk files

Source:

- The in-memory window has a fixed capacity; beyond it the oldest entries are evicted
- On-disk files are unaffected

## 6. Shared Arrays

### 12. When the owner stops or restarts, the array disappears by name immediately

Symptom:

- The moment the owner's stop() finishes executing, other callers of array(name) get an error
- Code that already holds a reference can still operate on the original array object; only new code can no longer find it by name
- Hot-reloading and restarting the owner goes through the same disappearance and recreation

Source:

- The array mapping's lifecycle is bound to the owner; when the owner disappears, the mapping is unregistered

### 13. Array content can grow without bound and is not persisted

Symptom:

- An array that only pushes and never cleans keeps consuming memory
- After the core shuts down or the owner stops, the content is lost directly

Source:

- Arrays are shared plain objects: no capacity limit, no on-disk mechanism

### 14. Management operations on another's array get an error

Symptom:

- Calling exposeArray or unexposeArray on a name that is not one's own public name throws an "already exists / does not exist / not permitted" style error
- Reading and writing content is not subject to this restriction

Source:

- Management operations validate the owner identity; only the owner can expose or unexpose

## 7. Config

### 15. After YAML goes bad, the same error repeats every round; the module stays on the old config until recovery

Symptom:

- When an existing module's YAML becomes unparseable (emptied, truncated, malformed), the module keeps running with the last successfully parsed config
- After that, every scan round (default 200ms) rereads this bad file and records the same error again, until the file recovers
- After recovery, the module hot-updates per the new config (index refreshed immediately, instance untouched)

Source:

- A file that failed to parse does not update its fingerprint, so the next round keeps retrying
- A module slot is removed only when the file is deleted; a parse failure does not trigger removal

### 16. Directly overwriting YAML has a window where half a file can be read

Symptom:

- When updating config with a one-shot overwrite, the watcher may read the disk at the moment the write is half done and read a truncated fragment
- The consequence is the same as the previous item: error and retry, the old config applies, until the write finishes and parses successfully

Source:

- The watcher reads the current bytes on disk at fixed intervals and is unaware of any write process

### 17. (Fixed) A config change used to restart the module; it now hot-takes-effect at the YAML layer

Symptom (old behavior):

- Even changing one comment line made the module go through a full stop, program reload, and restart
- All state accumulated in the module's variables was lost

Fix:

- A YAML update only reloads the YAML itself (config, listen declarations, matching index); the running module instance and code are untouched
- The module reads the new config via ctx.config and decides on its own when to apply it
- Code reload is initiated by the module itself (ctx.requestReload)

Source (old behavior):

- Deleting the require cache, reloading the program, and rerunning the whole lifecycle

## 8. Directed Messages

### 18. sendTo returning true does not mean the other side handled it successfully

Symptom:

- It returns true as soon as the other side exists and implements the receiving interface, even if the other side's handler throws on the spot
- The caller cannot distinguish "handled successfully" from "the other side failed to handle" from the return value; the latter only goes into the error log

Source:

- The delivery rule is defined as "delivered when a receivable side exists"; the processing result is not returned to the caller

### 19. A module that forgets to implement onMessage receives no directed messages, with no hint at all

Symptom:

- The sender gets a return value of false; apart from that there is no other signal that the target did not receive because it did not implement the interface

Source:

- Directed messages use an explicit subscription design: not implementing onMessage is treated as not subscribing

## 9. Process Boundary

### 20. There is no permission control between modules

Symptom:

- Any module can issue management instructions to the core: start or stop other modules, generate arbitrary events
- Any module can read and write the content of all shared arrays

Source:

- The trust model is "installed means trusted": the management surface is open to all modules
- All code runs in the same process, so permission checks cannot be enforced