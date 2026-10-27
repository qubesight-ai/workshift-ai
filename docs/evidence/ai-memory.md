# WORKSHIFT AI — Nightshift and Meterless H-MEM evidence

## Nightshift inference

A real inference was performed through the Nightshift Meterless Runtime
using the `meterless/text` model.

Test scenario:
- Occupation: Chief Executives
- SOC code: 11-1011.00
- Action: Analyze with AI
- Result: Four analysis sections generated.
- Citation validation: References checked against the local SQLite evidence graph.
- UI confirmation: "Nightshift memory saved".

This was a manual integration test, not a recorded HTTP transcript.
The analysis contains AI-generated hypotheses, not independently verified
claims about labor-market outcomes.

## Meterless H-MEM

Integration: official Meterless H-MEM reference implementation.

Automated verification:
- Official upstream H-MEM tests: 10 passed.
- WORKSHIFT AI application tests: 35 passed at the time of integration.

Manual integration verification:
1. Generate an analysis using Nightshift.
2. Save the validated analysis through H-MEM.
3. Retrieve the prior analysis from the dashboard.
4. Refresh the browser.
5. Re-select Chief Executives and retrieve the saved analysis again.

Observed result: one prior analysis was retrieved without generating
another AI response.

## Disk persistence

Inspection on October 27, 2026:
- Two occupation-scoped storage directories.
- One populated state.json: 16,857 bytes.
- One ledger.jsonl: 14,832 bytes.
- Three persisted ledger events.
- One additional state.json: 32 bytes.

## Limitations

The vendored H-MEM reference uses deterministic mock embeddings.
It is not a production semantic embedding service.

The application validates that AI-generated citation identifiers exist
in its SQLite evidence graph; this does not independently prove every
AI-generated interpretation.

No API tokens, raw memory contents, or private runtime credentials
are included in this evidence document.
