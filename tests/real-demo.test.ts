import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkshift } from '../src/app.js';
import { createOnetMapper, numeric } from '../src/real-demo.js';
import { ONET_TABLES, type SqlCell } from '../src/adapters/zetaris.js';
import { jsonResponse } from './fixtures/http.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('real demo mapping: synthetic pages preserve identities, ratings and deduplicate replays', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'workshift-real-test-'));
  const rows: SqlCell[][][] = [
    [['11-1011.00', 'Synthetic executives', 'Synthetic description']],
    [['11-1011.00', 'Synthetic executives', '8823', 'Synthetic task', 'Core', '95', '08/2023', 'Incumbent']],
    ['IM', 'LV'].map(scale => ['11-1011.00', 'Synthetic executives', '2.A.1.a', 'Reading', scale, scale === 'IM' ? 'Importance' : 'Level', '4.12', '8', 'bad', '', 'Infinity', 'N', '', '08/2023', 'Analyst']),
  ];
  let requests = 0;
  const app = createWorkshift({ WORLD_SQLITE_PATH: ':memory:', WORLD_TRACE_PATH: join(dir, 'trace.jsonl'), ZETARIS_API_KEY: 'synthetic', ZETARIS_ORG_ID: '1' }, { fetch: async (_url, init) => {
    const index = requests++ % 3;
    assert.equal(JSON.parse(String(init?.body)).sql, `SELECT * FROM WORKSHIFT_ONET.${ONET_TABLES[index]} LIMIT 20`);
    return jsonResponse({ data: rows[index] });
  } });
  try {
    for (let replay = 0; replay < 2; replay++) {
      const mapper = createOnetMapper();
      for (const table of ONET_TABLES) {
        const result = await app.ingestZetarisPage(`SELECT * FROM WORKSHIFT_ONET.${table} LIMIT 20`, row => mapper(table, row, `2026-10-${26 + replay}T00:00:00.000Z`));
        assert.deepEqual(result, { appended: replay ? 0 : table === 'essential_skills' ? 2 : 1, duplicates: replay ? table === 'essential_skills' ? 2 : 1 : 0, rejected: 0 });
      }
    }
    const entities = await app.world.entities(), edges = await app.world.relationships();
    assert.equal(entities.length, 4);
    assert.deepEqual(entities.filter(e => e.type === 'skill').map(e => e.key).sort(), ['2.A.1.a:IM', '2.A.1.a:LV']);
    const occupation = entities.find(e => e.type === 'occupation')!;
    assert.equal(occupation.key, '11-1011.00');
    assert.equal(occupation.attributes.description, 'Synthetic description');
    assert.equal(entities.find(e => e.type === 'task')!.key, '8823');
    assert.equal(edges.length, 3);
    assert.ok(edges.every(e => e.from === occupation.id && entities.some(target => target.id === e.to)));
    assert.equal(edges.find(e => e.type === 'has_task')!.attributes.incumbentsResponding, 95);
    for (const edge of edges.filter(e => e.type === 'has_skill')) {
      assert.equal(edge.attributes.dataValue, 4.12);
      assert.equal(edge.attributes.standardError, null);
      assert.equal(edge.attributes.lowerCiBound, null);
      assert.equal(edge.attributes.upperCiBound, null);
    }
    const observations = await app.world.observations();
    assert.equal(observations.length, 4);
    assert.deepEqual(observations.map(o => o.provenance.recordKey).sort(), ['11-1011.00', '11-1011.00:2.A.1.a:IM', '11-1011.00:2.A.1.a:LV', '11-1011.00:8823']);
    assert.ok(observations.every(o => o.provenance.kind === 'zetaris' && o.provenance.dataset === 'O*NET' && o.provenance.version === '31.0' && Number.isFinite(Date.parse(o.provenance.retrievedAt))));
    for (const invalid of [null, true, '', ' ', 'NaN', 'Infinity', '0x10', '4junk']) assert.equal(numeric(invalid), null);
    assert.equal(numeric('0'), 0);
    assert.equal(numeric('1.25e2'), 125);
    assert.throws(() => createOnetMapper()('occupation_data', [], new Date().toISOString()), /column count/);
  } finally { app.close(); rmSync(dir, { recursive: true, force: true }); }
});
