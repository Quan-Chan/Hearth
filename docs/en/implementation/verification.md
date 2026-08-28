# Verification

## Test structure

- tests/unit: component tests (event matching, matching index, config parsing, module loading, array registry, log format, log storage)
- tests/integration: behavior tests (config watching, directed messages, shared arrays, CLI instructions, restart, shutdown, lifecycle, same-name rejection)
- tests/apps: end-to-end application forms (chat bot, task scheduler, smart home, monitoring alerts)
- tests/fixtures: application fixture modules

Run:

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:apps
```

## Doc checks

npm run docs:check runs two checks:

- Fact cross-check: asserts that every fact has corresponding content on both the owning doc side and the source side
- Cross-doc duplication: alerts on paragraphs with identical sentences across docs

The fact list and source locations are in the FACTS table of scripts/verify-docs.mjs.

## Scenario mapping

Behavioral scenarios (cold start, event chain, dynamic forwarding, request reload, shutdown, shared arrays, failure isolation, CLI protocol) are anchored by tests; see the references in the tests directory and docs/en/implementation/known-issues.md.
