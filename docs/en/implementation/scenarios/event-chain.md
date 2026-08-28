# Scenario: Event chain forwarding

After receiving an event, a module produces a new event; the new event again goes through the full comparison, forming chain collaboration.

## Flow

1. Module A receives chat:receive and calls sendEvent('chat:command') in onEvent.
2. The core prepends the source segment to the event name by caller (A:event-name segment).
3. dispatch: on a startIndex hit, start not-running modules first; deliver to running modules matched by listenIndex one by one. Log event, including the forwarding list.
4. Delivery order is load order, each awaited to completion; a single throwing point only logs error, delivery continues to the rest.
5. A listening module produces new events again, completed depth-first within the same await chain.
6. When sendEvent returns, the whole chain has completed.

## Boundaries

- Delivery is serial without timeout: one hanging onEvent blocks all subsequent listeners and the caller (see known issue 6).
- No recursion depth protection: listening to events one produces itself overflows the stack.
- Startup blocks forwarding: start never returns, events are not delivered and not logged (see known issue 2).
- Event drops do not distinguish declared-by-no-one from not-running and not-implemented.
- Failures do not trip a circuit breaker and side effects are not rolled back; the next occurrence of the same event retries and reports again.
- The event log being produced first does not mean delivery succeeded.
- Exceptions from un-awaited derived events become unhandled rejections (see known issue 7).
- Modules sending events during shutdown throw (see known issue 5).
