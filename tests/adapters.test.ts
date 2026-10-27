import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NightshiftAdapter, meterlessBase, stripReasoningPrefix } from '../src/adapters/nightshift.js';
import { ZetarisReadAdapter, parseZetarisRun, validateReadSql } from '../src/adapters/zetaris.js';
import { AdapterError, type Fetch } from '../src/adapters/http.js';
import { chatFixture, jsonResponse, modelsFixture, zetarisRunFixture } from './fixtures/http.js';
// Explicitly synthetic tokens are used ONLY with injected fetch; never a live URL.
const fakeToken = 'fixture-only-never-send';
const sql = 'SELECT * FROM WORKSHIFT_ONET.occupation_data LIMIT 2';
function mock(handler: (url: string, init: RequestInit) => Response | Promise<Response>): Fetch {
  return async (input, init) => handler(String(input), init ?? {});
}
test('Zetaris fixture request uses documented endpoint, body, auth, organization and unique IDs', async () => {
  const ids: string[] = [];
  const adapter = new ZetarisReadAdapter({ apiKey: fakeToken, orgId: '7', fetch: mock((url, init) => {
    assert.equal(url, 'http://127.0.0.1:8888/api/v1.0/sql-editor/sqls/run'); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
    const headers = new Headers(init.headers); assert.equal(headers.get('Authorization'), `Bearer ${fakeToken}`); assert.equal(headers.get('X-Org-ID'), '7');
    ids.push(headers.get('X-Request-ID')!);
    const body = JSON.parse(String(init.body)); assert.equal(body.sql, sql); assert.equal(body.limit, 2); assert.equal(body.source, 'SqlEditor'); assert.match(body.queryId, /^[0-9a-f-]{36}$/);
    return jsonResponse(zetarisRunFixture);
  }) });
  assert.deepEqual((await adapter.run(sql)).rows, zetarisRunFixture.data); await adapter.run(sql);
  assert.notEqual(ids[0], ids[1]);
});
test('SQL grammar blocks writes, injection, unbounded reads, unapproved tables and expressions', () => {
  for (const query of ['DELETE FROM WORKSHIFT_ONET.occupation_data', sql + '; DROP TABLE x', sql + ' -- comment', 'SELECT * FROM WORKSHIFT_ONET.occupation_data', 'SELECT * FROM secret LIMIT 1', 'SELECT sleep(10) FROM WORKSHIFT_ONET.occupation_data LIMIT 1', 'SELECT * FROM WORKSHIFT_ONET.occupation_data LIMIT 101', 'SELECT * FROM WORKSHIFT_ONET.occupation_data LIMIT 1 OFFSET 2', 'WITH t AS (DELETE FROM x) SELECT * FROM t LIMIT 1', 'SELECT * FROM WORKSHIFT_ONET.occupation_data LIMIT 1 UNION SELECT * FROM x']) assert.throws(() => validateReadSql(query), query);
  assert.equal(validateReadSql('SELECT "O*NET-SOC Code", title FROM WORKSHIFT_ONET.occupation_data ORDER BY "O*NET-SOC Code" LIMIT 10 OFFSET 20').limit, 10);
});
test('Zetaris parser fails closed on unsupported response shapes; no guessed headers', () => {
  for (const value of [{}, { rows: [] }, { data: [{}] }, { data: [[1], [1, 2]] }, { data: null }, { data: [], error: 'failed' }, { data: [[[1]]] }]) assert.throws(() => parseZetarisRun(value, 10), AdapterError);
  assert.deepEqual(parseZetarisRun({ data: [] }, 2), []);
  assert.throws(() => parseZetarisRun({ data: [[1], [2]] }, 1));
});
test('missing credentials and invalid SQL never reach fetch', async () => {
  let calls = 0;
  const fetch = mock(() => { calls++; return jsonResponse({}); });
  await assert.rejects(new ZetarisReadAdapter({ fetch }).run(sql), /ZETARIS_API_KEY/);
  await assert.rejects(new ZetarisReadAdapter({ apiKey: fakeToken, fetch }).run(sql), /ORG_ID/);
  await assert.rejects(new ZetarisReadAdapter({ apiKey: fakeToken, orgId: '1', fetch }).run('DROP TABLE x'));
  await assert.rejects(new NightshiftAdapter({ fetch }).models(), /NIGHTSHIFT_API_KEY/);
  await assert.rejects(new NightshiftAdapter({ runtimeToken: 'rt-local', fetch }).models());
  assert.equal(calls, 0);
});
test('Nightshift fixture discovery preserves unknown modes; inference is OpenAI-compatible plain text', async () => {
  const calls: string[] = [];
  const adapter = new NightshiftAdapter({ runtimeToken: fakeToken, fetch: mock((url, init) => {
    calls.push(url); const headers = new Headers(init.headers);
    assert.equal(headers.get('Authorization'), `Bearer ${fakeToken}`); assert.equal(headers.get('meterless-app'), 'workshift-ai'); assert.equal(headers.get('meterless-scope'), 'user');
    if (url.endsWith('/models')) { assert.equal(init.method, 'GET'); return jsonResponse(modelsFixture); }
    assert.equal(url, 'http://127.0.0.1:18088/v1/chat/completions'); assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(String(init.body)), { model: 'meterless/text', messages: [{ role: 'user', content: 'fixture prompt' }], stream: false });
    return jsonResponse(chatFixture);
  }) });
  assert.deepEqual(await adapter.models(), ['meterless/auto', 'meterless/future-mode']);
  assert.equal((await adapter.chat([{ role: 'user', content: 'fixture prompt' }])).text, 'SYNTHETIC FIXTURE answer');
  assert.equal(calls.length, 2);
});
test('Meterless URL normalization avoids duplicated /v1 and refuses credential-bearing URLs', () => {
  for (const suffix of ['', '/v1', '/v1/', '/v1/models', '/v1/chat/completions', '/healthz']) assert.equal(meterlessBase('127.0.0.1:8088' + suffix), 'http://127.0.0.1:8088/v1');
  assert.throws(() => meterlessBase('http://user:secret@localhost:8088'));
  assert.throws(() => meterlessBase('http://localhost:8088/connect#k=secret'));
});
for (const status of [401, 403, 500]) test(`HTTP ${status} is classified without leaking provider body (fixtures)`, async () => {
  const fetch = mock(() => jsonResponse({ error: fakeToken }, status));
  for (const request of [() => new ZetarisReadAdapter({ apiKey: fakeToken, orgId: '1', fetch }).run(sql), () => new NightshiftAdapter({ runtimeToken: fakeToken, fetch }).models()]) {
    await assert.rejects(request(), (error: unknown) => error instanceof AdapterError && error.code === (status === 500 ? 'http' : 'unauthorized') && !error.message.includes(fakeToken));
  }
});
test('network errors, invalid JSON/HTML and malformed discovery are rejected (fixtures)', async () => {
  for (const fetch of [mock(() => { throw new Error(fakeToken); }), mock(() => new Response('<html>error</html>')), mock(() => new Response('{', { headers: { 'content-type': 'application/json' } })), mock(() => jsonResponse({ data: [{ id: 'other/model' }] }))]) {
    await assert.rejects(new NightshiftAdapter({ runtimeToken: fakeToken, fetch }).models(), AdapterError);
  }
});
test('non-text completion cannot be reported as a successful text inference', async () => {
  const adapter = new NightshiftAdapter({ runtimeToken: fakeToken, fetch: mock(url => jsonResponse(url.endsWith('/models') ? modelsFixture : { choices: [{ message: { content: null } }] })) });
  await assert.rejects(adapter.chat([{ role: 'user', content: 'x' }]), /plain text/);
});

test('reasoning prefix parsing preserves final text without guessing JSON', () => {
  for (const prefix of ['', '<think>private reasoning</think>', 'reasoning without opening tag</think>']) {
    assert.equal(stripReasoningPrefix(prefix + '\n{"answer":1}'), '{"answer":1}');
  }
  assert.equal(stripReasoningPrefix('not JSON'), 'not JSON');
  for (const text of ['', '<think>unfinished', '<think>only reasoning</think>']) assert.throws(() => stripReasoningPrefix(text), AdapterError);
});
for (const status of [401, 403, 429, 500]) test(`Nightshift chat HTTP ${status} fails safely`, async () => {
  const adapter = new NightshiftAdapter({runtimeToken: fakeToken, fetch: mock(() => jsonResponse({error: fakeToken}, status))});
  await assert.rejects(adapter.chat([{role:'user',content:'fixture'}]), (error: unknown) => error instanceof AdapterError && error.status === status && !error.message.includes(fakeToken));
});
test('Nightshift chat rejects network failures and malformed completions', async () => {
  for (const fetch of [mock(() => {throw new Error(fakeToken);}), mock(() => new Response('bad', {headers:{'content-type':'application/json'}})), ...[{}, {error:'failed'}, {choices:[]}, {choices:[{message:{content:null}}]}].map(value => mock(() => jsonResponse(value)))]) {
    await assert.rejects(new NightshiftAdapter({runtimeToken:fakeToken,fetch}).chat([{role:'user',content:'fixture'}]), AdapterError);
  }
});
