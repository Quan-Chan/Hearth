# Hearth Scenarios

Scenarios describe the actual sequences of behavior that occur while the software runs. Scenarios cover three areas: startup, forwarding, sharing.

- [Cold start](cold-start.md): the host calls startCore(), the software starts automatically by events
- [Event chain forwarding](event-chain.md): a module produces a new event after receiving one, forming a chain
- [Dynamic forwarding](dynamic-forward.md): a module rewrites the listen of its own YAML, the forwarding table changes in real time
- [Request reload](request-reload.md): a module requests a restart after replacing its code
- [Shutdown protocol](shutdown.md): the complete sequence of core.stop()
- [Shared object](shared-object.md): expose, fetch, modify, unregister
- [Failure isolation and process guard](failure-isolation.md): handling of hook errors and unhandled rejections
- [CLI command protocol](cli-protocol.md): two channels execute commands