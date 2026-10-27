import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkshift } from '../src/app.js';
import { createDashboard, sections, validateAnalysis } from '../src/dashboard.js';
import { createOnetMapper } from '../src/real-demo.js';
import { jsonResponse } from './fixtures/http.js';

import { localFetch } from './fixtures/dashboard-http.js';

for (const provider of ['groq', 'nightshift']) test(`dashboard ${provider} selects SQLite evidence, verifies citations and protects private routes`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dashboard-test-'));
  const env = { HMEM_ARTIFACTS_DIR: join(dir, 'memories'), WORLD_SQLITE_PATH: join(dir, 'world.sqlite'), WORLD_TRACE_PATH: join(dir, 'trace.jsonl'), AI_PROVIDER: provider, GROQ_API_KEY: 'test-secret-do-not-expose', NIGHTSHIFT_API_KEY: 'test-secret-do-not-expose' };
  let invalid = false, calls = 0;
  const app = createWorkshift(env, { fetch: async (url, init) => {
    calls++;
    assert.equal(String(url), provider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'http://127.0.0.1:18088/v1/chat/completions');
    assert.equal((init?.headers as Record<string,string>).Authorization, 'Bearer test-secret-do-not-expose');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, provider === 'groq' ? 'openai/gpt-oss-120b' : 'meterless/text');
    const evidence = JSON.parse(body.messages[1].content).evidence;
    const o = evidence[0];
    const citation = { observationId: o.id, entityId: o.entities[0].id, sourceTable: invalid ? 'wrong_table' : o.provenance.table, recordKey: o.provenance.recordKey, dataset: o.provenance.dataset, version: o.provenance.version };
    return jsonResponse({ choices: [{ message: { content: (provider === 'nightshift' ? '<think>Reasoning is not evidence</think>\n' : '') + JSON.stringify(Object.fromEntries(sections.map(s => [s, [{ text: 'Synthetic test hypothesis', citations: [citation] }]]))) } }] });
  } });
  const mapper = createOnetMapper(), at = '2026-10-26T00:00:00Z';
  await app.ingest.ingest([
    mapper('occupation_data', ['11-1011.00', 'Test executives', 'Test description'], at),
    mapper('occupation_data', ['11-1021.00', 'Test managers', 'Second description'], at),
    mapper('task_statements', ['11-1011.00','Test executives','1','Test task','Core','10','2026','Analyst'], at),
    mapper('essential_skills', ['11-1011.00','Test executives','2.A','Test skill','IM','Importance','4','8','','','','N','','2026','Analyst'], at),
  ]);
  const server = createDashboard(app, env);
  const fetch = localFetch(server);
  const base = 'http://localhost';
  try {
    const home = await fetch(base);
    assert.match(home.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    assert.match(await home.text(), /Occupation selector/);
    const listText = await (await fetch(base+'/api/occupations')).text();
    assert.ok(!listText.includes(env.GROQ_API_KEY));
    const list = JSON.parse(listText);
    assert.equal(list.occupations.length, 2);
    assert.equal(list.aiReady, true);
    const first = list.occupations[0].id, second = list.occupations[1].id;
    const d = await (await fetch(base+'/api/occupations/'+first)).json();
    assert.equal(d.occupation.attributes.description, 'Test description');
    assert.equal(d.tasks.length, 1); assert.equal(d.skills.length, 1);
    assert.equal(d.tasks[0].relationship.provenance.recordKey, '11-1011.00:1');
    const other = await (await fetch(base+'/api/occupations/'+second)).json();
    assert.equal(other.tasks.length, 0); assert.equal(other.occupation.name, 'Test managers');
    for (const path of ['/api/occupations/missing','/.env','/.secrets/zetaris-api-key','/src/app.ts','/artifacts/real-demo/world.sqlite','/../package.json']) assert.equal((await fetch(base+path)).status,404);
    const analyze = base+'/api/occupations/'+first+'/analyze';
    assert.equal((await fetch(analyze,{method:'POST',headers:{Origin:'https://untrusted.example'}})).status,403);
    assert.equal(calls,0);
    const response = await fetch(analyze,{method:'POST'});
    assert.equal(response.status,200);
    assert.equal((await response.json()).provider,provider === 'groq' ? 'groq' : 'meterless-nightshift');
    invalid = true;
    assert.equal((await fetch(analyze,{method:'POST'})).status,502);
    const observations = await app.world.observations(), o=observations[0]!;
    const citation = { observationId:o.id, entityId:o.entities[0]!.id, sourceTable:o.provenance.table,recordKey:o.provenance.recordKey,dataset:o.provenance.dataset,version:o.provenance.version };
    const analysis = (c: unknown, text='Hypothesis') => Object.fromEntries(sections.map(s=>[s,[{text,citations:c}]]));
    const allowed = new Set([o.id]);
    assert.doesNotThrow(()=>validateAnalysis(analysis([citation]),observations,allowed));
    for(const patch of [{observationId:'missing'},{sourceTable:'wrong'},{recordKey:'wrong'},{entityId:'missing'},{dataset:'wrong'},{version:'wrong'}]) assert.throws(()=>validateAnalysis(analysis([{...citation,...patch}]),observations,allowed));
    assert.throws(()=>validateAnalysis(analysis([]),observations,allowed));
    assert.throws(()=>validateAnalysis(analysis([citation]),observations,new Set()));
    assert.throws(()=>validateAnalysis(analysis([citation],'Automate 80%'),observations,allowed));
    assert.throws(()=>validateAnalysis({},observations,allowed));
  } finally { server.close();app.close();rmSync(dir,{recursive:true,force:true}); }
});

test('empty graph returns no fabricated occupations and missing Groq configuration is explicit', async()=>{
  const app=createWorkshift({WORLD_SQLITE_PATH:':memory:'});
  const server=createDashboard(app,{});
  const fetch=localFetch(server);
  try {const r=await fetch('http://localhost/api/occupations');assert.deepEqual((await r.json()).occupations,[]);}finally{server.close();app.close();}
});

test('Nightshift missing key disables analysis without making provider requests', async () => {
  let calls = 0;
  const dir = mkdtempSync(join(tmpdir(), 'dashboard-missing-key-'));
  const env = {AI_PROVIDER:'nightshift', WORLD_SQLITE_PATH:':memory:', WORLD_TRACE_PATH:join(dir,'trace.jsonl')};
  const app = createWorkshift(env, {fetch:async () => {calls++; throw new Error('must not call');}});
  const server = createDashboard(app, env), fetch = localFetch(server);
  try {
    const record = createOnetMapper()('occupation_data', ['11-1011.00','Fixture','Description'], '2026-10-26T00:00:00Z');
    await app.ingest.ingest([record]);
    const list = await (await fetch('http://localhost/api/occupations')).json();
    assert.equal(list.aiReady,false);
    assert.equal((await fetch('http://localhost/api/occupations/'+list.occupations[0].id+'/analyze', {method:'POST'})).status,503);
    assert.equal(calls,0);
  } finally {server.close();app.close();rmSync(dir,{recursive:true,force:true});}
});

for (const provider of ['groq', 'nightshift']) test(`dashboard ${provider} logs only safe failure metadata and preserves generic 502`, async t => {
  const secret = 'sensitive-key-prompt-response';
  const logs: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logs.push(args); });
  let mode = 'http';
  const dir = mkdtempSync(join(tmpdir(), 'dashboard-diagnostics-'));
  const env = { AI_PROVIDER: provider, GROQ_API_KEY: secret, NIGHTSHIFT_API_KEY: secret,
    WORLD_SQLITE_PATH: ':memory:', WORLD_TRACE_PATH: join(dir, 'trace.jsonl') };
  const app = createWorkshift(env, { fetch: async () => {
    if (mode === 'http') return new Response(secret, { status: 503 });
    if (mode === 'unauthorized') return new Response(secret, { status: 401 });
    if (mode === 'network') throw new Error(`Authorization: Bearer ${secret}`);
    if (mode === 'envelope_json') return new Response(secret, { headers: { 'Content-Type': 'application/json' } });
    if (mode === 'contract') return jsonResponse({ error: secret });
    const content = mode === 'model_json' ? secret : JSON.stringify(Object.fromEntries(sections.map(s => [s,
      [{ text: secret, citations: [{ observationId: secret, entityId: secret }] }]])));
    return jsonResponse({ choices: [{ message: { content } }] });
  } });
  const server = createDashboard(app, env), fetch = localFetch(server);
  try {
    await app.ingest.ingest([createOnetMapper()('occupation_data', ['11-1011.00', secret, secret], '2026-10-26T00:00:00Z')]);
    const list = await (await fetch('http://localhost/api/occupations')).json();
    const url = `http://localhost/api/occupations/${list.occupations[0].id}/analyze`;
    for (const [scenario, failure, status] of [
      ['http', 'provider_http', 503], ['unauthorized', 'provider_http', 401],
      ['network', 'provider_network'], ['envelope_json', 'invalid_json'],
      ['contract', 'provider_contract'], ['model_json', 'invalid_json'],
      ['citation', 'citation_validation'],
    ] as const) {
      mode = scenario;
      const response = await fetch(url, { method: 'POST' });
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: 'Analysis unavailable: provider failed or response/citations could not be verified. No unverified analysis was displayed.' });
      assert.deepEqual(logs.at(-1), ['Dashboard analysis failed', { provider, failure, ...(status === undefined ? {} : { status }) }]);
    }
    assert.equal(logs.length, 7);
    assert.ok(!JSON.stringify(logs).includes(secret));
  } finally { server.close(); app.close(); rmSync(dir, { recursive: true, force: true }); }
});
