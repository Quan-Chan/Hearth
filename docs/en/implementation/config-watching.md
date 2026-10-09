# Config Watching

## Polling

ConfigWatcher polls the module folder at a default interval of 200ms; the timer is unref'd and does not block process exit. The watch option disables polling; rescanModules triggers one scan manually.

## Change detection

Each round, every file is first compared by stat fingerprint (mtimeMs, size, ctimeMs); an unchanged fingerprint is skipped directly. Only when the fingerprint changes is the content read and sha1 computed; only when the hash changes is it parsed and callbacks fired. A touch that only changes the time of identical content does not trigger processing.

## Directory rules

Only two levels are collected: YAML files placed directly at the top level of the module folder, and YAML files placed directly inside one subfolder per module. node_modules and hidden directories are skipped. Collection order follows natural sort (like Windows Explorer): consecutive digits compare by numeric value (m2 comes before m10), non-digit segments compare lexicographically (case-sensitive, uppercase first, e.g. Greeter before greeter). Case sensitivity guarantees no ties, so the load order is fully deterministic. In the subfolder layout, order is by folder name; in the flat layout, order is by file name including extension; the subfolder layout is recommended.

## Fault tolerance

- YAML that fails to parse: record error, do not update the fingerprint, retry next round
- Files rejected for registration (same-name conflict): not recorded, re-requested every round, stay visible until the problem is fixed
- Same-name modules: module names are globally unique, the first registrant is kept

## Hot effect

A config update only reloads the YAML itself:

- Updates module registration and forwarding tables (startEvents/listen changes take effect immediately)
- Running modules: the ctx.config reference is refreshed, the instance and code are untouched
- Config sets enabled to false: the running module is stopped

Code reload is initiated by the module itself (requestReload); a config update does not reload code.

## Renaming

When the name inside an existing YAML file changes, it is handled as one removal followed by one registration: the old name fires onRemove (the old instance is stopped and its status and shared objects are unregistered), and the new name is registered through onLoad, so the new instance starts when its start condition is next met. The module name is a global identity: the slot table, the forwarding tables, and shared object names are all indexed by it, so a rename does not keep the running instance.

When the target name is already taken by another file, the removal does not happen: the file's new name is rejected by the consumer (duplicate names are not allowed), the old name keeps its instance running, and one rejection error is logged each round until the conflict is fixed.
