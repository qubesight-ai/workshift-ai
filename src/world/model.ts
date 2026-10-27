import { createHash } from 'node:crypto';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Attributes = { [key: string]: Json };
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  throw new Error('Only finite JSON values are supported');
}
export const stableId = (kind: string, key: unknown): string => `${kind}_${createHash('sha256').update(canonical(key)).digest('hex')}`;
export function required(value: string, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.normalize('NFC').trim();
}
export interface EntityInput { type: string; key: string; name: string; attributes: Attributes }
export interface Entity extends EntityInput { id: string }
export interface Context { id: string; type: 'dataset'; name: string }
export interface RelationshipInput { key?: string; from: { type: string; key: string }; to: { type: string; key: string }; type: string; attributes?: Attributes }
export interface Relationship { id: string; key: string; from: string; to: string; type: string; contextId: string; attributes: Attributes }
export interface Provenance {
  kind: 'zetaris' | 'fixture'; dataset: string; version: string; table: string;
  recordKey: string; retrievedAt: string; sourceUpdatedAt?: string;
}
export interface IngestRecord { provenance: Provenance; entities: EntityInput[]; relationships: RelationshipInput[] }
export interface Observation {
  id: string; recordId: string; schemaVersion: 1; checksum: string; provenance: Provenance;
  context: Context; entities: Entity[]; relationships: Relationship[];
}
export interface ProjectedEntity extends Entity { observationId: string; provenance: Provenance; contextId: string }
export interface ProjectedRelationship extends Relationship { observationId: string; provenance: Provenance }
export const entityId = (type: string, key: string): string => stableId('ent', [required(type, 'type'), required(key, 'key')]);
export interface WorldPersistence {
  append(observation: Observation): Promise<boolean>;
  entities(): Promise<ProjectedEntity[]>;
  relationships(): Promise<ProjectedRelationship[]>;
  observations(): Promise<Observation[]>;
  close(): void;
}

export function attributes(value: Attributes): Attributes {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Attributes must be a JSON object');
  return JSON.parse(canonical(value)) as Attributes;
}
