# Event Dispatch

## Two-segment event names

An event object has two fields: name (the full event name) and data (the content). The full event name = source:event-name-segment; the source segment is assembled by the core in dispatch according to the caller:

- Emitted by a module: the module name (ModuleContext.sendEvent passes moduleName)
- Produced by the core itself: core
- Called directly by the host: external (the source parameter of sendEvent)

A module cannot forge the source segment: the source segment of the module channel is fixed to the module's own name.

## Matching index

Start conditions are stored in startIndex, listen conditions in listenIndex. The two indexes have the same structure, made of two concepts:

- Exact table: conditions without wildcards, hit when event names are equal, string comparison, zero regex, O(1)
- Wildcard list: conditions with wildcards, compared one by one against the event with regex when it arrives

On rebuild, all conditions are traversed: those without * and ? go into the exact table, those with wildcards are compiled into the wildcard list (reusing the pattern compilation cache).

Module start/stop does not touch the indexes; a full rebuild happens on config change.

The index decides which conditions are tested first; how a condition matches is defined separately by EventMatcher's wildcard rules. The two are independent.

## Simplified record

The index previously consisted of five concepts: exact table, prefix bucket, global bucket, overflow table, byte budget. This simplification:

- Prefix bucket and global bucket: an optimization that bucketed by first literal to test fewer conditions; after removal, wildcard conditions are compared one by one
- Overflow table and byte budget: the degradation path after the budget was exhausted and its parameter chain (option, accounting, floor, statistics, adjustment instructions), deleted entirely
- Retained: O(1) exact condition hits, pattern compilation cache, the two indexes, rebuild on config change

The worst case (many wildcard conditions tested one by one) is on par with the original overflow path, and is now deterministic behavior rather than a branch taken after the budget is exhausted.

## Dispatch order

Steps of dispatch:

1. Assemble the full event name
2. Modules hit by startIndex that are not running and are enabled are started one by one in load order (starts are awaited serially)
3. Modules hit by listenIndex that are running and implement onEvent are delivered one by one
4. If no module matches, record event-drop

The same event has two roles: a start signal for modules not running, a work instruction for running modules.

## Directed delivery variants

sendDirected delivers the event directly to the specified targets: the target does not need to declare listening, no start comparison, no index routing. When targets is null, it broadcasts to all running modules that implement onEvent. The event name is assembled as two segments the same way. The CLI send instruction calls it.

## Failure isolation

deliverTo awaits each delivery one by one; when a single module's onEvent throws, only an error log is recorded and the rest are still delivered.
