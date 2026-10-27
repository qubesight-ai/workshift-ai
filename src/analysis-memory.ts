import { resolve, join } from 'node:path';
import { HMEM } from '../vendor/hmem/src/index.ts';
import { stableId, canonical, type ProjectedEntity, type Observation } from './world/model.js';
import { validateAnalysis } from './analysis-validation.js';

export const hypothesisLabel = 'AI-generated hypotheses • citations verified against SQLite, claims not independently verified';
/** Separate stores prevent H-MEM ranking, relationships and ledger reads crossing occupations. */
export class AnalysisMemory {
  constructor(private directory = './artifacts/hmem', private secrets: string[] = []) {}
  private store(occupation: ProjectedEntity) {
    return new HMEM({ persistDir: join(resolve(this.directory), stableId('occupation', occupation.id)), actor: 'workshift-analysis' });
  }
  save(occupation: ProjectedEntity, input: unknown, observations: Observation[], allowed: Set<string>, provider: string, model: string) {
    if (provider !== 'meterless-nightshift') return undefined;
    const analysis = validateAnalysis(input, observations, allowed);
    const summary = { occupationId: occupation.id, occupationCode: occupation.key, provider, model, label: hypothesisLabel, analysis };
    const content = canonical(summary);
    if (this.secrets.some(secret => secret && content.includes(secret)) || /Bearer\s+\S+|(?:api[_-]?key|password|secret)\s*[:=]\s*\S+/i.test(content)) throw new Error('Sensitive memory content rejected');
    const fingerprint = stableId('analysis', summary);
    const hmem = this.store(occupation);
    const existing = hmem.store.all().find(m => m.tags.includes(fingerprint));
    if (existing) return { id: existing.id, duplicate: true };
    const refs = [...new Set(Object.values(analysis).flatMap(claims => claims.flatMap(c => c.citations.map(citation => citation.observationId))))].sort();
    const memory = hmem.add({ content, type: 'general', layer: 'long_term', confidence: 0.7,
      source: 'meterless-nightshift:sqlite-citation-validated', chatId: occupation.id,
      tags: [fingerprint, 'generated-hypothesis', `occupation:${occupation.id}`, `soc:${occupation.key}`],
      provenance: { origin: 'model_response', learnedAt: Date.now(), label: hypothesisLabel, refs } });
    return { id: memory.id, duplicate: false };
  }
  query(occupation: ProjectedEntity, query: string, observations: Observation[], allowed: Set<string>) {
    if (query.length > 500 || /Bearer\s+\S+|(?:api[_-]?key|password|secret)\s*[:=]\s*\S+/i.test(query) || this.secrets.some(s => s && query.includes(s))) throw new Error('Invalid memory query');
    const hmem = this.store(occupation);
    const results = hmem.query(query || occupation.name, { topN: hmem.store.all().length, threshold: query.trim() ? 0.12 : 0 });
    const memories = results.memories.flatMap(({ memory, relevance }) => {
      try {
        const summary = JSON.parse(memory.content);
        if (summary.occupationId !== occupation.id || summary.occupationCode !== occupation.key || summary.provider !== 'meterless-nightshift' || memory.chatId !== occupation.id || memory.provenance.origin !== 'model_response') return [];
        const analysis = validateAnalysis(summary.analysis, observations, allowed);
        return [{ id: memory.id, occupationId: occupation.id, occupationCode: occupation.key, provider: summary.provider, model: summary.model,
          label: hypothesisLabel, savedAt: memory.timestamp, relevance, provenance: memory.provenance, analysis }];
      } catch { return []; }
    }).slice(0, 5);
    hmem.store.persist();
    return memories;
  }
}
