import { randomUUID } from 'node:crypto';
import { attributes, entityId, required, stableId, type IngestRecord, type Observation, type WorldPersistence } from './model.js';
import type { TraceSink } from './trace.js';

export class WorldStoreService {
  constructor(private readonly persistence: WorldPersistence) {}
  append(observation: Observation) { return this.persistence.append(observation); }
  entities() { return this.persistence.entities(); }
  relationships() { return this.persistence.relationships(); }
  observations() { return this.persistence.observations(); }
  async contexts() {
    return [...new Map((await this.observations()).map(o => [o.context.id, o.context])).values()];
  }
  async entity(id: string) { return (await this.entities()).find(e => e.id === id); }
  async neighbors(id: string) {
    const edges = (await this.relationships()).filter(e => e.from === id || e.to === id);
    const ids = new Set(edges.flatMap(e => [e.from, e.to])); ids.delete(id);
    return { edges, entities: (await this.entities()).filter(e => ids.has(e.id)) };
  }
}

export class IngestPipelineService {
  constructor(private readonly store: WorldStoreService, private readonly trace: TraceSink) {}
  async ingest(records: Iterable<IngestRecord>, runId = randomUUID()) {
    const result = { appended: 0, duplicates: 0, rejected: 0 };
    for (const raw of records) {
      let observation: Observation;
      try { observation = this.normalize(raw); }
      catch { result.rejected++; this.trace.write({ runId, operation: 'ingest', status: 'rejected' }); continue; }
      // Storage failures abort the run; replay from the start safely resumes via dedupe.
      let appended: boolean;
      try { appended = await this.store.append(observation); }
      catch (error) { this.trace.write({ runId, operation: 'ingest', status: 'rejected', observationId: observation.id }); throw error; }
      if (appended) result.appended++; else result.duplicates++;
      // A trace failure is surfaced after durable append; retry remains idempotent.
      this.trace.write({ runId, operation: 'ingest', status: appended ? 'appended' : 'duplicate', observationId: observation.id, entityCount: observation.entities.length });
    }
    return result;
  }
  private normalize(raw: IngestRecord): Observation {
    const p = raw.provenance;
    if (!p || !['fixture', 'zetaris'].includes(p.kind)) throw new Error('Provenance required');
    const provenance = { ...p, dataset: required(p.dataset, 'dataset'), version: required(p.version, 'version'), table: required(p.table, 'table'), recordKey: required(p.recordKey, 'recordKey') };
    if (!Number.isFinite(Date.parse(p.retrievedAt)) || (p.sourceUpdatedAt !== undefined && !Number.isFinite(Date.parse(p.sourceUpdatedAt)))) throw new Error('Invalid timestamp');
    const context = { id: stableId('ctx', [provenance.dataset, provenance.version]), type: 'dataset' as const, name: `${provenance.dataset} ${provenance.version}` };
    const entities = raw.entities.map(e => ({ type: required(e.type, 'type'), key: required(e.key, 'key'), name: required(e.name, 'name'), attributes: attributes(e.attributes), id: entityId(e.type, e.key) })).sort((a, b) => a.id.localeCompare(b.id));
    if (!entities.length || new Set(entities.map(e => e.id)).size !== entities.length) throw new Error('Entities empty or duplicated');
    const relationships = raw.relationships.map(e => {
      const from = entityId(e.from.type, e.from.key), to = entityId(e.to.type, e.to.key), type = required(e.type, 'relationship type');
      const key = e.key === undefined ? '' : required(e.key, 'relationship key');
      return { id: stableId('rel', [from, type, to, context.id, key]), key, from, to, type, contextId: context.id, attributes: attributes(e.attributes ?? {}) };
    }).sort((a, b) => a.id.localeCompare(b.id));
    if (new Set(relationships.map(e => e.id)).size !== relationships.length) throw new Error('Duplicate relationship');
    const { retrievedAt: _retrievedAt, ...identity } = provenance;
    const recordId = stableId('record', [p.kind, provenance.dataset, provenance.version, provenance.table, provenance.recordKey]);
    const checksum = stableId('sha256', { identity, context, entities, relationships });
    return { id: stableId('obs', [recordId, checksum]), recordId, schemaVersion: 1, checksum, provenance, context, entities, relationships };
  }
}

export class ContextBuilderService {
  constructor(private readonly store: WorldStoreService, private readonly trace: TraceSink) {}
  async build(options: { intent: string; entityIds: string[]; maxBytes?: number }) {
    const maxBytes = options.maxBytes ?? 16_000;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 256 || maxBytes > 1_000_000) throw new Error('Invalid context budget');
    const selected = new Set(options.entityIds);
    const all = await this.store.entities();
    const edges = (await this.store.relationships()).filter(e => selected.has(e.from) || selected.has(e.to));
    const neighbors = new Set(edges.flatMap(e => [e.from, e.to]));
    const payload = { intent: required(options.intent, 'intent'), entities: [] as typeof all, relationships: [] as typeof edges, truncated: false };
    const fits = () => Buffer.byteLength(JSON.stringify(payload)) + (payload.truncated ? 1 : 0) <= maxBytes;
    if (!fits()) throw new Error('Intent exceeds context budget');
    const candidates = all.filter(e => selected.has(e.id) || neighbors.has(e.id)).sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) || a.id.localeCompare(b.id));
    // Budget counts the final UTF-8 JSON, including provenance and flags.
    payload.truncated = true;
    for (const entity of candidates) { payload.entities.push(entity); if (!fits()) payload.entities.pop(); }
    const included = new Set(payload.entities.map(e => e.id));
    const eligible = edges.filter(e => included.has(e.from) && included.has(e.to));
    for (const edge of eligible) { payload.relationships.push(edge); if (!fits()) payload.relationships.pop(); }
    payload.truncated = payload.entities.length < candidates.length || payload.relationships.length < edges.length;
    if (!fits()) throw new Error('Context exceeds budget');
    this.trace.write({ runId: randomUUID(), operation: 'context', status: 'built', entityCount: payload.entities.length });
    return payload;
  }
}
