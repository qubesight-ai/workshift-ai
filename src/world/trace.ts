import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export interface TraceEvent {
  runId: string; operation: 'ingest' | 'context'; status: 'appended' | 'duplicate' | 'rejected' | 'built';
  observationId?: string; entityCount?: number;
}
export interface TraceSink { write(event: TraceEvent): void }
export class JsonlTraceSink implements TraceSink {
  constructor(private readonly path: string) { mkdirSync(dirname(path), { recursive: true }); }
  write(event: TraceEvent): void {
    // Allowlisted metadata only: no headers, tokens, SQL, prompts or provider bodies.
    const { runId, operation, status, observationId, entityCount } = event;
    appendFileSync(this.path, `${JSON.stringify({ at: new Date().toISOString(), runId, operation, status, observationId, entityCount })}\n`, { mode: 0o600 });
  }
}
