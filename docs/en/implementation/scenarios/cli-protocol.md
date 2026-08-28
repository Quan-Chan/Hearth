# Scenario: CLI command protocol

The cli module sends commands to the core through the directed channel; the core executes them and returns the results through directed messages.

## Flow

1. CLI parses a terminal line and calls sendTo('core', { cmd, args }).
2. The core intercepts directed messages targeted at core and executes them through the command dispatch table (event, start, stop, send, state), logging cli-command.
3. The result { cmd, ok, result, error } is returned directly to the initiator via sendTo.
4. After receiving, onMessage prints by cmd branch; exit or quit acknowledges first, then stops the core.

## Boundaries

- The stop command makes the module array disappear immediately; holders of references throw.
- The directed return depends on the initiator running and having onMessage: commands from external processes receive no result.
- When the module started by the start command fails, ok is still true; the error must be looked up separately via state.
- send succeeds silently for invalid targets: ok is true but there is no recipient.
- Array names have no owner validation; any module can inject commands (see known issue 20).
