# Scenario: Shared array

A module exposes an array; other modules fetch the same object reference, modify it directly, and the content is immediately visible to all holders.

## Flow

1. Module A calls exposeArray('items', [...]) in start; the core assembles the three-segment full name public:A:items, maps the array object, records the owner as A, stores the reference without copying.
2. Module B calls array('public:A:items') by full name or wildcard (or array('public:A:*') for the mapping), gets the same object reference, and modifies it.
3. Any reader sees the change immediately; a second fetch always yields the same object.
4. The core stops module A:
   - After stop() returns, status is set to stopped
   - removeOwner unregisters all of A's mappings
   - Log module-stop with the cleanup list
5. After this, array('public:A:items') throws "public array does not exist"; consumers holding the old reference can still write, invisible to the core.
6. A starts again: exposeArray exposes a brand-new array object, no stale data remains.

## Boundaries

- Writes after unregistration are not seen by the core, with no log at all; the data is permanently gone after restart (see known issue 12).
- No snapshot of live references: any holder changes what everyone sees at any time; readers must copy on their own.
- Array names cannot be renamed: renaming equals unregister then expose.
- Duplicate names throw: re-exposing by the same owner also throws; re-exposing in start makes the module failed (see known issue 14).
- A consumer's fetch error is isolated by delivery into one error log.
- The owner parameter of core-layer APIs can be impersonated by code holding a core handle; the module-context layer forces the module name.
- exposeArray executed after an await by a canceled started module leaves a residual mapping.
- No array-level audit: who wrote what and when cannot be traced.
- Content grows unboundedly and is not persisted (see known issue 13).
