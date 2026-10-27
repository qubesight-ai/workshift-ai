import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Observation, ProjectedEntity, ProjectedRelationship, WorldPersistence } from './model.js';

/** The immutable log is canonical. SQL views are reconstructed on every read. */
export class SqliteWorldPersistence implements WorldPersistence {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
      if (version > 1) throw new Error(`Unsupported database schema ${version}`);
      this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS observations (
          seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, record_id TEXT NOT NULL,
          payload TEXT NOT NULL CHECK(json_valid(payload))
        );
        CREATE INDEX IF NOT EXISTS observations_record ON observations(record_id,seq);
        CREATE TRIGGER IF NOT EXISTS immutable_update BEFORE UPDATE ON observations BEGIN SELECT RAISE(ABORT,'append-only'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_delete BEFORE DELETE ON observations BEGIN SELECT RAISE(ABORT,'append-only'); END;
        CREATE VIEW IF NOT EXISTS current_observations AS
          SELECT * FROM observations o WHERE seq=(SELECT MAX(seq) FROM observations WHERE record_id=o.record_id);
        CREATE VIEW IF NOT EXISTS entity_view AS
          SELECT value AS entity, payload, seq,
            ROW_NUMBER() OVER (PARTITION BY json_extract(value,'$.id') ORDER BY seq DESC) AS rank
          FROM observations, json_each(payload,'$.entities');
        CREATE VIEW IF NOT EXISTS relationship_view AS
          SELECT value AS relationship, payload, seq,
            ROW_NUMBER() OVER (PARTITION BY json_extract(value,'$.id') ORDER BY seq DESC) AS rank
          FROM current_observations, json_each(payload,'$.relationships');
        PRAGMA user_version=1;
        COMMIT;
      `);
    } catch (error) { this.db.close(); throw error; }
  }
  async append(observation: Observation): Promise<boolean> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.db.prepare('SELECT id FROM observations WHERE id=?').get(observation.id)) {
        this.db.exec('COMMIT'); return false;
      }
      const known = new Set(this.db.prepare("SELECT json_extract(entity,'$.id') AS id FROM entity_view WHERE rank=1").all().map(e => String(e.id)));
      observation.entities.forEach(e => known.add(e.id));
      for (const edge of observation.relationships) {
        if (!known.has(edge.from) || !known.has(edge.to)) throw new Error('Relationship endpoint missing');
      }
      this.db.prepare('INSERT INTO observations(id,record_id,payload) VALUES(?,?,?)')
        .run(observation.id, observation.recordId, JSON.stringify(observation));
      this.db.exec('COMMIT'); return true;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async entities(): Promise<ProjectedEntity[]> {
    return this.db.prepare('SELECT entity,payload FROM entity_view WHERE rank=1 ORDER BY json_extract(entity,\'$.id\')').all().map(row => {
      const o = JSON.parse(String(row.payload)) as Observation;
      return { ...JSON.parse(String(row.entity)), observationId: o.id, provenance: o.provenance, contextId: o.context.id } as ProjectedEntity;
    });
  }
  async relationships(): Promise<ProjectedRelationship[]> {
    return this.db.prepare('SELECT relationship,payload FROM relationship_view WHERE rank=1 ORDER BY json_extract(relationship,\'$.id\')').all().map(row => {
      const o = JSON.parse(String(row.payload)) as Observation;
      return { ...JSON.parse(String(row.relationship)), observationId: o.id, provenance: o.provenance } as ProjectedRelationship;
    });
  }
  async observations(): Promise<Observation[]> {
    return this.db.prepare('SELECT payload FROM observations ORDER BY seq').all().map(row => JSON.parse(String(row.payload)) as Observation);
  }
  close(): void { this.db.close(); }
}
