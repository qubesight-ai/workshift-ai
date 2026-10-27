import type { IngestRecord } from '../../src/world/model.js';
/** SYNTHETIC FIXTURE: not exported from Zetaris or validated O*NET data. */
export const fixtureRecords: IngestRecord[] = [
  {
    provenance: { kind: 'fixture', dataset: 'O*NET', version: '31.0', table: 'occupation_data', recordKey: 'fixture-occ-1', retrievedAt: '2026-10-23T00:00:00Z' },
    entities: [{ type: 'occupation', key: 'onet:fixture-occ-1', name: 'Fixture occupation', attributes: { description: 'Synthetic occupation for offline tests' } }], relationships: [],
  },
  {
    provenance: { kind: 'fixture', dataset: 'O*NET', version: '31.0', table: 'task_statements', recordKey: 'fixture-task-1', retrievedAt: '2026-10-23T00:00:00Z' },
    entities: [{ type: 'task', key: 'onet:fixture-task-1', name: 'Fixture task', attributes: { statement: 'Evaluate a synthetic process' } }],
    relationships: [{ from: { type: 'occupation', key: 'onet:fixture-occ-1' }, to: { type: 'task', key: 'onet:fixture-task-1' }, type: 'has_task' }],
  },
  {
    provenance: { kind: 'fixture', dataset: 'O*NET', version: '31.0', table: 'essential_skills', recordKey: 'fixture-occ-1:fixture-skill-1:IM', retrievedAt: '2026-10-23T00:00:00Z' },
    entities: [{ type: 'skill', key: 'onet:fixture-skill-1', name: 'Fixture skill', attributes: { description: 'Synthetic skill' } }],
    relationships: [{ from: { type: 'occupation', key: 'onet:fixture-occ-1' }, to: { type: 'skill', key: 'onet:fixture-skill-1' }, type: 'requires_skill', key: 'IM', attributes: { scale: 'IM', value: 3.5 } }],
  },
];
