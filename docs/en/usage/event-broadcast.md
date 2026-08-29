# Event Broadcast

Events are the main channel for cooperation between modules: emitted in one place, responded to in many.

## Event Object

An event consists of two fields:

- name: the full event name, two segments: source:event-name
- data: event content, optional, written by the emitter

## Two-Segment Event Name

The source segment is assembled automatically by the core:

- Module emission: module name
- Core-generated: core
- Direct host call: external

Modules only write the event name segment (the first argument of sendEvent) and cannot forge the source segment.

## Sending

\`\`\`js
ctx.sendEvent('greet', { name: 'world' });
\`\`\`

Events are fire-and-forget: no queueing, no retry.

## Reception Declaration

Modules declare reception in YAML:

- startEvents: the core starts the module when the event occurs (start signal)
- listen: the core forwards the event to the module when it occurs (work instruction)

The same event is a start signal for a non-running module and a work instruction for a running module.

## Wildcards

Patterns support * (any sequence of characters) and ? (a single character). To respond to an event with the same name from any source:

\`\`\`yaml
listen:
  - "*:greet"
\`\`\`

## Receiving

\`\`\`js
onEvent(ctx, event) {
  // event.name = full event name, event.data = content
  ctx.log('received', event.name);
}
\`\`\`

Listeners receive events one by one in load order; a single module's handling failure does not affect other modules. Each listener receives an independent deep copy of data: modifying one's own copy does not affect other listeners. data carries information only; mutable shared data belongs in shared arrays.

## Event Dropping

Events with no listeners are logged as event-drop.