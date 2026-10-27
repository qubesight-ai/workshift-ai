import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { createWorkshift } from '../src/app.js';
import { entityId } from '../src/world/model.js';
import { fixtureRecords } from './fixtures/onet.js';
import { chatFixture, jsonResponse, modelsFixture, zetarisRunFixture } from './fixtures/http.js';
test('active application path: fixture HTTP → SQLite ingestion → graph context → fixture Nightshift', async () => {
  mkdirSync('artifacts/tests', { recursive: true });
  const dir = mkdtempSync(resolve('artifacts/tests/app-'));
  const env = { WORLD_SQLITE_PATH: `${dir}/world.sqlite`, WORLD_TRACE_PATH: `${dir}/trace.jsonl`, ZETARIS_API_KEY: 'fixture-only-never-send', ZETARIS_ORG_ID: '1', NIGHTSHIFT_API_KEY: 'fixture-only-never-send' };
  let requests = 0;
  const app = createWorkshift(env, { fetch: async (input, init) => {
    requests++;
    const url = String(input);
    if (url.endsWith('/sql-editor/sqls/run')) return jsonResponse(zetarisRunFixture);
    if (url.endsWith('/models')) return jsonResponse(modelsFixture);
    assert.ok(url.endsWith('/chat/completions'));
    const body = JSON.parse(String(init?.body));
    const context = JSON.parse(body.messages[1].content);
    assert.equal(context.entities[0].name, 'Fixture occupation');
    assert.equal(context.entities[0].provenance.kind, 'zetaris');
    assert.ok(context.entities[0].observationId.startsWith('obs_'));
    return jsonResponse(chatFixture);
  } });
  try {
    assert.equal(requests, 0, 'factory never connects');
    const sql = 'SELECT * FROM WORKSHIFT_ONET.occupation_data LIMIT 2';
    const mapper = (row: (string | number | boolean | null)[]) => {
      assert.deepEqual(row, zetarisRunFixture.data[0]);
      const record = structuredClone(fixtureRecords[0]!);
      // Synthetic normalized mapping for fixture columns, not an asserted O*NET schema.
      record.provenance.kind = 'zetaris'; return record;
    };
    assert.equal((await app.ingestZetarisPage(sql, mapper)).appended, 1);
    assert.equal((await app.ingestZetarisPage(sql, mapper)).duplicates, 1);
    assert.equal((await app.world.contexts()).length, 1);
    assert.equal((await app.answer('Inspect fixture evidence', [entityId('occupation', 'onet:fixture-occ-1')])).text, 'SYNTHETIC FIXTURE answer');
    assert.equal(requests, 3);
  } finally { app.close(); }
});

test('provider selection is explicit and Nightshift settings reach the adapter', async () => {
  assert.throws(() => createWorkshift({AI_PROVIDER:'unsupported', WORLD_SQLITE_PATH:':memory:'}), /Unsupported AI_PROVIDER/);
  for (const provider of ['groq', 'nightshift']) {
    const app = createWorkshift({AI_PROVIDER:provider, WORLD_SQLITE_PATH:':memory:', NIGHTSHIFT_API_KEY:'fixture-key', NIGHTSHIFT_BASE_URL:'http://127.0.0.1:19000/v1', NIGHTSHIFT_MODEL:'meterless/custom'}, {fetch:async (url, init) => {
      assert.equal(String(url),'http://127.0.0.1:19000/v1/chat/completions');
      assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer fixture-key');
      assert.equal(JSON.parse(String(init?.body)).model,'meterless/custom');
      return jsonResponse(chatFixture);
    }});
    try {
      assert.equal(app.provider.provider, provider === 'groq' ? 'groq' : 'meterless-nightshift');
      if (provider === 'nightshift') await app.provider.chat([{role:'user',content:'fixture'}]);
    } finally {app.close();}
  }
});
