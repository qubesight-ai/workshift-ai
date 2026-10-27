# WORKSHIFT AI — Real O*NET ingestion evidence

Dataset: O*NET 31.0

## Verified results

- Stored entities: 60
- Stored relationships: 40
- Ingestion trace events: 120
- Appended observations: 60
- Duplicate observations detected: 60
- Distinct ingestion run IDs: 6

## Entity distribution

- occupation: 20
- skill: 20
- task: 20

## Relationship distribution

- has_skill: 20
- has_task: 20

## Trace provenance

- First event (UTC): 2026-10-26T19:28:04.317Z
- Last event (UTC): 2026-10-26T19:28:33.198Z
- Source: local execution artifacts, not synthetic fixtures.
- Scope: ingestion and deduplication only. This report does not establish AI inference or H-MEM behavior.

## Sanitized trace sample

See `ingestion-trace-sample.jsonl`. Internal observation and run identifiers are omitted.
