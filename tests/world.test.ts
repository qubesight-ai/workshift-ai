import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteWorldPersistence } from '../src/world/sqlite.js';
import { ContextBuilderService, IngestPipelineService, WorldStoreService } from '../src/world/services.js';
import { canonical, entityId, type IngestRecord } from '../src/world/model.js';
import { JsonlTraceSink } from '../src/world/trace.js';
import { fixtureRecords } from './fixtures/onet.js';
function setup() {
  mkdirSync('artifacts/tests', { recursive: true });
  const dir = mkdtempSync(resolve('artifacts/tests/world-'));
  const persistence = new SqliteWorldPersistence(`${dir}/world.sqlite`);
  const store = new WorldStoreService(persistence);
  const trace = new JsonlTraceSink(`${dir}/trace.jsonl`);
  return { dir, persistence, store, ingest: new IngestPipelineService(store, trace), context: new ContextBuilderService(store, trace) };
}
const occupation = entityId('occupation', 'onet:fixture-occ-1');
test('stable identity canonicalizes JSON key order and normalizes external keys', () => {
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
  assert.equal(entityId('skill', ' café '), entityId('skill', 'cafe\u0301'));
  assert.notEqual(entityId('task', 'x'), entityId('skill', 'x'));
  assert.throws(() => canonical({ x: NaN }));
});
test('SQLite durable world: repeat ingestion is an empty diff, including fetch-time changes', async () => {
  const s = setup();
  try {
    assert.deepEqual(await s.ingest.ingest(fixtureRecords), { appended: 3, duplicates: 0, rejected: 0 });
    const before = await s.store.observations();
    assert.deepEqual(await s.ingest.ingest(fixtureRecords.map(r => ({ ...r, provenance: { ...r.provenance, retrievedAt: '2026-10-24T00:00:00Z' } }))), { appended: 0, duplicates: 3, rejected: 0 });
    assert.deepEqual(await s.store.observations(), before);
    assert.equal((await s.store.entities()).length, 3);
    assert.equal((await s.store.relationships()).length, 2);
    assert.equal((await s.store.entity(occupation))?.provenance.kind, 'fixture');
  } finally { s.persistence.close(); }
  const reopened = new SqliteWorldPersistence(`${s.dir}/world.sqlite`);
  try { assert.equal((await reopened.entities()).length, 3); assert.equal((await reopened.observations()).length, 3); }
  finally { reopened.close(); }
});
test('changed content appends history while preserving entity ID; views derive latest value', async () => {
  const s = setup();
  try {
    await s.ingest.ingest(fixtureRecords);
    const changed = structuredClone(fixtureRecords[0]!); changed.entities[0]!.name = 'Changed fixture';
    assert.equal((await s.ingest.ingest([changed])).appended, 1);
    assert.equal((await s.store.entity(occupation))?.name, 'Changed fixture');
    assert.equal((await s.store.observations()).length, 4);
    assert.equal((await s.ingest.ingest([changed])).duplicates, 1);
    assert.equal((await s.store.observations())[0]!.entities[0]!.name, 'Fixture occupation');
  } finally { s.persistence.close(); }
});
test('reprocessing a source record reconciles removed edges without deleting history', async () => {
  const s = setup();
  try {
    await s.ingest.ingest(fixtureRecords);
    const changed = structuredClone(fixtureRecords[1]!); changed.relationships = [];
    await s.ingest.ingest([changed]);
    assert.equal((await s.store.relationships()).length, 1);
    assert.equal((await s.store.observations())[1]!.relationships.length, 1);
    assert.equal((await s.store.entities()).length, 3);
  } finally { s.persistence.close(); }
});
test('parallel callers dedupe atomically', async () => {
  const s = setup();
  try {
    const results = await Promise.all([s.ingest.ingest([fixtureRecords[0]!]), s.ingest.ingest([fixtureRecords[0]!])]);
    assert.equal(results.reduce((n, r) => n + r.appended, 0), 1);
    assert.equal((await s.store.observations()).length, 1);
  } finally { s.persistence.close(); }
});
test('malformed provenance is rejected; later records proceed; orphan relation rolls back', async () => {
  const s = setup();
  try {
    const invalid = { ...fixtureRecords[0], provenance: undefined } as unknown as IngestRecord;
    assert.deepEqual(await s.ingest.ingest([invalid, fixtureRecords[0]!]), { appended: 1, duplicates: 0, rejected: 1 });
    const orphan = structuredClone(fixtureRecords[1]!); orphan.relationships[0]!.from.key = 'missing';
    await assert.rejects(s.ingest.ingest([orphan]), /endpoint missing/);
    assert.equal((await s.store.observations()).length, 1);
    assert.equal((await s.ingest.ingest([fixtureRecords[1]!])).appended, 1);
  } finally { s.persistence.close(); }
});
test('skill scales have distinct stable relationships', async () => {
  const s = setup();
  try {
    await s.ingest.ingest(fixtureRecords);
    const lv = structuredClone(fixtureRecords[2]!); lv.provenance.recordKey = 'fixture-occ-1:fixture-skill-1:LV'; lv.relationships[0]!.key = 'LV';
    await s.ingest.ingest([lv]);
    assert.equal((await s.store.relationships()).filter(e => e.type === 'requires_skill').length, 2);
  } finally { s.persistence.close(); }
});
test('context uses graph evidence with provenance and exact UTF-8 size budget', async () => {
  const s = setup();
  try {
    await s.ingest.ingest(fixtureRecords);
    const full = await s.context.build({ intent: 'Find relevant work', entityIds: [occupation] });
    assert.equal(full.entities.length, 3); assert.equal(full.relationships.length, 2); assert.equal(full.truncated, false);
    const bounded = await s.context.build({ intent: '職業', entityIds: [occupation], maxBytes: 900 });
    assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 900); assert.equal(bounded.truncated, true);
    assert.ok(bounded.relationships.every(e => bounded.entities.some(n => n.id === e.from) && bounded.entities.some(n => n.id === e.to)));
    const empty = await s.context.build({ intent: 'Unknown', entityIds: ['missing'] }); assert.equal(empty.entities.length, 0);
    await assert.rejects(s.context.build({ intent: 'x'.repeat(1000), entityIds: [], maxBytes: 256 }), /budget/);
    const lines = readFileSync(`${s.dir}/trace.jsonl`, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(lines.some(e => e.operation === 'context')); assert.ok(lines.every(e => e.at && e.runId));
    assert.ok(!readFileSync(`${s.dir}/trace.jsonl`, 'utf8').includes('Synthetic occupation'));
  } finally { s.persistence.close(); }
});
