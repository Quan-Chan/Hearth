# Hearth

[English](README.md) | [中文](README.zh.md)

[![CI](https://github.com/Quan-Chan/Hearth/actions/workflows/ci.yml/badge.svg)](https://github.com/Quan-Chan/Hearth/actions/workflows/ci.yml)

**Version 0.1.0 (pre-release)**

Hearth is an event-driven modular framework core running on Node.js, written in TypeScript.

The software consists of a core and modules. The core is responsible for:

- Starting modules
- Forwarding events between modules
- Providing shared data to modules

A module is a combination of a YAML config and a program file. The YAML declares the module name, program file path, start events, and listen events.

Modules collaborate through three channels:

- Event broadcast: pure string signals with optional payload
- Directed message: delivered directly to a specified module
- Shared object: references to exposed objects, readable and modifiable by any module

## Quick Start

Install and build:

```bash
npm install
npm run build
```

Start from the command line (reads `hearth.yaml` from the root):

```bash
npm start
```

For programmatic startup and core options, see the usage docs (`docs/en/usage/host-integration.md`).

When the core starts, it emits a `core:startup` event; modules declaring it as a start event start automatically. YAML configs in the module folder are watched continuously; additions, modifications, and removals take effect immediately. A module consists of a YAML and a program file; see the usage docs for examples.

## Documentation

- Usage docs (module authoring and host integration): `docs/en/usage/`
- Implementation docs (internals and known issues): `docs/en/implementation/`