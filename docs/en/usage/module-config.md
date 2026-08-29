# Module Config

A module consists of a YAML configuration file and a program file. YAML declares the module identity, program location, and event relationships.

## Fields

| Field | Default | Description |
| --- | --- | --- |
| name | required | Module name, globally unique; also the source of the event source segment and the second segment of the array name; must not contain ":" |
| file | required | Program file path, relative to the directory containing the YAML; may point outside the module folder |
| startEvents | none | List of event patterns; the core starts the module when one of these events occurs |
| listen | none | List of event patterns; the core forwards events to the module when one of these events occurs |
| enabled | true | Whether the module is enabled; setting it to false while running stops the module |
| startTimeoutMs | none | Module start timeout in milliseconds; the core gives up waiting and marks failure when the limit is exceeded |
| config | none | Custom configuration, passed through to the module and read via ctx.config.config |

## Example

\`\`\`yaml
name: greeter
file: ./greeter.cjs
startEvents:
  - "core:startup"
listen:
  - "*:greet"
enabled: true
startTimeoutMs: 5000
config:
  threshold: 100
\`\`\`

## Event Patterns

The values of startEvents and listen are event name patterns and support wildcards:

- * matches any sequence of characters
- ? matches a single character
- Other characters match literally

Patterns match the full event name (source:event-name). To respond to an event with the same name from any source, write *:event-name.

## Configuration Hot Reload

- New YAML: the module is registered
- Content change: the config and forwarding table are updated; the running module instance and code stay unchanged; the module reads the new values via ctx.config
- File deletion: the module is stopped and removed
- YAML that fails to parse: logged, retried in the next round
- Duplicate module name: registration is rejected; the rejected file keeps requesting repeatedly

## Directory Rules

- Each module gets one subfolder; the folder contains the YAML and the program file
- YAML placed directly at the top level of the module directory is also supported
- Only these two levels are recognized; deeper directories are not recursed
- node_modules and hidden directories are skipped