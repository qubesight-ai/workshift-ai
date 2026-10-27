import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteWorldPersistence } from './world/sqlite.js';
import { JsonlTraceSink } from './world/trace.js';
import { ContextBuilderService, IngestPipelineService, WorldStoreService } from './world/services.js';
import { entityId } from './world/model.js';
import { fixtureRecords } from '../tests/fixtures/onet.js';
// Deliberately offline: no environment credentials loaded, no adapters invoked.
mkdirSync('artifacts', { recursive: true });
const dir = mkdtempSync(resolve('artifacts/fixture-demo-'));
const persistence = new SqliteWorldPersistence(`${dir}/world.sqlite`);
try {
  const store = new WorldStoreService(persistence), trace = new JsonlTraceSink(`${dir}/trace.jsonl`);
  const ingest = new IngestPipelineService(store, trace), context = new ContextBuilderService(store, trace);
  console.log(JSON.stringify({ mode: 'SYNTHETIC FIXTURE — OFFLINE', artifacts: dir, first: await ingest.ingest(fixtureRecords), repeated: await ingest.ingest(fixtureRecords), context: await context.build({ intent: 'Inspect fixture occupation', entityIds: [entityId('occupation', 'onet:fixture-occ-1')] }) }, null, 2));
} finally { persistence.close(); }
