/** SYNTHETIC envelopes. Shape follows public clients; no live response captured. */
export const zetarisRunFixture = { data: [['fixture-occ-1', 'Fixture occupation']] };
export const modelsFixture = { object: 'list', data: [{ id: 'meterless/auto' }, { id: 'meterless/future-mode' }, { id: 'other/model' }] };
export const chatFixture = { choices: [{ message: { role: 'assistant', content: 'SYNTHETIC FIXTURE answer' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
export const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
