import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkshift } from '../src/app.js';
import { createDashboard, sections } from '../src/dashboard.js';
import { createOnetMapper } from '../src/real-demo.js';
import { jsonResponse } from './fixtures/http.js';
import { localFetch } from './fixtures/dashboard-http.js';

test('Nightshift H-MEM HTTP integration persists, deduplicates, retrieves provenance and isolates occupations', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hmem-integration-'));
  const secret = 'fixture-private-credential';
  const env = { AI_PROVIDER: 'nightshift', NIGHTSHIFT_API_KEY: secret, WORLD_SQLITE_PATH: join(dir,'world.sqlite'), WORLD_TRACE_PATH: join(dir,'trace.jsonl'), HMEM_ARTIFACTS_DIR: join(dir,'memories') };
  let invalid = false, leak = false;
  const providerFetch = async () => { throw new Error('Retrieval must not call provider'); };
  let app = createWorkshift(env, { fetch: async (_url, init) => {
    const o = JSON.parse(JSON.parse(String(init?.body)).messages[1].content).evidence[0];
    const citation = { observationId: o.id, entityId: o.entities[0].id, sourceTable: invalid ? 'invalid' : o.provenance.table, recordKey: o.provenance.recordKey, dataset: o.provenance.dataset, version: o.provenance.version };
    return jsonResponse({ choices: [{ message: { content: JSON.stringify(Object.fromEntries(sections.map(s => [s, [{ text: leak ? secret : 'Human oversight and review hypothesis', citations: [citation] }]]))) } }] });
  } });
  let server = createDashboard(app,env), request = localFetch(server);
  try {
    const mapper = createOnetMapper();
    await app.ingest.ingest(['11-1011.00','11-1021.00'].map(code => mapper('occupation_data',[code,code,'Description'],'2026-10-26T00:00:00Z')));
    const occupations = (await (await request('http://localhost/api/occupations')).json()).occupations;
    const first = occupations[0].id, second = occupations[1].id;
    const route = (id: string) => 'http://localhost/api/occupations/'+id;
    for (const duplicate of [false,true]) {
      const response = await request(route(first)+'/analyze',{method:'POST'});
      assert.equal(response.status,200);
      assert.equal((await response.json()).memory.duplicate,duplicate);
    }
    invalid = true;
    assert.equal((await request(route(first)+'/analyze',{method:'POST'})).status,502);
    invalid = false; leak = true;
    assert.equal((await request(route(first)+'/analyze',{method:'POST'})).status,502);
    // Close the app and reconstruct H-MEM from disk with a provider that cannot run.
    server.close(); app.close();
    app = createWorkshift(env,{fetch:providerFetch}); server = createDashboard(app,env); request = localFetch(server);
    const memories = (await (await request(route(first)+'/memories?q=human%20oversight')).json()).memories;
    assert.equal(memories.length,1);
    const m = memories[0];
    assert.equal(m.occupationId,first); assert.equal(m.occupationCode,occupations[0].code);
    assert.equal(m.provider,'meterless-nightshift'); assert.equal(m.provenance.origin,'model_response');
    assert.match(m.label,/claims not independently verified/);
    assert.ok(m.provenance.refs.includes(m.analysis.responsibilities[0].citations[0].observationId));
    assert.deepEqual((await (await request(route(second)+'/memories?q=human')).json()).memories,[]);
    // Provenance from another occupation cannot pass the allowed SQLite evidence boundary.
    const other = await app.world.entity(second), obs = await app.world.observations();
    assert.throws(() => app.memory.save(other!,m.analysis,obs,new Set(obs.filter(o => o.entities.some(e => e.id === second)).map(o => o.id)),'meterless-nightshift','meterless/text'));
    const folder = readdirSync(env.HMEM_ARTIFACTS_DIR).find(f => readFileSync(join(env.HMEM_ARTIFACTS_DIR,f,'state.json'),'utf8').includes(first))!;
    const state = readFileSync(join(env.HMEM_ARTIFACTS_DIR,folder,'state.json'),'utf8');
    assert.equal(JSON.parse(state).records.length,1); assert.ok(!state.includes(secret));
    const ledger = readFileSync(join(env.HMEM_ARTIFACTS_DIR,folder,'ledger.jsonl'),'utf8');
    assert.match(ledger,/"action":"create"/); assert.match(ledger,/"action":"read"/); assert.ok(!ledger.includes(secret));
    // Same occupation in a different SQLite graph cannot resurrect unchecked citations.
    const empty = createWorkshift({...env,WORLD_SQLITE_PATH:':memory:'},{fetch:providerFetch});
    try { assert.deepEqual(empty.memory.query((await app.world.entity(first))!,'human',[],new Set()),[]); } finally {empty.close();}
  } finally {server.close();app.close();rmSync(dir,{recursive:true,force:true});}
});
