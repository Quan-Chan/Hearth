# Scenario: Request reload

A module replaces its code file and calls requestReload(); the core validates the new code and restarts the module.

## Flow

1. The module replaces the code file and calls ctx.requestReload().
2. Pre-checks: unknown module or not started throws; shutting down, restarting, disabled log module-skip and return false.
3. Load and validate the new code; validation items:
   - File exists
   - Load with cache cleared
   - ESM dynamic import
   - Factory evaluation
   - The export must be an object
4. Validation fails: log error, the old instance keeps running, return false. The old instance's state, objects, and event reception all remain unchanged.
5. Validation passes: log module-restart, stop the old instance (stop() returning means closed), unregister its public objects, log module-stop.
6. Start the new instance with the validated code and return whether it is running.

## Boundaries

- Validation only covers loadability, it does not run start(): bad code whose start() throws passes validation, the old instance is already stopped, the new instance is failed, and reloadModule returns false.
- No timeout in the stop-old phase: a hanging stop() means requestReload never returns (see known issue 4).
- Public objects disappear in the window between stopping old and starting new; object() throws during it (see known issue 12).
- After reload the exposed object is new; old references are invalid.
- Validation failure pollutes the error field of the running module.
- The ESM and TS branches do not clear cache; a reload may not get the new code.
- The skip branch only records a module-skip log and also returns false, so the caller cannot tell which skip happened.
- Events can start the module during validation.
- Factory function side effects execute once in the validation phase.
