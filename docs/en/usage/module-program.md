# Module Program and Context Methods

## Program File Forms

The program file supports three forms, all normalized to the same object:

\`\`\`js
// CJS exports the object directly
module.exports = {
  start(ctx) {},
  stop(ctx) {},
  onEvent(ctx, event) {},
  onMessage(ctx, message) {},
};
\`\`\`

\`\`\`js
// ESM default export
export default {
  start(ctx) {},
  onEvent(ctx, event) {},
};
\`\`\`

\`\`\`js
// Factory function returning an object (re-evaluated on each startup reload)
module.exports = function () {
  return { start(ctx) {} };
};
\`\`\`

The module name is not written in the program; the only source is the name in YAML. Each time the module starts, the core reloads the program file from disk.

## Four Hooks

| Hook | Invocation Timing | Description |
| --- | --- | --- |
| start(ctx) | Called once when the module starts | Perform initialization, expose arrays, subscribe to resources |
| stop(ctx) | Called when the module stops | Return means already closed; async cleanup must finish before returning; if not implemented, the module is treated as closed immediately |
| onEvent(ctx, event) | Called when the module receives an event | If not implemented, the module receives no events |
| onMessage(ctx, message) | Called when the module receives a directed message | If not implemented, the module receives no directed messages |

All hooks are optional. A single hook throwing an error only logs it and does not affect other modules.

## Context Methods

ctx is the operation entry the core provides to modules.

| Member | Description |
| --- | --- |
| moduleName | Module name |
| config | Current config, including all YAML fields; refreshes automatically after a hot update |
| sendEvent(name, data?) | Produce an event; the source segment is automatically the module name |
| sendTo(target, data?) | Send a directed message; returns whether delivery succeeded |
| exposeArray(name, items?) | Expose an array; name is the third segment, the first two segments are assembled automatically |
| array(pattern) | Pattern-based pull: without wildcards, returns the array reference; with wildcards, returns a mapping of full array name to reference |
| unexposeArray(name) | Unexpose your own array |
| requestReload() | Validate new code and restart itself; on validation failure the old instance keeps running and it returns false |
| log(...parts) | Write a module log entry of type module-log |

## Array Name Short-Name Rules

Within a module, the forms of array(pattern):

- Full name (public:module-name:array-name): pulled directly
- Third-segment short name: the first two segments are completed automatically with the module's own name (pull your own array)
- With wildcards: matched against the full name, returns a mapping

Pulling another module's array requires the full name or a wildcard pattern.
