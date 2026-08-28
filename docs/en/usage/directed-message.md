# Directed Message

A directed message is a point-to-point channel: specify a target and send content, passing through the core. Differences from events: no event name, no pattern matching, and no entry into shared arrays.

## Sending

\`\`\`js
const ok = await ctx.sendTo('worker', { task: 'build' });
\`\`\`

Returns whether delivery succeeded:

- true: the target exists, is running, implements onMessage, and the message was delivered
- false: the target does not exist, is not running, or does not implement onMessage

Delivery does not mean successful processing: when the target's handler throws, it still returns true; the error only goes into the log.

## Receiving

\`\`\`js
onMessage(ctx, message) {
  // message.source = sender module name
  // message.data = content
}
\`\`\`

Explicit subscription: modules that do not implement onMessage receive no directed messages.

## Request-Reply

The responder replies directly to the initiator with sendTo:

\`\`\`js
onMessage(ctx, message) {
  ctx.sendTo(message.source, { result: 'done' });
}
\`\`\`

Multiple requesters do not interfere with each other.

## Core Addressing

When the target is core, the core interprets the message as a management instruction, executes it, and returns the result directly to the initiator:

\`\`\`js
ctx.sendTo('core', { cmd: 'state' });
\`\`\`

Instructions and parameters are described in the Logs and CLI document (docs/en/usage/logs-and-cli.md).
