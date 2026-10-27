import { randomUUID } from 'node:crypto';
import { AdapterError, baseUrl, jsonRequest, object, token, type Fetch } from './http.js';
export const ONET_TABLES = ['occupation_data', 'task_statements', 'essential_skills'] as const;
export type OnetTable = typeof ONET_TABLES[number];
export type SqlCell = null | string | number | boolean;
export interface ZetarisOptions { baseUrl?: string; apiKey?: string; orgId?: string; fetch?: Fetch }
const identifier = '(?:[A-Za-z_][A-Za-z0-9_]*|"[A-Za-z0-9_ *.-]+"|`[A-Za-z0-9_ *.-]+`)';
const list = `${identifier}(?:\\s*,\\s*${identifier})*`;
// Deliberately small SELECT grammar. No arbitrary expressions, functions, CTEs,
// comments, joins, subqueries, credentials, multiple statements or write commands.
const grammar = new RegExp(`^SELECT\\s+(?:\\*|${list})\\s+FROM\\s+WORKSHIFT_ONET\\.(occupation_data|task_statements|essential_skills)(?:\\s+ORDER\\s+BY\\s+${list})?\\s+LIMIT\\s+([1-9][0-9]*)(?:\\s+OFFSET\\s+(0|[1-9][0-9]*))?$`, 'i');
export function validateReadSql(sql: string): { sql: string; limit: number } {
  if (sql.length > 8_000) throw new Error('SQL too long');
  const normalized = sql.trim();
  const match = grammar.exec(normalized);
  if (!match || /;|--|\/\*|\*\//.test(normalized)) throw new Error('SQL outside bounded read-only O*NET grammar');
  const limit = Number(match[2]);
  const offset = Number(match[3] ?? 0);
  if (limit > 100 || !Number.isSafeInteger(offset) || offset > 100_000) throw new Error('SQL exceeds row/offset bounds');
  if (offset > 0 && !/\sORDER\s+BY\s/i.test(normalized)) throw new Error('Pagination requires a stable unique ORDER BY');
  return { sql: normalized, limit };
}
/** Contract verified from zetaris/getting-started scripts/zetaris_sql.py,
 * commit 6a2fbaa47c32c9ac33f6584c64b43b146c621bed. Not live-verified on 2.4.3.1.
 * Only `data` matrix is evidenced; we do not guess header or pagination shapes.
 */
export function parseZetarisRun(value: unknown, limit: number): SqlCell[][] {
  if (!object(value) || value.error || value.errors || value.success === false || !Array.isArray(value.data)) throw new AdapterError('contract', 'Unrecognized Zetaris /run envelope; verify the installed API contract');
  if (value.data.length > limit) throw new AdapterError('contract', 'Zetaris exceeded requested row limit');
  const rows: SqlCell[][] = [];
  let width: number | undefined;
  for (const row of value.data) {
    if (!Array.isArray(row) || !row.every(c => c === null || typeof c === 'string' || typeof c === 'boolean' || (typeof c === 'number' && Number.isFinite(c)))) throw new AdapterError('contract', 'Expected data as a matrix of SQL scalar cells');
    width ??= row.length;
    if (row.length !== width) throw new AdapterError('contract', 'Inconsistent Zetaris row width');
    rows.push(row as SqlCell[]);
  }
  return rows;
}
export class ZetarisReadAdapter {
  private readonly base: string;
  private readonly fetcher: Fetch;
  constructor(private readonly options: ZetarisOptions = {}) {
    this.base = baseUrl(options.baseUrl ?? 'http://127.0.0.1:8888/api/v1.0');
    this.fetcher = options.fetch ?? globalThis.fetch;
  }
  async run(sql: string) {
    const query = validateReadSql(sql);
    const key = token(this.options.apiKey, 'ZETARIS_API_KEY');
    if (!this.options.orgId || !/^[0-9]+$/.test(this.options.orgId)) throw new Error('ZETARIS_ORG_ID must be numeric');
    const requestId = randomUUID(), queryId = randomUUID();
    const payload = await jsonRequest(this.fetcher, `${this.base}/sql-editor/sqls/run`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'X-Org-ID': this.options.orgId, 'X-Request-ID': requestId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryId, sql: query.sql, source: 'SqlEditor', limit: query.limit }),
    }, 30_000);
    return { rows: parseZetarisRun(payload, query.limit), requestId, queryId };
  }
}
