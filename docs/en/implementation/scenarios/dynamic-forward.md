# Scenario: Dynamic forwarding

A module rewrites its own YAML in onEvent; listen changes, and the forwarding table updates in real time.

## Flow

1. The module rewrites its own YAML in onEvent, adding an entry to listen.
2. ConfigWatcher's next polling round: the stat fingerprint changes, read the content, the sha1 changes, parse, call the onUpdate callback.
3. The core updates the module's config reference (refreshConfig) and rebuilds the indexes, logging config-update.
4. The module instance and code remain unchanged.
5. The new listen takes effect immediately: new events are delivered according to the new forwarding table.

## Boundaries

- The perception window is at most one polling interval; within the window routing follows the old forwarding table, events are dropped and not redelivered.
- An invalid listen value (not a plain string) is silently set to empty; the module stops receiving events from then on, with no error reported.
- YAML syntax error: does not take effect this round, error logged every round (see known issue 15).
- Config updates do not restart; the stale config view copied by the module's internal closure is not updated.
- When content differs each round, full parsing and index rebuild run every round.
- Writes within the shutdown window do not take effect.
- Asserting immediately after writing reads the old value (polling latency).
- One bad read or a half-written file: the module stays on the old config and logs error every round; after the write completes, it takes effect per the new config (see known issues 15, 16).
