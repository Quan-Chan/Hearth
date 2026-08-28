# Logging

## Entry structure

Each log entry has a three-field main structure: type, source, message, plus arbitrary structured additional fields (event, data, recipients, reason, error, file, removedArrays, command).

## Two-tier storage

- In-memory window: keeps the most recent maxLogMemoryEntries entries (default 20000), evicts the oldest beyond that, serves in-process queries (all, byType, byCategory)
- On disk: JSONL append stream, content complete and not truncated

Disk write failures are silent and do not affect the core main flow.

## Rotation

Files use the config path as the base name and split by day and size:

- File name: base-name.date.three-digit-sequence.log; the date is the UTC day of the entry's timestamp
- When a single file exceeds 128KB within the same day, the next entry goes into a new file; lines stay complete
- After a process restart, writing resumes on the current file of the day (append if not over the limit, open a new sequence if over)

## Presentation layer

The presentation layer truncates overlong fields to 2048 characters and annotates the original length; on-disk content is unaffected. When logToConsole is enabled, entries are output synchronously to the console in single-line format.

## Types and categories

15 types are grouped into 6 categories (core, event, module, config, log, error); filtering is equivalent to grepping the JSONL.
