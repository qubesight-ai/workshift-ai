# WORKSHIFT AI

A local occupational intelligence dashboard using the existing SQLite world graph, O*NET 31.0 records ingested through Zetaris, and Groq or Nightshift inference. Requires Node.js **22.13–22.x**. Node emits its standard experimental `node:sqlite` warning.

## Launch the dashboard

```bash
npm ci --ignore-scripts --cache .npm-cache
npm run build
AI_PROVIDER=groq WORLD_SQLITE_PATH=./artifacts/real-demo/world.sqlite node --env-file=.env.local dist/src/dashboard.js
```

Create a private `.env.local` from `.env.example` and set `GROQ_API_KEY` there. Do not commit credentials. Alternatively export `GROQ_API_KEY` in your shell and run:

```bash
AI_PROVIDER=groq WORLD_SQLITE_PATH=./artifacts/real-demo/world.sqlite npm run dashboard
```

Open **http://127.0.0.1:3000**. The server binds only to loopback and serves one HTML page and explicit JSON API routes. It never serves repository files. No deployment or production configuration changes are needed. Without the selected provider’s key, source browsing works and AI is explicitly unavailable. No simulated analysis is supplied.

The default database is `artifacts/real-demo/world.sqlite`. This workspace contains a bounded sample with 60 Zetaris-attributed observations (20 per source table), not the complete O*NET release. Some occupations have no task or skill records in that sample; the dashboard reports gaps. With a different installation, point `WORLD_SQLITE_PATH` at your ingested world graph. An empty graph displays an empty state, never hardcoded occupations.

## Data and inference

Select or search for an occupation to see its description, tasks, skills, source ratings and provenance. Skills retain distinct IM/LV scales. These ratings are not automation probabilities. Source metadata includes dataset, version, source table, record key, retrieval time and observation ID.

The graph uses the immutable `observations` log and `entity_view` / `relationship_view` projections through `WorldStoreService`; there is no `entities` table. The dashboard filters for Zetaris provenance, O*NET, version 31.0. “Verified source records” means matching stored provenance, not independent certification of the upstream dataset.

**Analyze with AI** calls the provider returned by `createWorkshift()` with `AI_PROVIDER=groq` or `AI_PROVIDER=nightshift`. It supplies at most 24 selected-occupation observations, reporting the supplied and total counts. The response must contain responsibilities, AI assistance opportunities, human oversight and reskilling suggestions. All are labeled AI-generated hypotheses.

Every claim must cite an observation and entity, dataset, version, source table and record key. The server checks these against SQLite and the supplied evidence set. Missing, unrelated or mismatched citations reject the whole response with a safe error. Citation identity checks do not establish semantic entailment or prove the advice correct. The prompt prohibits automation percentages, wages and forecasts; an additional output guard rejects percentage and wage/forecast wording. Human review remains necessary. Provider errors and raw provider responses are not sent to the browser.

API routes:

- `GET /api/occupations` — available occupations and AI readiness.
- `GET /api/occupations/:id` — selected occupation and graph evidence.
- `POST /api/occupations/:id/analyze` — selected-provider analysis with validated citations.

Only one inference runs at a time; concurrent attempts get HTTP 429. Cross-origin browser inference requests are rejected. The local demo has no multi-user authentication and is intended for loopback use.

## Environment variables

Node does not load env files automatically; use `node --env-file=.env.local …` or export variables.

| Variable | Purpose / default |
|---|---|
| `PORT` | Dashboard port, `3000`; host is `127.0.0.1` |
| `WORLD_SQLITE_PATH` | Dashboard: `./artifacts/real-demo/world.sqlite`; factory: `./data/world.sqlite` |
| `WORLD_TRACE_PATH` | Factory trace file, `./data/traces.jsonl` |
| `AI_PROVIDER` | `groq` or `nightshift`; dashboard entry point defaults to Groq |
| `NIGHTSHIFT_API_KEY` | Server-only Nightshift bearer token |
| `NIGHTSHIFT_BASE_URL` | Defaults to `http://127.0.0.1:18088/v1` |
| `NIGHTSHIFT_MODEL` | Defaults to `meterless/text` |
| `GROQ_API_KEY` | Required for real AI inference; server only |
| `GROQ_MODEL` | `openai/gpt-oss-120b` |
| `ZETARIS_BASE_URL` | `http://127.0.0.1:8888/api/v1.0` |
| `ZETARIS_API_KEY` | Read-only Zetaris bearer credential for ingestion |
| `ZETARIS_ORG_ID` | Numeric Zetaris organization ID |
| `METERLESS_BASE_URL` | Existing Nightshift adapter: `http://127.0.0.1:8088/v1` |
| `METERLESS_RUNTIME_TOKEN` | Existing Nightshift runtime credential |
| `METERLESS_MODEL` | `meterless/auto` |
| `METERLESS_APP` | `workshift-ai` |
| `METERLESS_SCOPE` | `user` |

The Zetaris, Nightshift and Groq adapter interfaces remain unchanged. The existing `src/real-demo.ts` ingestion runner uses the schema-confirmed O*NET mapper and bounded `LIMIT 20` reads. To refresh that local sample, `npm run ingest:real` runs the existing runner; it expects the existing `.secrets/zetaris-api-key` and organization `1`. It writes `artifacts/real-demo/`, so use it only when intentionally refreshing the sample. The dashboard itself does not ingest or modify source records. Custom ingestion can use `createWorkshift().ingestZetarisPage()` and `createOnetMapper()`.

## Validation and existing CLI demo

```bash
npm test
npm run build
npm run demo
```

Tests use synthetic fixtures only, including fixture Groq and Nightshift HTTP responses; runtime inference calls the selected provider. Dashboard tests exercise the actual HTTP listener in process so they also run in environments where binding sockets is forbidden. They cover occupation switching, source details, empty graphs, private-route denial, cross-origin rejection, Groq and Nightshift request wiring and failed citation validation. The original CLI `npm run demo` remains a synthetic architecture demo, separate from the browser dashboard.

See [architecture](docs/architecture.md) and [historical verification notes](docs/verification.md) for the original scaffold. Those notes predate the dashboard.

To start with the existing Nightshift runtime from `/opt/workshift-ai`:

```bash
(set +x; export NIGHTSHIFT_API_KEY="$(cat .secrets/nightshift-token)"; AI_PROVIDER=nightshift NIGHTSHIFT_BASE_URL=http://127.0.0.1:18088/v1 NIGHTSHIFT_MODEL=meterless/text WORLD_SQLITE_PATH=./artifacts/real-demo/world.sqlite npm run dashboard)
```

The subshell loads the token into the server environment without printing it or changing the token file. The dashboard stays bound to `127.0.0.1`. Nightshift chat requests go directly to `/chat/completions`; model discovery remains available through the adapter but is not a prerequisite for inference. Text before an explicit `</think>` delimiter is discarded before strict JSON parsing and unchanged evidence citation validation. Empty, malformed or unverified answers fail closed. `meterless/text` is the requested routing model; the verified runtime routes it to `nvidia/nemotron-3-ultra-550b-a55b`.

### Occupational analysis memory (H-MEM)

Validated Nightshift dashboard analyses are saved through the official reference
implementation at `vendor/hmem` using `HMEM.add()`. The dashboard's **Prior
Nightshift analyses** panel uses `HMEM.query()` with deterministic hybrid ranking.
Groq analysis and the existing Zetaris/SQLite paths remain available.

Memories live under `HMEM_ARTIFACTS_DIR` (default `./artifacts/hmem`), in a hashed
subdirectory per occupation containing `state.json` and `ledger.jsonl`. Each
summary records the occupation entity ID and SOC code, provider/model, complete
section text and citations, generation time, and `model_response` provenance with
observation references. They are generated hypotheses: citation validation checks
source attribution, not the truth of the suggestions. Memories are never ingested
as O*NET facts or supplied as verified evidence to the provider.

Canonical summary fingerprints prevent identical writes, including after reopening
the app. Separate H-MEM instances and directories prevent cross-occupation ranking
and relationship creation. Retrieval rechecks every returned summary against that
occupation's current SQLite evidence selection. Invalid or unavailable citations
are omitted. An empty search shows up to five saved summaries; text searches use
H-MEM relevance ranking. Retrieval works without provider credentials or requests.
Known configured secret values and credential-shaped strings are rejected before
memory writes; memory files are not served by HTTP routes. Query text is recorded
by H-MEM's reference trust ledger, so use occupational search terms.

The reference implementation uses synchronous JSON files. This integration targets
one dashboard writer; it does not add locking for multiple processes sharing the
same memory directory. Keep each independently running dashboard's directory
separate. The vendor source is unchanged and compiled by `tsconfig.hmem.json` under
its own strict settings; the application's stricter TypeScript checks remain on.

Manual verification (after choosing to launch a separate local dashboard; no
running service needs a restart):

1. Run `npm run build` and `npm test` from the repository root.
2. With valid credentials already configured securely in your shell, launch a
   separate instance on an unused port:
   `AI_PROVIDER=nightshift PORT=3001 HMEM_ARTIFACTS_DIR=./artifacts/hmem-manual node dist/src/dashboard.js`.
   The default dashboard database is `./artifacts/real-demo/world.sqlite`; set
   `WORLD_SQLITE_PATH` if your verified Zetaris ingest is elsewhere.
3. Open `http://127.0.0.1:3001`, select an occupation, and click **Analyze with AI**.
   Confirm the generated-hypothesis label, validated source citations, and
   “Nightshift memory saved” status.
4. Click **Retrieve prior analyses** with an empty search, then search for a phrase
   from the result. Confirm its SOC code, timestamp, provider/model, origin and
   citations. Search relevance can exclude weak matches.
5. Select a different occupation and retrieve again. The first occupation's
   summaries must not appear. Switch back and retrieve the original summary.
6. Reload the page and retrieve again. Confirm the original memory remains. Inspect
   `artifacts/hmem-manual/<occupation hash>/state.json` and `ledger.jsonl` locally
   for the persisted record and create/read provenance. Identical generated output
   should report “already saved”; different output is a distinct analysis.
7. Persistence across application reconstruction, invalid citation rejection,
   credential rejection and duplicate prevention are demonstrated without real
   provider calls by `tests/memory.test.ts` in `npm test`.
