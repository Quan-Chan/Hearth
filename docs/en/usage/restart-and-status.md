# Restart and Status

## Module Restart

A module can request restarting itself after replacing the program file:

\`\`\`js
await ctx.requestReload();
\`\`\`

Process:

1. The core validates that the new code can be loaded
2. Validation fails: the old instance keeps running, and requestReload returns false
3. Validation passes: the old instance is stopped (its exposed arrays are unregistered), a new instance starts with the validated code, and requestReload returns true

State saving and restoration are the module's responsibility; the core does not migrate any state.

## Module Status

Module status has four values:

| Status | Meaning |
| --- | --- |
| stopped | Stopped, not running |
| starting | The start function has not returned yet |
| running | Running |
| failed | Start failed |

Start time and failure reason are not stored in the status: module-start and error logs carry timestamps and details; check the logs.

## Start Timeout

After YAML declares startTimeoutMs, the core gives up waiting when the limit is exceeded, marks the module as failed, and the module is no longer automatically retried on events. The failed mark can be lifted by manual start, CLI instructions, config load, config update, and restart requests.
