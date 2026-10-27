import type { Observation, Provenance } from './world/model.js';
const verified = (p: Provenance) => p.kind === 'zetaris' && p.dataset === 'O*NET' && p.version === '31.0';
export const sections = ['responsibilities', 'aiAssistance', 'humanOversight', 'reskilling'] as const;
export interface Citation { observationId: string; entityId: string; sourceTable: string; recordKey: string; dataset: string; version: string }
export interface Claim { text: string; citations: Citation[] }
export function validateAnalysis(value: unknown, observations: Observation[], allowed: Set<string>) {
  if (!value || typeof value !== 'object') throw new Error('Invalid analysis');
  const result: Record<string, Claim[]> = {};
  for (const section of sections) {
    const claims = (value as Record<string, unknown>)[section];
    if (!Array.isArray(claims) || claims.length < 1 || claims.length > 8) throw new Error('Missing analysis section');
    result[section] = claims.map((claim: unknown) => {
      if (!claim || typeof claim !== 'object') throw new Error('Invalid claim');
      const c = claim as Claim;
      if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 1800 || /%|percent|\bwage|\bsalar|employment forecast/i.test(c.text)) throw new Error('Unsupported claim');
      if (!Array.isArray(c.citations) || !c.citations.length || c.citations.length > 12) throw new Error('Missing citations');
      const citations = c.citations.map(citation => {
        if (!citation || typeof citation !== 'object') throw new Error('Invalid citation');
        const o = observations.find(o => o.id === citation.observationId);
        if (!o || !allowed.has(o.id) || !verified(o.provenance) || !o.entities.some(e => e.id === citation.entityId) ||
          o.provenance.table !== citation.sourceTable || o.provenance.recordKey !== citation.recordKey ||
          o.provenance.dataset !== citation.dataset || o.provenance.version !== citation.version) throw new Error('Citation does not match SQLite evidence');
        return { observationId: o.id, entityId: citation.entityId, sourceTable: o.provenance.table, recordKey: o.provenance.recordKey, dataset: o.provenance.dataset, version: o.provenance.version };
      });
      return { text: c.text, citations };
    });
  }
  return result;
}
