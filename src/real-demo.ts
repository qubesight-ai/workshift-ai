import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkshift } from './app.js';
import { ONET_TABLES, type OnetTable, type SqlCell } from './adapters/zetaris.js';
import type { Attributes, EntityInput, IngestRecord } from './world/model.js';

// SELECT * order confirmed against the installed O*NET 31.0 CSV headers in
// /opt/zetaris/workshift-data/onet-31/db_31_0_csv/{table}.csv.
const widths: Record<OnetTable, number> = { occupation_data: 3, task_statements: 8, essential_skills: 15 };
function text(cell: SqlCell | undefined): string {
  if (typeof cell !== 'string' && typeof cell !== 'number') throw new Error('Missing O*NET identifier or text');
  const value = String(cell).trim();
  if (!value) throw new Error('Empty O*NET identifier or text');
  return value;
}
export function numeric(cell: SqlCell | undefined): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(cell.trim())) return null;
  const value = Number(cell.trim());
  return Number.isFinite(value) ? value : null;
}

export function createOnetMapper() {
  const occupations = new Map<string, EntityInput>();
  return (table: OnetTable, row: SqlCell[], retrievedAt: string): IngestRecord => {
    if (row.length !== widths[table]) throw new Error(`Unexpected ${table} column count`);
    const code = text(row[0]);
    if (!/^\d{2}-\d{4}\.\d{2}$/.test(code)) throw new Error('Invalid O*NET-SOC code');
    const occupation: EntityInput = table === 'occupation_data'
      ? { type: 'occupation', key: code, name: text(row[1]), attributes: { onetSocCode: code, description: text(row[2]) } }
      : occupations.get(code) ?? { type: 'occupation', key: code, name: text(row[1]), attributes: { onetSocCode: code } };
    occupations.set(code, occupation);
    const record: IngestRecord = {
      provenance: { kind: 'zetaris', dataset: 'O*NET', version: '31.0', table, recordKey: code, retrievedAt },
      entities: [occupation], relationships: [],
    };
    if (table === 'occupation_data') return record;
    let target: EntityInput;
    let attributes: Attributes;
    if (table === 'task_statements') {
      const taskId = text(row[2]);
      if (!/^\d+$/.test(taskId)) throw new Error('Invalid task ID');
      target = { type: 'task', key: taskId, name: text(row[3]), attributes: { taskId } };
      attributes = { taskType: row[4]!, incumbentsResponding: numeric(row[5]), date: row[6]!, domainSource: row[7]! };
      record.provenance.recordKey = `${code}:${taskId}`;
    } else {
      const elementId = text(row[2]), scale = text(row[4]);
      if (scale !== 'IM' && scale !== 'LV') throw new Error('Unsupported skill scale');
      target = { type: 'skill', key: `${elementId}:${scale}`, name: text(row[3]), attributes: { elementId, scale, scaleName: row[5]! } };
      // These are source ratings/statistics, never automation probabilities.
      attributes = { scale, dataValue: numeric(row[6]), n: numeric(row[7]), standardError: numeric(row[8]), lowerCiBound: numeric(row[9]), upperCiBound: numeric(row[10]), recommendSuppress: row[11]!, notRelevant: row[12]!, date: row[13]!, domainSource: row[14]! };
      record.provenance.recordKey = `${code}:${elementId}:${scale}`;
    }
    record.entities.push(target);
    record.relationships.push({ from: { type: 'occupation', key: code }, to: { type: target.type, key: target.key }, type: table === 'task_statements' ? 'has_task' : 'has_skill', attributes });
    return record;
  };
}

export async function runRealDemo() {
  const dir = resolve('artifacts/real-demo');
  mkdirSync(dir, { recursive: true });
  const app = createWorkshift({ ...process.env,
    ZETARIS_API_KEY: readFileSync('.secrets/zetaris-api-key', 'utf8').trim(), ZETARIS_ORG_ID: '1',
    WORLD_SQLITE_PATH: `${dir}/world.sqlite`, WORLD_TRACE_PATH: `${dir}/trace.jsonl`,
  });
  try {
    const map = createOnetMapper();
    const ingestions = [];
    for (const table of ONET_TABLES) {
      try {
        const result = await app.ingestZetarisPage(`SELECT * FROM WORKSHIFT_ONET.${table} LIMIT 20`, row => map(table, row, new Date().toISOString()));
        ingestions.push({ table, status: 'completed', ...result });
      } catch {
        // Never log provider errors, request headers, environment or secrets.
        ingestions.push({ table, status: 'failed', error: 'Read or mapping failed; verify connectivity and installed schema.' });
      }
    }
    const entities = await app.world.entities(), relationships = await app.world.relationships();
    const counts = (values: { type: string }[]) => Object.fromEntries([...new Set(values.map(v => v.type))].sort().map(type => [type, values.filter(v => v.type === type).length]));
    const summary = { dataset: 'O*NET', version: '31.0', retrievedAt: new Date().toISOString(), ingestions, entities: entities.length, entitiesByType: counts(entities), relationships: relationships.length, relationshipsByType: counts(relationships) };
    writeFileSync(`${dir}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
    if (ingestions.some(result => result.status === 'failed' || ('rejected' in result && result.rejected !== 0))) process.exitCode = 1;
    return summary;
  } finally { app.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runRealDemo().catch(() => { console.error('Real demo failed; verify local configuration.'); process.exitCode = 1; });
}
