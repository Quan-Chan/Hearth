# Usage Guide

This document describes all features Hearth provides to module writers and host integrators.

## What Is a Module

A module is a combination of YAML configuration and a program file:

- YAML declares the module name, program file path, start events, and listen events
- The program file exports an object containing four optional hooks

The core continuously watches the module folder. YAML additions, modifications, and deletions take effect immediately, without a restart.

## Three Channels

- Event broadcast: an event name plus optional data, sent to all modules that declared reception
- Directed message: send content to a specified target; the target is validated by the core
- Shared array: map an array object to a name; other modules pull it by name or pattern

## Two Naming Conventions

Event names use two segments: source:event-name. The source segment is assembled automatically by the core (module name when a module emits, core for core-generated events, external for host calls); modules only write the event name segment. Matching uses the full event name; to respond to an event with the same name from any source, use a wildcard such as *:greet.

Array names use three segments: public:module-name:array-name. When exposing and unexposing, modules only provide the third segment (the array name); the first two segments are assembled automatically.

## Quick Start

A module consists of two files: YAML declares name, file, startEvents, and listen; the program file exports four optional hooks. Complete examples are in Module Config, Module Program, and Event Broadcast. When the core starts, it emits core:startup, and modules that declared listening for this event start automatically.

## Document Navigation

- Module Config: docs/en/usage/module-config.md
- Module Program and Context Methods: docs/en/usage/module-program.md
- Event Broadcast: docs/en/usage/event-broadcast.md
- Directed Message: docs/en/usage/directed-message.md
- Shared Arrays: docs/en/usage/shared-arrays.md
- Restart and Status: docs/en/usage/restart-and-status.md
- Logs and CLI: docs/en/usage/logs-and-cli.md
- Host Integration: docs/en/usage/host-integration.md